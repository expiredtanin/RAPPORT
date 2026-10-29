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
    Ok(map)
}

pub fn save(map: &EnvMap) -> Result<(), String> {
    paths::ensure_dirs().map_err(|e| format!("ensure_dirs: {e}"))?;
    let path = paths::config_env_path();
    let mut tmp = path.clone();
    tmp.set_extension("env.tmp");

    let mut file = fs::File::create(&tmp).map_err(|e| format!("create {}: {e}", tmp.display()))?;
    writeln!(file, "# RAPPORT Server-App — Auto-generated config.env").unwrap();
    writeln!(file, "# Aenderungen ueberleben App-Updates.").unwrap();
    writeln!(file).unwrap();
    for (k, v) in map {
        writeln!(file, "{k}={v}").unwrap();
    }
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
    map.entry("BACKUP_RETENTION_COUNT".into())
        .or_insert_with(|| "7".into());
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
