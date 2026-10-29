//! Container-Update-Modul.
//!
//! Workflow:
//!   1. `docker compose pull` zieht Image-Updates
//!   2. Image-IDs vorher/nachher vergleichen — was hat sich geaendert?
//!   3. Wenn was geaendert: erst Backup (tar.gz von /pb/pb_data), dann
//!      `docker compose up -d` — Compose erkennt selbst was neu erstellt werden
//!      muss anhand veraenderter Image-IDs.
//!
//! Scheduler tickt `CONTAINER_AUTOUPDATE_INTERVAL_HOURS` (Default 24h).
//! `CONTAINER_AUTOUPDATE_ENABLED=false` schaltet den Auto-Teil ab — manuelles
//! `check_now` / `apply_now` geht trotzdem.

use crate::{backup, services};
use chrono::Local;
use serde::Serialize;
use std::collections::HashMap;
use std::time::Duration;
use tokio::process::Command;

pub const SCHED_TICK: Duration = Duration::from_secs(60 * 60);

const DEFAULT_INTERVAL_HOURS: u64 = 24;

#[derive(Debug, Clone, Serialize)]
pub struct UpdateAvailable {
    pub service: String,
    pub image: String,
    pub old_id: String,
    pub new_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CheckResult {
    pub checked_at_iso: String,
    pub updates: Vec<UpdateAvailable>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApplyResult {
    pub applied_at_iso: String,
    pub updated_services: Vec<String>,
    pub backup_filename: Option<String>,
    pub recreate_log: String,
}

#[derive(Debug, Clone, Serialize, Default)]
struct ImageRow {
    service: String,
    image: String,
    id: String,
}

/// Liefert die Image-ID pro Compose-Service.
async fn snapshot_images() -> Result<HashMap<String, ImageRow>, String> {
    let out = Command::new("docker")
        .current_dir(services::compose_dir())
        .args(["compose", "images", "--format", "json"])
        .output()
        .await
        .map_err(|e| format!("spawn: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "compose images: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut map = HashMap::new();
    // Compose kann ein JSON-Array ODER JSON-Lines liefern — beide Faelle abfangen.
    if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(&stdout) {
        for v in arr {
            if let Some(row) = parse_row(&v) {
                map.insert(row.service.clone(), row);
            }
        }
    } else {
        for line in stdout.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                if let Some(row) = parse_row(&v) {
                    map.insert(row.service.clone(), row);
                }
            }
        }
    }
    Ok(map)
}

fn parse_row(v: &serde_json::Value) -> Option<ImageRow> {
    let service = v.get("Service").and_then(|x| x.as_str())?.to_string();
    let repo = v.get("Repository").and_then(|x| x.as_str()).unwrap_or("");
    let tag = v.get("Tag").and_then(|x| x.as_str()).unwrap_or("");
    let id = v.get("ID").or_else(|| v.get("ImageId"))
        .and_then(|x| x.as_str()).unwrap_or("").to_string();
    Some(ImageRow {
        service,
        image: format!("{repo}:{tag}"),
        id,
    })
}

/// Pullt alle Compose-Images. Bei `app` (lokal gebaut, nicht in der Registry)
/// kommt ein Fehler — ignorieren wir, das ist erwartet.
async fn compose_pull() -> Result<(), String> {
    let out = Command::new("docker")
        .current_dir(services::compose_dir())
        .args(["compose", "pull", "--ignore-pull-failures"])
        .output()
        .await
        .map_err(|e| format!("spawn: {e}"))?;
    // Auch bei non-zero exit ignorieren wir — solange wir die Image-IDs danach
    // einsammeln koennen, ist alles weitere ableitbar.
    if !out.status.success() {
        log::warn!(
            "compose pull non-zero (oft `app`-Image — egal): {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(())
}

async fn compose_up() -> Result<String, String> {
    let out = Command::new("docker")
        .current_dir(services::compose_dir())
        .args(["compose", "up", "-d"])
        .output()
        .await
        .map_err(|e| format!("spawn: {e}"))?;
    let log = format!(
        "{}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    if !out.status.success() {
        return Err(format!("compose up failed: {log}"));
    }
    Ok(log)
}

/// Prueft auf Image-Updates ohne sie anzuwenden. `docker compose pull` laeuft,
/// danach vergleichen wir die Image-IDs.
pub async fn check() -> Result<CheckResult, String> {
    let before = snapshot_images().await?;
    compose_pull().await?;
    let after = snapshot_images().await?;
    let mut updates = vec![];
    for (svc, new_row) in &after {
        let old_id = before.get(svc).map(|r| r.id.as_str()).unwrap_or("");
        if !new_row.id.is_empty() && old_id != new_row.id {
            updates.push(UpdateAvailable {
                service: svc.clone(),
                image: new_row.image.clone(),
                old_id: old_id.to_string(),
                new_id: new_row.id.clone(),
            });
        }
    }
    Ok(CheckResult {
        checked_at_iso: Local::now().to_rfc3339(),
        updates,
    })
}

/// Pullt + (falls Updates da) Backup + Compose-Up. Liefert was wirklich
/// passiert ist — empty `updated_services` = nichts zu tun.
pub async fn apply() -> Result<ApplyResult, String> {
    let check_res = check().await?;
    if check_res.updates.is_empty() {
        return Ok(ApplyResult {
            applied_at_iso: Local::now().to_rfc3339(),
            updated_services: vec![],
            backup_filename: None,
            recreate_log: "Keine Image-Updates — nichts zu tun.".into(),
        });
    }

    // Pre-Backup. Wenn das schiefgeht, brechen wir ab — keine Updates ohne Safety-Net.
    log::info!(
        "Container-Update: Backup vor Recreate ({} Services updates)",
        check_res.updates.len()
    );
    let backup = backup::create()
        .await
        .map_err(|e| format!("Pre-Backup fehlgeschlagen, Update abgebrochen: {e}"))?;

    let log = compose_up().await?;

    let services_list: Vec<String> =
        check_res.updates.iter().map(|u| u.service.clone()).collect();
    crate::events::info(format!(
        "Container-Update angewendet auf {} (Backup: {})",
        services_list.join(", "),
        backup.filename
    ))
    .await;

    Ok(ApplyResult {
        applied_at_iso: Local::now().to_rfc3339(),
        updated_services: services_list,
        backup_filename: Some(backup.filename),
        recreate_log: log,
    })
}

fn config_values() -> (bool, u64) {
    let cfg = crate::config::load().unwrap_or_default();
    let enabled = cfg
        .get("CONTAINER_AUTOUPDATE_ENABLED")
        .map(|v| v != "false" && v != "0")
        .unwrap_or(false);
    let interval = cfg
        .get("CONTAINER_AUTOUPDATE_INTERVAL_HOURS")
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_INTERVAL_HOURS);
    (enabled, interval)
}

pub async fn scheduler_loop() {
    let mut tick = tokio::time::interval(SCHED_TICK);
    tick.tick().await; // initial tick verwerfen (siehe backup::scheduler_loop)
    let mut last_check: Option<chrono::DateTime<Local>> = None;
    loop {
        tick.tick().await;
        let (enabled, interval) = config_values();
        if !enabled {
            continue;
        }
        let now = Local::now();
        let due = match last_check {
            None => true,
            Some(t) => now.signed_duration_since(t).num_hours() >= interval as i64,
        };
        if !due {
            continue;
        }
        last_check = Some(now);
        match apply().await {
            Ok(res) if res.updated_services.is_empty() => {
                log::info!("Auto-Update: keine neuen Images");
            }
            Ok(res) => {
                log::info!(
                    "Auto-Update angewendet auf: {} (Backup: {:?})",
                    res.updated_services.join(", "),
                    res.backup_filename
                );
            }
            Err(e) => log::warn!("Auto-Update fehlgeschlagen: {e}"),
        }
    }
}
