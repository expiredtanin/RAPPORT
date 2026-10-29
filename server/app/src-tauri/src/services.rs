//! Service-Inventar.
//!
//! Die App ist eine duenne UI ueber dem Compose-Stack im
//! Ordner `server/container/` des Rapport-Repos. `id` ist hier 1:1 der Compose-Service-Name —
//! der Supervisor bildet daraus `docker compose <id>`-Aufrufe. Image-, Env- und
//! Mount-Konfiguration kommt komplett aus `server/container/docker-compose.yml`
//! plus dortiger `.env`.

use crate::health::HealthProbe;
use serde::{Deserialize, Serialize};

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Wird beim App-Start aus Konfig / Auto-Detect gesetzt — danach read-only.
static COMPOSE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Compose-Projektverzeichnis. Liefert den vorher gesetzten Pfad, oder
/// panickt wenn `init_compose_dir()` noch nicht gelaufen ist.
pub fn compose_dir() -> &'static Path {
    COMPOSE_DIR
        .get()
        .map(|p| p.as_path())
        .expect("compose_dir not initialized — call init_compose_dir() first")
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
    /// Host-Port fuer die UI-Anzeige + Health-Probe.
    pub port: u16,
    /// Andere Services die laut Compose vorher laufen sollten — nur
    /// informativ fuer Sortierung in der UI. Echte Dep-Order erzwingt Compose.
    pub depends_on: Vec<String>,
    /// Health-Probe (HTTP/TCP) fuer "echt up" jenseits von `docker ps`.
    pub health: HealthProbe,
}

pub fn default_services() -> Vec<ServiceDef> {
    vec![
        ServiceDef {
            id: "pb".into(),
            display_name: "PocketBase".into(),
            port: 18090, // Host-Port aus server/container/.env (PB_PORT)
            depends_on: vec![],
            health: HealthProbe::Http {
                url: "http://127.0.0.1:8090/api/health".into(),
            },
        },
        ServiceDef {
            id: "app".into(),
            display_name: "RAPPORT".into(),
            port: 18080, // APP_PORT
            depends_on: vec!["pb".into()],
            health: HealthProbe::Http {
                url: "http://127.0.0.1:8080/".into(),
            },
        },
    ]
}
