//! Disk-Usage-Sammler fuer's Backup-Panel und (spaeter) Warn-Banner.
//!
//! Vier Metriken:
//!   - Groesse von `/pb/pb_data` (SQLite-Datei + File-Storage zusammen, via `du`)
//!   - Backup-Verzeichnis-Groesse (Summe aller .tar.gz-Files)
//!   - Docker-Volumes-Total (alle Volumes des Daemons, via `docker system df`)
//!   - Freier Disk-Space im Backup-Verzeichnis (via `df -k`)

use crate::{paths, services};
use serde::Serialize;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct DiskUsage {
    /// Groesse von `/pb/pb_data` (None wenn pb nicht erreichbar).
    pub pb_data_bytes: Option<u64>,
    /// Summe aller `rapport-*.tar.gz`-Backups.
    pub backups_total_bytes: u64,
    pub backup_count: u32,
    /// Freier Platz auf dem Disk wo die Backups liegen.
    pub host_free_bytes: u64,
    /// Gesamt-Platz auf demselben Disk.
    pub host_total_bytes: u64,
    /// Totaler Docker-Volumes-Verbrauch (alle Compose-Stacks, nicht nur unsere).
    pub docker_volumes_bytes: Option<u64>,
}

pub async fn collect() -> DiskUsage {
    let (host_free, host_total) = host_disk(&paths::backups_dir());
    DiskUsage {
        pb_data_bytes: pb_data_size().await.ok(),
        backups_total_bytes: backups_size(),
        backup_count: backup_count(),
        host_free_bytes: host_free,
        host_total_bytes: host_total,
        docker_volumes_bytes: docker_volumes_size().await.ok(),
    }
}

async fn pb_data_size() -> Result<u64, String> {
    let out = Command::new("docker")
        .current_dir(services::compose_dir())
        .args(["compose", "exec", "-T", "pb", "du", "-sb", "/pb/pb_data"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    // `du -sb` Format: "<bytes>\t<path>"
    String::from_utf8_lossy(&out.stdout)
        .split_whitespace()
        .next()
        .unwrap_or("")
        .parse::<u64>()
        .map_err(|e| e.to_string())
}

fn backups_size() -> u64 {
    let dir = paths::backups_dir();
    std::fs::read_dir(&dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum()
}

fn backup_count() -> u32 {
    crate::backup::list().len() as u32
}

fn host_disk(path: &std::path::Path) -> (u64, u64) {
    // `df -k <path>` → 2. Zeile: FS 1k-blocks Used Avail Capacity ... Mounted-on
    let out = std::process::Command::new("df")
        .arg("-k")
        .arg(path)
        .output();
    let Ok(o) = out else { return (0, 0) };
    if !o.status.success() {
        return (0, 0);
    }
    let stdout = String::from_utf8_lossy(&o.stdout);
    let mut lines = stdout.lines();
    let _header = lines.next();
    let Some(data_line) = lines.next() else { return (0, 0) };
    let cols: Vec<&str> = data_line.split_whitespace().collect();
    if cols.len() < 4 {
        return (0, 0);
    }
    let total = cols[1].parse::<u64>().unwrap_or(0).saturating_mul(1024);
    let avail = cols[3].parse::<u64>().unwrap_or(0).saturating_mul(1024);
    (avail, total)
}

async fn docker_volumes_size() -> Result<u64, String> {
    let out = Command::new("docker")
        .args(["system", "df", "--format", "json"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("docker system df fehlgeschlagen".into());
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        // Docker nennt's "Local Volumes" (Mac/Linux); aelter manchmal "Volumes".
        let t = v.get("Type").and_then(|x| x.as_str()).unwrap_or("");
        if t == "Local Volumes" || t == "Volumes" {
            let size_str = v.get("Size").and_then(|x| x.as_str()).unwrap_or("");
            return Ok(parse_human_size(size_str));
        }
    }
    Err("Volumes-Row nicht gefunden".into())
}

/// "1.5GB" / "850MB" / "0B" → Bytes
fn parse_human_size(s: &str) -> u64 {
    let s = s.trim();
    let split = s
        .find(|c: char| c.is_alphabetic())
        .unwrap_or(s.len());
    let (num, unit) = s.split_at(split);
    let n: f64 = num.parse().unwrap_or(0.0);
    let mul = match unit.trim().to_uppercase().as_str() {
        "B" => 1.0,
        "KB" | "K" => 1000.0,
        "MB" | "M" => 1000.0 * 1000.0,
        "GB" | "G" => 1000.0 * 1000.0 * 1000.0,
        "TB" | "T" => 1000.0_f64.powi(4),
        "KIB" => 1024.0,
        "MIB" => 1024.0 * 1024.0,
        "GIB" => 1024.0 * 1024.0 * 1024.0,
        _ => 1.0,
    };
    (n * mul) as u64
}
