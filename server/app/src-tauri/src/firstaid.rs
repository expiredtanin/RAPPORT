//! Erste-Hilfe-Aktionen fuer den Notfall.
//!
//! Drei destruktive Aktionen mit unterschiedlichem Risiko:
//!   - `recreate_containers` (mild): compose down + up --force-recreate.
//!     Container neu, Volumes bleiben → Daten safe.
//!   - `reset_data` (NUKE): compose down -v + up. Volumes WEG → PocketBase
//!     wird von Grund auf neu initialisiert. Erfordert Pre-Backup.
//!   - `diagnose_bundle`: kein Schaden — sammelt Logs, ps, version, config
//!     (redacted) in eine Text-Datei unter backups/.

use crate::{backup::BackupInfo, paths, services};
use chrono::Local;
use serde::Serialize;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct RecreateResult {
    pub log: String,
    pub finished_at_iso: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResetResult {
    pub safety_backup: BackupInfo,
    pub log: String,
    pub finished_at_iso: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiagnoseResult {
    pub filename: String,
    pub bytes: u64,
}

async fn compose(args: &[&str]) -> Result<String, String> {
    let out = Command::new("docker")
        .current_dir(services::compose_dir())
        .arg("compose")
        .args(args)
        .output()
        .await
        .map_err(|e| format!("spawn: {e}"))?;
    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    if !out.status.success() {
        return Err(format!("compose {args:?} failed: {combined}"));
    }
    Ok(combined)
}

/// Container neu erstellen — Volumes bleiben.
pub async fn recreate_containers() -> Result<RecreateResult, String> {
    crate::events::warn("Erste Hilfe: Container neu erstellen ...").await;
    let _ = compose(&["down"]).await;
    let log = compose(&["up", "-d", "--force-recreate"]).await?;
    crate::events::info("Erste Hilfe: Container neu erstellt").await;
    Ok(RecreateResult {
        log,
        finished_at_iso: Local::now().to_rfc3339(),
    })
}

/// VOLL DESTRUKTIV: Volumes platt + frisches Init.
pub async fn reset_data() -> Result<ResetResult, String> {
    crate::events::warn("Erste Hilfe: DATEN-RESET — erst Safety-Backup").await;
    let safety = crate::backup::create()
        .await
        .map_err(|e| format!("Safety-Backup vor Daten-Reset fehlgeschlagen — Reset abgebrochen: {e}"))?;
    crate::events::warn(format!(
        "Erste Hilfe: stoppe Stack inkl. Volumes (Safety: {})",
        safety.filename
    ))
    .await;
    let _ = compose(&["down", "-v"]).await?;
    let log = compose(&["up", "-d"]).await?;
    crate::events::error(format!(
        "Erste Hilfe: Daten platt gemacht und neu initialisiert (Safety: {})",
        safety.filename
    ))
    .await;
    Ok(ResetResult {
        safety_backup: safety,
        log,
        finished_at_iso: Local::now().to_rfc3339(),
    })
}

/// Sammelt Diagnose-Informationen in eine Text-Datei unter backups/.
pub async fn diagnose_bundle() -> Result<DiagnoseResult, String> {
    paths::ensure_dirs().map_err(|e| format!("ensure_dirs: {e}"))?;
    let stamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let filename = format!("diagnose-{stamp}.txt");
    let path = paths::backups_dir().join(&filename);

    let mut out = String::new();
    out.push_str(&format!("# RAPPORT Server-App Diagnose ({})\n\n", Local::now().to_rfc3339()));

    out.push_str("## docker version\n```\n");
    out.push_str(&run_capture(&["docker", "version"]).await);
    out.push_str("\n```\n\n");

    out.push_str("## docker compose ps -a\n```\n");
    out.push_str(&run_capture(&["docker", "compose", "ps", "-a"]).await);
    out.push_str("\n```\n\n");

    out.push_str("## docker system df\n```\n");
    out.push_str(&run_capture(&["docker", "system", "df"]).await);
    out.push_str("\n```\n\n");

    out.push_str("## config.env (redacted)\n```\n");
    out.push_str(&redacted_config());
    out.push_str("\n```\n\n");

    out.push_str("## App-Events (letzte 100)\n```\n");
    for e in crate::events::list().await {
        out.push_str(&format!("[{}] {}: {}\n", e.ts_iso, e.kind, e.message));
    }
    out.push_str("\n```\n\n");

    out.push_str("## Container-Logs (letzte 50 Zeilen pro Service)\n");
    for svc in crate::services::default_services() {
        out.push_str(&format!("\n### {}\n```\n", svc.id));
        out.push_str(&run_capture(&[
            "docker", "compose", "logs", "--no-color", "--tail", "50", &svc.id,
        ]).await);
        out.push_str("\n```\n");
    }

    std::fs::write(&path, out.as_bytes()).map_err(|e| format!("write {}: {e}", path.display()))?;
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);

    crate::events::info(format!("Diagnose-Bundle: {filename} ({} KB)", bytes / 1024)).await;

    Ok(DiagnoseResult { filename, bytes })
}

async fn run_capture(argv: &[&str]) -> String {
    let mut cmd = Command::new(argv[0]);
    cmd.current_dir(services::compose_dir());
    for a in &argv[1..] {
        cmd.arg(a);
    }
    match cmd.output().await {
        Ok(o) => format!(
            "{}{}",
            String::from_utf8_lossy(&o.stdout),
            String::from_utf8_lossy(&o.stderr)
        ),
        Err(e) => format!("(spawn fehlgeschlagen: {e})"),
    }
}

const REDACT_PREFIXES: &[&str] = &[
    "PB_SUPERUSER_PASSWORD",
    "ADMIN_UI_PASSWORD",
];

fn redacted_config() -> String {
    let map = crate::config::load().unwrap_or_default();
    let mut out = String::new();
    for (k, v) in &map {
        let redacted = REDACT_PREFIXES.iter().any(|p| k.contains(p));
        if redacted {
            out.push_str(&format!("{k}=<REDACTED {} chars>\n", v.len()));
        } else {
            out.push_str(&format!("{k}={v}\n"));
        }
    }
    out
}
