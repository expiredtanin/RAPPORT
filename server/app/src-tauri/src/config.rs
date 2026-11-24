//! Konfigurations-Management.
//!
//! Liest und schreibt `config.env` im App-Data-Pfad. Generiert sichere
//! Defaults beim Erst-Start: `PB_SUPERUSER_EMAIL`, `PB_SUPERUSER_PASSWORD`
//! (PocketBase-Admin-Zugang, siehe server/container/.env.example).

use crate::paths;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::Rng;
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;

/// Geordnete Map (für stabile Datei-Reihenfolge).
pub type EnvMap = BTreeMap<String, String>;

pub fn load() -> Result<EnvMap, String> {
    let path = paths::config_env_path();
    if !path.exists() {
        return Ok(EnvMap::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    Ok(parse(&content))
}

/// Zerlegt den Inhalt einer `config.env` (KEY=VALUE, `#`-Kommentare).
pub fn parse(content: &str) -> EnvMap {
    let mut map = EnvMap::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            map.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    map
}

/// Gueltiger Schluessel: `[A-Z0-9_]`, beginnt mit Buchstabe/Unterstrich.
pub fn is_valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 64
        && key
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
        && !key.starts_with(|c: char| c.is_ascii_digit())
}

/// Werte duerfen keine Zeilenumbrueche/Steuerzeichen enthalten — sonst liesse
/// sich ueber einen Wert ein weiterer `KEY=...` in die Datei schmuggeln.
pub fn is_valid_value(value: &str) -> bool {
    value.len() <= 4096 && !value.chars().any(|c| c.is_control())
}

/// Schluessel mit Geheimnissen (werden ueber HTTP nie ausgeliefert, in der
/// Diagnose geschwaerzt).
pub fn is_secret_key(key: &str) -> bool {
    ["PASSWORD", "SECRET", "TOKEN", "KEY"]
        .iter()
        .any(|p| key.contains(p))
}

/// Setzt einen einzelnen Wert (validiert) und speichert die Datei.
pub fn set_value(key: &str, value: &str) -> Result<(), String> {
    if !is_valid_key(key) {
        return Err(format!("ungueltiger Schluessel: {key:?}"));
    }
    if !is_valid_value(value) {
        return Err("ungueltiger Wert (Zeilenumbrueche/Steuerzeichen nicht erlaubt)".into());
    }
    let mut map = load()?;
    map.insert(key.to_string(), value.trim().to_string());
    save(&map)
}

/// Liest einen Bool-Schalter (`true`/`1` an, `false`/`0` aus).
pub fn flag(map: &EnvMap, key: &str, default: bool) -> bool {
    map.get(key)
        .map(|v| !matches!(v.trim().to_ascii_lowercase().as_str(), "false" | "0" | "no" | "off"))
        .unwrap_or(default)
}

pub fn save(map: &EnvMap) -> Result<(), String> {
    paths::ensure_dirs().map_err(|e| format!("ensure_dirs: {e}"))?;
    let path = paths::config_env_path();
    let mut tmp = path.clone();
    tmp.set_extension("env.tmp");

    // Temp-Datei gleich mit 0600 anlegen — sonst liegen die Passwoerter
    // kurz mit Default-umask (0644) lesbar auf der Platte.
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut file = opts.open(&tmp).map_err(|e| format!("create {}: {e}", tmp.display()))?;
    let mut content = String::from(
        "# RAPPORT Server-App — Auto-generated config.env\n# Aenderungen ueberleben App-Updates.\n\n",
    );
    for (k, v) in map {
        // Defensive: kaputte Eintraege nie schreiben (Datei-Injection).
        if !is_valid_key(k) || !is_valid_value(v) {
            log::warn!("config.env: ungueltiger Eintrag {k:?} verworfen");
            continue;
        }
        content.push_str(&format!("{k}={v}\n"));
    }
    file.write_all(content.as_bytes())
        .map_err(|e| format!("write {}: {e}", tmp.display()))?;
    file.sync_all().map_err(|e| format!("sync: {e}"))?;
    drop(file);

    fs::rename(&tmp, &path).map_err(|e| format!("rename: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o600);
        let _ = fs::set_permissions(&path, perms);
    }
    Ok(())
}

/// Erst-Start: fehlende Schluessel mit sicheren Defaults befuellen.
/// Aendert keine existierenden Werte.
pub fn ensure_defaults(map: &mut EnvMap) {
    map.entry("PB_SUPERUSER_EMAIL".into())
        .or_insert_with(|| "admin@rapport.local".into());
    map.entry("PB_SUPERUSER_PASSWORD".into())
        .or_insert_with(random_password);
    map.entry("API_EXTERNAL_URL".into())
        .or_insert_with(|| "http://localhost:8090".into());
    map.entry("BIND_HOST".into())
        .or_insert_with(|| "127.0.0.1".into());
    map.entry("ADMIN_UI_PASSWORD".into())
        .or_insert_with(random_password);
    map.entry("ADMIN_UI_PORT".into())
        .or_insert_with(|| "9090".into());
    // Default 127.0.0.1: WebUI nur ueber Loopback. Fuer LAN-Zugriff manuell
    // auf 0.0.0.0 stellen (Settings → Im LAN freigeben).
    map.entry("ADMIN_UI_BIND".into())
        .or_insert_with(|| "127.0.0.1".into());
    // TLS ist Default: das WebUI laeuft ueber HTTPS mit selbst-signiertem Cert.
    map.entry("ADMIN_UI_TLS".into())
        .or_insert_with(|| "true".into());
    map.entry("BACKUP_ENABLED".into())
        .or_insert_with(|| "true".into());
    map.entry("BACKUP_INTERVAL_HOURS".into())
        .or_insert_with(|| "24".into());
    // Aufbewahrung: die neuesten N Backups bleiben (inkl. Sicherheits-Backups
    // vor Restore/Update/Reset), aeltere werden geloescht.
    map.entry("BACKUP_RETENTION_COUNT".into())
        .or_insert_with(|| "14".into());
    // Stunde (0–23, Ortszeit) fuer das automatische Backup. PocketBase wird
    // dafuer wenige Sekunden gestoppt (konsistente SQLite-Kopie), darum nachts.
    map.entry("BACKUP_HOUR".into())
        .or_insert_with(|| "3".into());
    // Container-Auto-Update standardmaessig AUS — explizit aktivieren via
    // Settings, weil ungeplante Migrations potenziell Daten betreffen.
    map.entry("CONTAINER_AUTOUPDATE_ENABLED".into())
        .or_insert_with(|| "false".into());
    map.entry("CONTAINER_AUTOUPDATE_INTERVAL_HOURS".into())
        .or_insert_with(|| "24".into());
    map.entry("AUTO_START_CONTAINERS_ON_LAUNCH".into())
        .or_insert_with(|| "true".into());
    // Auto-Recovery: Container die in 'error' haengen werden automatisch
    // neu gestartet (exponential backoff, dann aufgeben + Notification).
    map.entry("AUTO_RECOVERY_ENABLED".into())
        .or_insert_with(|| "true".into());
    map.entry("AUTO_RECOVERY_BASE_DELAY_SECONDS".into())
        .or_insert_with(|| "60".into());
    map.entry("AUTO_RECOVERY_MAX_ATTEMPTS".into())
        .or_insert_with(|| "5".into());
}

fn random_password() -> String {
    let mut rng = rand::thread_rng();
    let bytes: [u8; 24] = rng.gen();
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Schreibt eine Datei, die Geheimnisse enthalten kann (Compose-`.env`, Diagnose mit Logs), gleich mit 0600 —
/// nicht erst mit Default-umask anlegen und danach die Rechte ändern (Audit 24.11.2026).
pub fn write_private(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(path).map_err(|e| format!("create {}: {e}", path.display()))?;
    f.write_all(bytes).map_err(|e| format!("write {}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        // bestehende Datei (truncate) behält sonst ihre alten Rechte
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ignores_comments_and_keeps_equals_in_value() {
        let m = parse("# x\n\nA=1\nB = a=b \nkaputt\n");
        assert_eq!(m.get("A").map(String::as_str), Some("1"));
        assert_eq!(m.get("B").map(String::as_str), Some("a=b"));
        assert_eq!(m.len(), 2);
    }

    #[test]
    fn key_and_value_validation() {
        assert!(is_valid_key("BACKUP_HOUR"));
        assert!(is_valid_key("_X1"));
        assert!(!is_valid_key(""));
        assert!(!is_valid_key("1ABC"));
        assert!(!is_valid_key("a-b"));
        assert!(!is_valid_key("A=B"));
        assert!(is_valid_value("http://x:1/?a=b"));
        assert!(!is_valid_value("x\nADMIN_UI_BIND=0.0.0.0"));
        assert!(!is_valid_value("x\r"));
    }

    #[test]
    fn secrets_and_flags() {
        assert!(is_secret_key("ADMIN_UI_PASSWORD"));
        assert!(is_secret_key("PB_SUPERUSER_PASSWORD"));
        assert!(!is_secret_key("BACKUP_HOUR"));
        let m = parse("A=false\nB=1\nC=0\n");
        assert!(!flag(&m, "A", true));
        assert!(flag(&m, "B", false));
        assert!(!flag(&m, "C", true));
        assert!(flag(&m, "D", true));
    }
}
