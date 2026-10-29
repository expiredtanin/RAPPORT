//! Backup-Modul.
//!
//! Erstellt tar.gz-Snapshots von `/pb/pb_data` (SQLite + File-Storage in einem
//! Ordner — PocketBase braucht keinen separaten Dump-Mechanismus wie
//! `pg_dumpall`) via `docker compose exec -T pb tar` und legt sie unter
//! `<data_dir>/backups/` ab. Ein Hintergrund-Scheduler triggert abhaengig von
//! `BACKUP_INTERVAL_HOURS` aus der Config. Retention pruned alle ueber
//! `BACKUP_RETENTION_COUNT` hinaus (aelteste zuerst).

use crate::{paths, services};
use chrono::{DateTime, Local};
use serde::Serialize;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct BackupInfo {
    pub filename: String,
    pub created_iso: String,
    pub bytes: u64,
}

/// Default-Intervall fuer den Scheduler-Tick (1 Stunde). Im Tick wird gepruefte
/// ob das letzte Backup aelter als `BACKUP_INTERVAL_HOURS` ist.
pub const SCHED_TICK: Duration = Duration::from_secs(60 * 60);

const DEFAULT_INTERVAL_HOURS: u64 = 24;
const DEFAULT_RETENTION: usize = 7;

pub fn list() -> Vec<BackupInfo> {
    let dir = paths::backups_dir();
    let Ok(read) = std::fs::read_dir(&dir) else { return vec![] };
    let mut out: Vec<BackupInfo> = read
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let name = e.file_name().to_string_lossy().to_string();
            if !name.starts_with("rapport-") || !name.ends_with(".tar.gz") {
                return None;
            }
            let created: DateTime<Local> = meta.modified().ok()?.into();
            Some(BackupInfo {
                filename: name,
                created_iso: created.to_rfc3339(),
                bytes: meta.len(),
            })
        })
        .collect();
    out.sort_by(|a, b| b.created_iso.cmp(&a.created_iso));
    out
}

/// Erstellt ein neues Backup. Datei-Name `rapport-YYYYmmdd-HHMMSS.tar.gz`.
pub async fn create() -> Result<BackupInfo, String> {
    paths::ensure_dirs().map_err(|e| format!("ensure_dirs: {e}"))?;
    let stamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let filename = format!("rapport-{stamp}.tar.gz");
    let path = paths::backups_dir().join(&filename);

    log::info!("Backup → {}", path.display());

    // `docker compose exec -T pb tar ...` — `-T` schaltet das TTY ab, damit
    // stdout sauber pipebar ist. `-C /` + relativer Pfad, damit das Archiv
    // beim Restore direkt mit `tar xzf ... -C /` zurueckgespielt werden kann.
    let output = Command::new("docker")
        .current_dir(services::compose_dir())
        .args([
            "compose",
            "exec",
            "-T",
            "pb",
            "tar",
            "-czf",
            "-",
            "-C",
            "/",
            "pb/pb_data",
        ])
        .output()
        .await
        .map_err(|e| format!("spawn tar: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "tar exited {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    std::fs::write(&path, &output.stdout).map_err(|e| format!("write {}: {e}", path.display()))?;

    let bytes = output.stdout.len() as u64;
    log::info!("Backup geschrieben: {} ({} bytes)", path.display(), bytes);
    crate::events::info(format!(
        "Backup erstellt: {filename} ({} KB)",
        bytes / 1024
    ))
    .await;

    Ok(BackupInfo {
        filename,
        created_iso: Local::now().to_rfc3339(),
        bytes,
    })
}

/// Loescht die aeltesten Backups bis nur noch `keep` da sind.
pub fn prune(keep: usize) -> Result<usize, String> {
    let all = list();
    if all.len() <= keep {
        return Ok(0);
    }
    let removed = &all[keep..];
    let mut count = 0;
    for b in removed {
        let path = paths::backups_dir().join(&b.filename);
        match std::fs::remove_file(&path) {
            Ok(_) => {
                log::info!("Backup geprunet: {}", path.display());
                count += 1;
            }
            Err(e) => log::warn!("remove {}: {e}", path.display()),
        }
    }
    Ok(count)
}

/// Liest die Config-Werte mit Fallbacks.
fn config_values() -> (bool, u64, usize) {
    let cfg = crate::config::load().unwrap_or_default();
    let enabled = cfg
        .get("BACKUP_ENABLED")
        .map(|v| v != "false" && v != "0")
        .unwrap_or(true);
    let interval = cfg
        .get("BACKUP_INTERVAL_HOURS")
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_INTERVAL_HOURS);
    let retention = cfg
        .get("BACKUP_RETENTION_COUNT")
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_RETENTION);
    (enabled, interval, retention)
}

/// Hintergrund-Scheduler. Tickt jede Stunde, schaut ob das aelteste Backup
/// schon `BACKUP_INTERVAL_HOURS` her ist, und triggert dann einen neuen
/// Dump + Prune.
pub async fn scheduler_loop() {
    let mut tick = tokio::time::interval(SCHED_TICK);
    // Erstes tick() feuert sofort — das ueberspringen wir, damit nicht beim
    // App-Start jedes Mal ein Backup laeuft.
    tick.tick().await;
    loop {
        tick.tick().await;
        let (enabled, interval, retention) = config_values();
        if !enabled {
            continue;
        }
        if !backup_due(interval) {
            continue;
        }
        match create().await {
            Ok(b) => log::info!("Auto-Backup: {}", b.filename),
            Err(e) => log::warn!("Auto-Backup fehlgeschlagen: {e}"),
        }
        if let Err(e) = prune(retention) {
            log::warn!("Prune fehlgeschlagen: {e}");
        }
    }
}

fn backup_due(interval_hours: u64) -> bool {
    let all = list();
    let Some(latest) = all.first() else { return true };
    let Ok(latest_dt) = DateTime::parse_from_rfc3339(&latest.created_iso) else {
        return true;
    };
    let now = Local::now();
    let age = now.signed_duration_since(latest_dt.with_timezone(&Local));
    age.num_hours() >= interval_hours as i64
}

#[derive(Debug, Clone, Serialize)]
pub struct RestoreResult {
    pub restored_from: String,
    pub safety_backup: String,
    pub finished_at_iso: String,
    pub restore_log: String,
}

/// Spielt einen Snapshot zurueck.
/// Workflow:
///   1. Sicherheits-Backup vom aktuellen Zustand (kann nicht weh tun)
///   2. Kompletten Stack stoppen (PocketBase darf die SQLite-Datei nicht offen
///      halten, waehrend wir sie ueberschreiben)
///   3. Frischer Container auf demselben Volume extrahiert das Archiv hinein
///      (`docker compose run` — kein laufender Container noetig)
///   4. Stack wieder starten
pub async fn restore(filename: &str) -> Result<RestoreResult, String> {
    // Pfad-Traversal-Schutz: Filename darf keine Separatoren enthalten.
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err("ungueltiger Dateiname".into());
    }
    let dir = paths::backups_dir();
    let path = dir.join(filename);
    if !path.starts_with(&dir) || !path.exists() {
        return Err(format!("Backup nicht gefunden: {filename}"));
    }
    let archive = std::fs::read(&path).map_err(|e| format!("read archive: {e}"))?;

    // 1) Safety-Backup zuerst — wenn das schiefgeht, gar nicht erst restoren.
    crate::events::info(format!("Restore von {filename} startet — erst Safety-Backup")).await;
    let safety = create()
        .await
        .map_err(|e| format!("Safety-Backup vor Restore fehlgeschlagen: {e}"))?;

    // 2) Kompletten Stack stoppen.
    crate::events::info("Restore: stoppe Stack (pb + app)").await;
    let stop_out = Command::new("docker")
        .current_dir(services::compose_dir())
        .args(["compose", "stop", "pb", "app"])
        .output()
        .await
        .map_err(|e| format!("spawn compose stop: {e}"))?;
    if !stop_out.status.success() {
        return Err(format!(
            "compose stop fehlgeschlagen: {}",
            String::from_utf8_lossy(&stop_out.stderr).trim()
        ));
    }

    // 3) Archiv in einem frischen, kurzlebigen Container auf demselben Volume
    //    entpacken — vorher alte Daten weg, damit kein Mix aus altem + neuem
    //    Stand entsteht.
    crate::events::info(format!("Restore: spiele Snapshot {filename} ein ({} KB)", archive.len() / 1024)).await;
    let mut child = Command::new("docker")
        .current_dir(services::compose_dir())
        .args([
            "compose", "run", "--rm", "-T", "--no-deps", "--entrypoint", "sh",
            "pb", "-c", "rm -rf /pb/pb_data/* /pb/pb_data/.[!.]* 2>/dev/null; tar -xzf - -C /",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("spawn restore-container: {e}"))?;
    {
        let mut stdin = child.stdin.take().ok_or_else(|| "no stdin".to_string())?;
        stdin
            .write_all(&archive)
            .await
            .map_err(|e| format!("write archive to restore-container: {e}"))?;
        stdin
            .shutdown()
            .await
            .map_err(|e| format!("restore-container stdin shutdown: {e}"))?;
    }
    let output = child
        .wait_with_output()
        .await
        .map_err(|e| format!("wait restore-container: {e}"))?;
    let restore_log = format!(
        "{}\n--- stderr ---\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !output.status.success() {
        // Stack trotzdem wieder hochfahren, damit nicht alles down bleibt —
        // aber Fehler klar melden, Safety-Backup existiert.
        let _ = Command::new("docker")
            .current_dir(services::compose_dir())
            .args(["compose", "up", "-d"])
            .output()
            .await;
        return Err(format!(
            "Restore-Extraktion fehlgeschlagen (Stack wieder gestartet, Safety-Backup: {}): {restore_log}",
            safety.filename
        ));
    }

    // 4) Stack wieder hoch.
    crate::events::info("Restore: starte Stack wieder").await;
    let up_out = Command::new("docker")
        .current_dir(services::compose_dir())
        .args(["compose", "up", "-d"])
        .output()
        .await
        .map_err(|e| format!("spawn compose up: {e}"))?;
    if !up_out.status.success() {
        return Err(format!(
            "compose up nach Restore fehlgeschlagen: {}",
            String::from_utf8_lossy(&up_out.stderr).trim()
        ));
    }

    crate::events::info(format!(
        "Restore abgeschlossen aus {filename} (Safety: {})",
        safety.filename
    ))
    .await;

    Ok(RestoreResult {
        restored_from: filename.to_string(),
        safety_backup: safety.filename,
        finished_at_iso: Local::now().to_rfc3339(),
        restore_log,
    })
}
