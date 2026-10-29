//! Plattform-spezifische Pfade fuer den App-Data-Bereich.
//!
//! Die App selber liest/schreibt nur in `data_dir()` — PocketBase-Volume,
//! Storage-Files, Backups, `config.env`. Container greifen ueber `-v`-Mounts
//! auf diese Pfade zu.

use directories::ProjectDirs;
use std::path::PathBuf;

const QUALIFIER: &str = "com";
const ORG: &str = "rapport";
const APP: &str = "server-app";

/// `~/Library/Application Support/com.rapport.server-app/` (macOS),
/// `~/.local/share/rapport-server-app/` (Linux),
/// `%APPDATA%/rapport/server-app/` (Windows).
pub fn data_dir() -> PathBuf {
    ProjectDirs::from(QUALIFIER, ORG, APP)
        .map(|d| d.data_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("./data"))
}

pub fn pb_data_dir() -> PathBuf {
    data_dir().join("pb_data")
}

pub fn storage_data_dir() -> PathBuf {
    data_dir().join("storage")
}

pub fn logs_dir() -> PathBuf {
    data_dir().join("logs")
}

pub fn backups_dir() -> PathBuf {
    data_dir().join("backups")
}

pub fn config_env_path() -> PathBuf {
    data_dir().join("config.env")
}

pub fn admin_ui_cert_path() -> PathBuf {
    data_dir().join("admin-ui-cert.pem")
}

pub fn admin_ui_key_path() -> PathBuf {
    data_dir().join("admin-ui-key.pem")
}

/// Erzeugt alle noetigen Verzeichnisse falls sie noch nicht existieren.
pub fn ensure_dirs() -> std::io::Result<()> {
    for d in [
        data_dir(),
        pb_data_dir(),
        storage_data_dir(),
        logs_dir(),
        backups_dir(),
    ] {
        std::fs::create_dir_all(&d)?;
    }
    Ok(())
}
