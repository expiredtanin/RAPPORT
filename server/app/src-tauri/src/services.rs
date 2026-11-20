//! Service-Inventar.
//!
//! Die App ist eine duenne UI ueber dem Compose-Stack im
//! Ordner `server/container/` des Rapport-Repos. `id` ist hier 1:1 der Compose-Service-Name —
//! der Supervisor bildet daraus `docker compose <id>`-Aufrufe. Image-, Env- und
//! Mount-Konfiguration kommt komplett aus `server/container/docker-compose.yml`
//! plus dortiger `.env`.

use serde::{Deserialize, Serialize};

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Wird beim App-Start aus Konfig / Auto-Detect gesetzt — danach read-only.
static COMPOSE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Platzhalter, solange kein Compose-Verzeichnis gefunden wurde.
static FALLBACK_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Compose-Projektverzeichnis. Ist noch keins gesetzt (z.B. Erst-Start vor
/// dem Setup-Wizard), wird die Suche erneut versucht — so greift ein frisch
/// vom Wizard angelegter Stack ohne App-Neustart. Ohne Treffer kommt der
/// Wizard-Zielpfad zurueck: `docker compose` scheitert dort mit einer klaren
/// Meldung ("no configuration file provided") statt die App per Panic in
/// einzelnen Hintergrund-Tasks lahmzulegen.
pub fn compose_dir() -> &'static Path {
    if let Some(p) = COMPOSE_DIR.get() {
        return p.as_path();
    }
    let override_path = crate::config::load()
        .ok()
        .and_then(|c| c.get("COMPOSE_DIR").cloned());
    if let Ok(p) = init_compose_dir(override_path) {
        return p;
    }
    FALLBACK_DIR
        .get_or_init(crate::setup::compose_dir)
        .as_path()
}

/// Initialisiert den Compose-Pfad. Reihenfolge:
/// 1. expliziter `override` (z.B. aus `config.env` `COMPOSE_DIR`)
/// 2. Env-Variable `RAPPORT_COMPOSE_DIR`
/// 3. `~/RAPPORT/server/container/` (Klon des Gesamt-Repos), danach `~/RAPPORT/SERVER-CONTAINER/` (alter Einzel-Klon)
/// 4. `~/.rapport/compose/` (Setup-Wizard)
/// 5. `<exe-parent>/../SERVER-CONTAINER/`
/// 6. `<crate-dir>/../../container/` (Dev-Layout im Gesamt-Repo: server/app → server/container),
///    danach `<crate-dir>/../../SERVER-CONTAINER/` (alte Geschwister-Repos)
///
/// Jeder Kandidat muss eine `docker-compose.yml` enthalten.
pub fn init_compose_dir(override_path: Option<String>) -> Result<&'static Path, String> {
    if let Some(p) = COMPOSE_DIR.get() {
        return Ok(p.as_path());
    }
    let candidates = collect_candidates(override_path);
    for c in &candidates {
        if c.join("docker-compose.yml").exists() {
            let _ = COMPOSE_DIR.set(c.clone());
            return Ok(COMPOSE_DIR.get().unwrap().as_path());
        }
    }
    Err(format!(
        "no docker-compose.yml found — tried: {}",
        candidates.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(", ")
    ))
}

fn collect_candidates(override_path: Option<String>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(p) = override_path {
        if !p.is_empty() {
            out.push(PathBuf::from(p));
        }
    }
    if let Ok(p) = std::env::var("RAPPORT_COMPOSE_DIR") {
        out.push(PathBuf::from(p));
    }
    if let Some(home) = std::env::var_os("HOME") {
        // Eigener Dev-Klon hat Vorrang (Source-Edits sollen sichtbar bleiben).
        out.push(PathBuf::from(&home).join("RAPPORT/server/container"));
        out.push(PathBuf::from(&home).join("RAPPORT/SERVER-CONTAINER"));
        // Setup-Wizard-Default: vom Gitea-Tarball nach ~/.rapport/compose/ extrahiert.
        out.push(PathBuf::from(&home).join(".rapport/compose"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            out.push(parent.join("../SERVER-CONTAINER"));
        }
    }
    out.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../container"));
    out.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("SERVER-CONTAINER"),
    );
    out
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceDef {
    /// Compose-Service-Name. Wird so als Argument an `docker compose` gegeben.
    pub id: String,
    /// Anzeige-Name fuer die UI.
    pub display_name: String,
    /// Host-Port fuer die UI-Anzeige.
    pub port: u16,
    /// Andere Services die laut Compose vorher laufen sollten — nur
    /// informativ fuer Sortierung in der UI. Echte Dep-Order erzwingt Compose.
    /// (Health kommt aus den Compose-Healthchecks, siehe supervisor::map_state.)
    pub depends_on: Vec<String>,
}

/// Wert eines Schlüssels aus dem Inhalt einer `.env`-Datei (KEY=VALUE, `#`-Kommentare, optionale Anführungszeichen).
fn env_value(content: &str, key: &str) -> Option<String> {
    content.lines().find_map(|line| {
        let line = line.trim();
        if line.starts_with('#') {
            return None;
        }
        let (k, v) = line.split_once('=')?;
        (k.trim() == key).then(|| v.trim().trim_matches('"').trim_matches('\'').to_string())
    })
}

/// Host-Port eines Dienstes wie Compose ihn veröffentlicht: `<key>` aus der `.env` des
/// Compose-Ordners, sonst der Default aus `docker-compose.yml` (`${PB_PORT:-8090}` usw.).
/// Der Setup-Wizard schreibt 18090/18080, die `.env.example` des Repos 8090/8080 — vorher war
/// 18090/18080 fest eingetragen, damit zeigten Links und das PocketBase-Embed bei Repo-Installationen ins Leere.
fn compose_port(key: &str, compose_default: u16) -> u16 {
    std::fs::read_to_string(compose_dir().join(".env"))
        .ok()
        .and_then(|c| env_value(&c, key))
        .and_then(|v| v.parse().ok())
        .unwrap_or(compose_default)
}

pub fn default_services() -> Vec<ServiceDef> {
    vec![
        ServiceDef {
            id: "pb".into(),
            display_name: "PocketBase".into(),
            port: compose_port("PB_PORT", 8090),
            depends_on: vec![],
        },
        ServiceDef {
            id: "app".into(),
            display_name: "RAPPORT".into(),
            port: compose_port("APP_PORT", 8080),
            depends_on: vec!["pb".into()],
        },
    ]
}

#[cfg(test)]
mod port_tests {
    use super::env_value;

    #[test]
    fn liest_ports_aus_env() {
        let env = "# Kommentar\nAPP_PORT=18080\nPB_PORT = \"18090\"\n#PB_PORT=1\n";
        assert_eq!(env_value(env, "PB_PORT").as_deref(), Some("18090"));
        assert_eq!(env_value(env, "APP_PORT").as_deref(), Some("18080"));
        assert_eq!(env_value(env, "FEHLT"), None);
    }
}
