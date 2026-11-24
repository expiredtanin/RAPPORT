//! Backup-Modul.
//!
//! Erstellt tar.gz-Snapshots von `/pb/pb_data` (SQLite + File-Storage in einem
//! Ordner) und legt sie unter `<data_dir>/backups/` ab.
//!
//! **Konsistenz:** Ein `tar` ueber die SQLite-Dateien eines laufenden
//! PocketBase ist nicht konsistent (WAL-Modus, Schreibzugriffe mitten im
//! Kopieren). Das pb-Image hat kein `sqlite3`, und die PocketBase-Backup-API
//! braeuchte Superuser-Login. Darum: pb kurz stoppen (`compose stop pb`),
//! Archiv in einem kurzlebigen Container auf demselben Volume erzeugen
//! (`compose run --no-deps --entrypoint tar pb ...`), pb wieder starten —
//! Ausfall ein paar Sekunden. Das Archiv wird gestreamt (kein ganzes Archiv
//! im RAM) und erst nach Erfolg vom `.partial`-Namen umbenannt.
//!
//! Ein Hintergrund-Scheduler sichert taeglich (`BACKUP_INTERVAL_HOURS`,
//! Default 24) zur Stunde `BACKUP_HOUR` (Default 3 Uhr) und loescht alles
//! ueber `BACKUP_RETENTION_COUNT` hinaus (Default 14, aelteste zuerst).
//!
//! Alle Daten-Operationen (Backup, Restore, Container-Update, Daten-Reset)
//! laufen ueber `op_lock()` nacheinander, nie gleichzeitig.

use crate::{paths, services};
use chrono::{DateTime, Local, Timelike};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, SystemTime};
use tokio::process::Command;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize)]
pub struct BackupInfo {
    pub filename: String,
    pub created_iso: String,
    pub bytes: u64,
}

/// Scheduler-Tick (10 Min) — fein genug, um `BACKUP_HOUR` zu treffen.
pub const SCHED_TICK: Duration = Duration::from_secs(10 * 60);

const DEFAULT_INTERVAL_HOURS: u64 = 24;
pub const DEFAULT_RETENTION: usize = 14;
const DEFAULT_HOUR: u32 = 3;

const PREFIX: &str = "rapport-";
const SUFFIX: &str = ".tar.gz";

static OP_LOCK: Mutex<()> = Mutex::const_new(());

/// Serialisiert alle Daten-Operationen (Backup/Restore/Update/Reset).
pub fn op_lock() -> &'static Mutex<()> {
    &OP_LOCK
}

/// Prueft einen Backup-Dateinamen streng: `rapport-` + `[A-Za-z0-9_-]` +
/// `.tar.gz`, keine Pfadtrenner, kein `..`. Schuetzt Restore (Name kommt aus
/// der URL bzw. vom Frontend) vor Pfad-Traversal.
pub fn is_valid_backup_name(name: &str) -> bool {
    let Some(core) = name
        .strip_prefix(PREFIX)
        .and_then(|r| r.strip_suffix(SUFFIX))
    else {
        return false;
    };
    !core.is_empty()
        && name.len() <= 128
        && core
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn backup_files() -> Vec<(BackupInfo, SystemTime)> {
    let dir = paths::backups_dir();
    let Ok(read) = std::fs::read_dir(&dir) else { return vec![] };
    read.filter_map(|e| e.ok())
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let name = e.file_name().to_string_lossy().to_string();
            if !is_valid_backup_name(&name) {
                return None;
            }
            let mtime = meta.modified().ok()?;
            let created: DateTime<Local> = mtime.into();
            Some((
                BackupInfo {
                    filename: name,
                    created_iso: created.to_rfc3339(),
                    bytes: meta.len(),
                },
                mtime,
            ))
        })
        .collect()
}

/// Alle Backups, neueste zuerst (nach Datei-Zeit, nicht nach ISO-String —
/// der wechselt bei Sommer-/Winterzeit den Offset).
pub fn list() -> Vec<BackupInfo> {
    let mut all = backup_files();
    all.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.0.filename.cmp(&a.0.filename)));
    all.into_iter().map(|(b, _)| b).collect()
}

/// Freien Dateinamen fuer jetzt bilden; `label` (z.B. `vor-restore`) wird
/// angehaengt. Gleiche Sekunde → `-2`, `-3`, … statt Ueberschreiben.
fn next_filename(dir: &Path, stamp: &str, label: Option<&str>) -> String {
    let base = match label {
        Some(l) => format!("{PREFIX}{stamp}-{l}"),
        None => format!("{PREFIX}{stamp}"),
    };
    let mut name = format!("{base}{SUFFIX}");
    let mut n = 2;
    while dir.join(&name).exists() {
        name = format!("{base}-{n}{SUFFIX}");
        n += 1;
    }
    name
}

async fn compose_out(args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("docker")
        .current_dir(services::compose_dir())
        .arg("compose")
        .args(args)
        .output()
        .await
        .map_err(|e| format!("spawn docker compose {args:?}: {e}"))
}

/// Laeuft der pb-Container gerade?
async fn pb_running() -> Result<bool, String> {
    let out = compose_out(&["ps", "--status", "running", "-q", "pb"]).await?;
    if !out.status.success() {
        return Err(format!(
            "compose ps: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(!String::from_utf8_lossy(&out.stdout).trim().is_empty())
}

/// Erstellt ein neues Backup (nimmt den Operations-Lock).
pub async fn create() -> Result<BackupInfo, String> {
    let _guard = op_lock().lock().await;
    create_unlocked(None).await
}

/// Backup + Aufbewahrung anwenden — fuer "Backup jetzt" (IPC + HTTP).
pub async fn create_and_prune() -> Result<BackupInfo, String> {
    let info = create().await?;
    if let Err(e) = prune(retention_from_config()) {
        log::warn!("Prune fehlgeschlagen: {e}");
    }
    Ok(info)
}

/// Backup ohne Lock — nur fuer Aufrufer, die `op_lock()` schon halten
/// (Restore, Container-Update, Daten-Reset). `label` markiert
/// Sicherheits-Backups im Dateinamen.
pub async fn create_unlocked(label: Option<&str>) -> Result<BackupInfo, String> {
    paths::ensure_dirs().map_err(|e| format!("ensure_dirs: {e}"))?;
    let dir = paths::backups_dir();
    let stamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let filename = next_filename(&dir, &stamp, label);
    let final_path = dir.join(&filename);
    let partial = dir.join(format!("{filename}.partial"));

    log::info!("Backup → {}", final_path.display());

    // 1) pb kurz anhalten, damit SQLite konsistent auf der Platte liegt.
    let was_running = pb_running().await.unwrap_or(false);
    if was_running {
        let out = compose_out(&["stop", "pb"]).await?;
        if !out.status.success() {
            return Err(format!(
                "pb fuer Backup stoppen fehlgeschlagen: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
    }

    // 2) Archiv in kurzlebigem Container auf demselben Volume erzeugen.
    let result = write_archive(&partial).await;

    // 3) pb in jedem Fall wieder starten, wenn er vorher lief.
    if was_running {
        match compose_out(&["start", "pb"]).await {
            Ok(o) if o.status.success() => {}
            Ok(o) => {
                let msg = format!(
                    "pb nach Backup nicht wieder gestartet: {}",
                    String::from_utf8_lossy(&o.stderr).trim()
                );
                log::error!("{msg}");
                crate::events::error(msg).await;
            }
            Err(e) => crate::events::error(format!("pb nach Backup: {e}")).await,
        }
    }

    let bytes = match result {
        Ok(b) => b,
        Err(e) => {
            let _ = std::fs::remove_file(&partial);
            return Err(e);
        }
    };
    std::fs::rename(&partial, &final_path)
        .map_err(|e| format!("rename {}: {e}", final_path.display()))?;

    log::info!("Backup geschrieben: {} ({} bytes)", final_path.display(), bytes);
    crate::events::info(format!("Backup erstellt: {filename} ({} KB)", bytes / 1024)).await;

    Ok(BackupInfo {
        filename,
        created_iso: Local::now().to_rfc3339(),
        bytes,
    })
}

/// Streamt `tar -czf - -C / pb/pb_data` aus einem Einmal-Container in `dest`.
async fn write_archive(dest: &Path) -> Result<u64, String> {
    let mut opts = tokio::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    opts.mode(0o600);
    let mut file = opts
        .open(dest)
        .await
        .map_err(|e| format!("create {}: {e}", dest.display()))?;

    // `-T`: kein TTY, damit stdout sauber pipebar ist. `--no-deps`: app nicht
    // mitstarten. `-C /` + relativer Pfad → Restore mit `tar -xzf - -C /`.
    let mut child = Command::new("docker")
        .current_dir(services::compose_dir())
        .args([
            "compose", "run", "--rm", "-T", "--no-deps", "--entrypoint", "tar", "pb", "-czf",
            "-", "-C", "/", "pb/pb_data",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("spawn backup-container: {e}"))?;
    let mut stdout = child.stdout.take().ok_or("kein stdout")?;
    let mut stderr = child.stderr.take().ok_or("kein stderr")?;
    let err_task = tokio::spawn(async move {
        let mut s = Vec::new();
        let _ = tokio::io::AsyncReadExt::read_to_end(&mut stderr, &mut s).await;
        s
    });
    let bytes = tokio::io::copy(&mut stdout, &mut file)
        .await
        .map_err(|e| format!("Backup schreiben: {e}"))?;
    tokio::io::AsyncWriteExt::flush(&mut file)
        .await
        .map_err(|e| format!("flush: {e}"))?;
    file.sync_all().await.map_err(|e| format!("sync: {e}"))?;
    let status = child
        .wait()
        .await
        .map_err(|e| format!("wait backup-container: {e}"))?;
    let stderr = err_task.await.unwrap_or_default();
    if !status.success() {
        return Err(format!(
            "tar exited {status}: {}",
            String::from_utf8_lossy(&stderr).trim()
        ));
    }
    if bytes < 20 {
        return Err("Backup-Archiv leer".into());
    }
    // gzip-Magic pruefen (nur die ersten 2 Bytes lesen).
    let mut head = [0u8; 2];
    let gz = std::fs::File::open(dest)
        .and_then(|mut f| std::io::Read::read_exact(&mut f, &mut head))
        .map(|_| head == [0x1f, 0x8b])
        .unwrap_or(false);
    if !gz {
        return Err("Backup-Archiv ist kein gzip".into());
    }
    Ok(bytes)
}

/// Welche Backups bei `keep` wegfallen (Eingabe neueste zuerst). `keep` ist
/// mindestens 1 — das neueste Backup wird nie geloescht.
pub fn select_for_prune(sorted_newest_first: &[BackupInfo], keep: usize) -> Vec<String> {
    let keep = keep.max(1);
    sorted_newest_first
        .iter()
        .skip(keep)
        .map(|b| b.filename.clone())
        .collect()
}

/// Loescht die aeltesten Backups bis nur noch `keep` da sind.
pub fn prune(keep: usize) -> Result<usize, String> {
    let mut count = 0;
    for name in select_for_prune(&list(), keep) {
        let path = paths::backups_dir().join(&name);
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

pub fn retention_from_config() -> usize {
    crate::config::load()
        .unwrap_or_default()
        .get("BACKUP_RETENTION_COUNT")
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_RETENTION)
}

struct SchedConfig {
    enabled: bool,
    interval_hours: u64,
    retention: usize,
    hour: Option<u32>,
}

fn sched_config() -> SchedConfig {
    let cfg = crate::config::load().unwrap_or_default();
    SchedConfig {
        enabled: crate::config::flag(&cfg, "BACKUP_ENABLED", true),
        interval_hours: cfg
            .get("BACKUP_INTERVAL_HOURS")
            .and_then(|v| v.parse().ok())
            .filter(|h| *h >= 1)
            .unwrap_or(DEFAULT_INTERVAL_HOURS),
        retention: cfg
            .get("BACKUP_RETENTION_COUNT")
            .and_then(|v| v.parse().ok())
            .unwrap_or(DEFAULT_RETENTION),
        // Leer/ungueltig → Default 3 Uhr; "-1"/"any" → keine feste Stunde.
        hour: match cfg.get("BACKUP_HOUR").map(|s| s.trim()) {
            Some("-1") | Some("any") => None,
            Some(v) => v.parse().ok().filter(|h| *h < 24).or(Some(DEFAULT_HOUR)),
            None => Some(DEFAULT_HOUR),
        },
    }
}

/// Ist ein automatisches Backup faellig?
/// - `last_age_secs`: Alter des neuesten Backups (None = keins vorhanden)
/// - Intervalle ab 24 h laufen nur zur Stunde `hour` — ausser es ist schon
///   ueberfaellig (Rechner war zur Stunde aus/schlafend: dann sofort).
/// - 1 h Toleranz, damit ein Tick kurz vor der Marke nicht einen Tag kostet.
pub fn backup_due(last_age_secs: Option<u64>, interval_hours: u64, hour: Option<u32>, now_hour: u32) -> bool {
    let Some(age) = last_age_secs else { return true };
    let interval = interval_hours.max(1) * 3600;
    if age >= interval + 24 * 3600 {
        return true; // ueberfaellig
    }
    let due = age + 3600 >= interval;
    match hour {
        Some(h) if interval_hours >= 24 => due && now_hour == h,
        _ => due,
    }
}

fn latest_age_secs() -> Option<u64> {
    let newest = backup_files().into_iter().map(|(_, t)| t).max()?;
    Some(
        SystemTime::now()
            .duration_since(newest)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    )
}

/// Hintergrund-Scheduler fuer automatische Backups. Schlaegt ein Backup fehl,
/// gibt es ein Error-Event und eine System-Notification.
pub async fn scheduler_loop(app: tauri::AppHandle) {
    use tauri_plugin_notification::NotificationExt;
    let mut tick = tokio::time::interval(SCHED_TICK);
    // Erstes tick() feuert sofort — ueberspringen, App-Start soll nicht
    // gleich pb anhalten.
    tick.tick().await;
    let mut last_failure_notified = false;
    loop {
        tick.tick().await;
        let c = sched_config();
        if !c.enabled {
            continue;
        }
        if !backup_due(latest_age_secs(), c.interval_hours, c.hour, Local::now().hour()) {
            continue;
        }
        match create().await {
            Ok(b) => {
                log::info!("Auto-Backup: {}", b.filename);
                last_failure_notified = false;
                if let Err(e) = prune(c.retention) {
                    log::warn!("Prune fehlgeschlagen: {e}");
                }
            }
            Err(e) => {
                log::warn!("Auto-Backup fehlgeschlagen: {e}");
                crate::events::error(format!("Automatisches Backup fehlgeschlagen: {e}")).await;
                // Nicht alle 10 Minuten erneut benachrichtigen.
                if !last_failure_notified {
                    last_failure_notified = true;
                    let _ = app
                        .notification()
                        .builder()
                        .title("RAPPORT Server — Backup fehlgeschlagen")
                        .body("Das automatische Backup ist fehlgeschlagen. Details im Ereignis-Log.")
                        .show();
                }
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct RestoreResult {
    pub restored_from: String,
    pub safety_backup: String,
    pub finished_at_iso: String,
    pub restore_log: String,
}

/// Shell-Skript im Restore-Container: Archiv erst puffern und pruefen
/// (lesbar? nur `pb/pb_data/...`? kein `..`? keine Sym-/Hardlinks?), ERST DANN alte Daten loeschen
/// und entpacken. Ein kaputtes Archiv laesst die Daten also unangetastet.
const RESTORE_SCRIPT: &str = "set -e; \
cat > /tmp/restore.tgz; \
tar -tzf /tmp/restore.tgz > /tmp/restore.list; \
if grep -Ev '^pb/pb_data(/|$)' /tmp/restore.list | grep -q .; then echo 'Archiv enthaelt Pfade ausserhalb pb/pb_data' >&2; exit 3; fi; \
if grep -Eq '(^|/)\\.\\.(/|$)' /tmp/restore.list; then echo 'Archiv enthaelt ..-Pfade' >&2; exit 3; fi; \
if tar -tvzf /tmp/restore.tgz | grep -Eq '^[lh]'; then echo 'Archiv enthaelt Links' >&2; exit 3; fi; \
rm -rf /pb/pb_data/* /pb/pb_data/.[!.]* 2>/dev/null || true; \
tar -xzf /tmp/restore.tgz -C /; \
rm -f /tmp/restore.tgz /tmp/restore.list";

/// Spielt einen Snapshot zurueck.
/// Workflow:
///   1. Sicherheits-Backup vom aktuellen Zustand (`…-vor-restore.tar.gz`)
///   2. Kompletten Stack stoppen (PocketBase darf die SQLite-Datei nicht offen
///      halten, waehrend wir sie ueberschreiben)
///   3. Frischer Container auf demselben Volume prueft das Archiv und
///      extrahiert es (`docker compose run` — kein laufender Container noetig)
///   4. Stack wieder starten
pub async fn restore(filename: &str) -> Result<RestoreResult, String> {
    // Pfad-Traversal-Schutz: nur exakt unsere Dateinamen.
    if !is_valid_backup_name(filename) {
        return Err("ungueltiger Dateiname".into());
    }
    let dir = paths::backups_dir();
    let path: PathBuf = dir.join(filename);
    if !path.is_file() {
        return Err(format!("Backup nicht gefunden: {filename}"));
    }
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);

    let _guard = op_lock().lock().await;

    // 1) Safety-Backup zuerst — wenn das schiefgeht, gar nicht erst restoren.
    crate::events::info(format!("Restore von {filename} startet — erst Safety-Backup")).await;
    let safety = create_unlocked(Some("vor-restore"))
        .await
        .map_err(|e| format!("Safety-Backup vor Restore fehlgeschlagen: {e}"))?;

    // 2) Kompletten Stack stoppen.
    crate::events::info("Restore: stoppe Stack (pb + app)").await;
    let stop_out = compose_out(&["stop", "pb", "app"]).await?;
    if !stop_out.status.success() {
        return Err(format!(
            "compose stop fehlgeschlagen: {}",
            String::from_utf8_lossy(&stop_out.stderr).trim()
        ));
    }

    // 3) Archiv in einen kurzlebigen Container streamen.
    crate::events::info(format!("Restore: spiele Snapshot {filename} ein ({} KB)", size / 1024)).await;
    let extract = run_restore_container(&path).await;

    // 4) Stack in jedem Fall wieder hoch.
    crate::events::info("Restore: starte Stack wieder").await;
    let up = compose_out(&["up", "-d"]).await;

    let restore_log = match extract {
        Ok(log) => log,
        Err(e) => {
            return Err(format!(
                "Restore fehlgeschlagen (Stack wieder gestartet, Safety-Backup: {}): {e}",
                safety.filename
            ));
        }
    };
    match up {
        Ok(o) if o.status.success() => {}
        Ok(o) => {
            return Err(format!(
                "compose up nach Restore fehlgeschlagen: {}",
                String::from_utf8_lossy(&o.stderr).trim()
            ))
        }
        Err(e) => return Err(format!("compose up nach Restore: {e}")),
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

async fn run_restore_container(archive: &Path) -> Result<String, String> {
    let mut file = tokio::fs::File::open(archive)
        .await
        .map_err(|e| format!("open archive: {e}"))?;
    let mut child = Command::new("docker")
        .current_dir(services::compose_dir())
        .args([
            "compose", "run", "--rm", "-T", "--no-deps", "--entrypoint", "sh", "pb", "-c",
            RESTORE_SCRIPT,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("spawn restore-container: {e}"))?;
    {
        let mut stdin = child.stdin.take().ok_or_else(|| "no stdin".to_string())?;
        tokio::io::copy(&mut file, &mut stdin)
            .await
            .map_err(|e| format!("write archive to restore-container: {e}"))?;
        // stdin droppen → EOF fuer `cat`.
    }
    let output = child
        .wait_with_output()
        .await
        .map_err(|e| format!("wait restore-container: {e}"))?;
    let log = format!(
        "{}\n--- stderr ---\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !output.status.success() {
        return Err(log);
    }
    Ok(log)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_name_validation() {
        assert!(is_valid_backup_name("rapport-20261120-030000.tar.gz"));
        assert!(is_valid_backup_name("rapport-20261120-030000-vor-restore-2.tar.gz"));
        assert!(!is_valid_backup_name("rapport-.tar.gz"));
        assert!(!is_valid_backup_name("../rapport-1.tar.gz"));
        assert!(!is_valid_backup_name("rapport-../../etc.tar.gz"));
        assert!(!is_valid_backup_name("rapport-a/b.tar.gz"));
        assert!(!is_valid_backup_name("rapport-a\\b.tar.gz"));
        assert!(!is_valid_backup_name("rapport-a.b.tar.gz"));
        assert!(!is_valid_backup_name("rapport-1.tar.gz.partial"));
        assert!(!is_valid_backup_name("diagnose-1.txt"));
        assert!(!is_valid_backup_name("rapport-1\0.tar.gz"));
    }

    #[test]
    fn unique_filenames() {
        let dir = std::env::temp_dir().join(format!("rapport-bk-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = next_filename(&dir, "20261120-030000", None);
        assert_eq!(a, "rapport-20261120-030000.tar.gz");
        std::fs::write(dir.join(&a), b"x").unwrap();
        let b = next_filename(&dir, "20261120-030000", None);
        assert_eq!(b, "rapport-20261120-030000-2.tar.gz");
        let c = next_filename(&dir, "20261120-030000", Some("vor-update"));
        assert_eq!(c, "rapport-20261120-030000-vor-update.tar.gz");
        assert!(is_valid_backup_name(&b) && is_valid_backup_name(&c));
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn info(name: &str) -> BackupInfo {
        BackupInfo { filename: name.into(), created_iso: String::new(), bytes: 1 }
    }

    #[test]
    fn prune_selection() {
        let all: Vec<_> = (0..5).map(|i| info(&format!("rapport-{i}.tar.gz"))).collect();
        assert_eq!(select_for_prune(&all, 3), vec!["rapport-3.tar.gz", "rapport-4.tar.gz"]);
        assert!(select_for_prune(&all, 14).is_empty());
        // keep=0 darf nicht alles loeschen
        assert_eq!(select_for_prune(&all, 0).len(), 4);
    }

    #[test]
    fn schedule() {
        let h = 3600;
        // kein Backup → sofort
        assert!(backup_due(None, 24, Some(3), 15));
        // 23.5 h alt, 3 Uhr → faellig (Toleranz)
        assert!(backup_due(Some(23 * h + 1800), 24, Some(3), 3));
        // 23.5 h alt, aber falsche Stunde → nicht
        assert!(!backup_due(Some(23 * h + 1800), 24, Some(3), 4));
        // 12 h alt → nicht
        assert!(!backup_due(Some(12 * h), 24, Some(3), 3));
        // ueberfaellig (48 h) → unabhaengig von der Stunde
        assert!(backup_due(Some(48 * h), 24, Some(3), 15));
        // ohne feste Stunde → nach Intervall
        assert!(backup_due(Some(24 * h), 24, None, 15));
        // kurze Intervalle ignorieren die Stunde
        assert!(backup_due(Some(6 * h), 6, Some(3), 15));
    }
}
