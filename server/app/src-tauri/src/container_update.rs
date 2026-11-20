//! Container-Update-Modul.
//!
//! Workflow:
//!   1. `docker compose pull` zieht Image-Updates
//!   2. Pro Container: laeuft er mit der Image-ID, auf die seine Referenz
//!      jetzt lokal zeigt? Wenn nicht → Update verfuegbar.
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

/// Ein Container des Stacks: Service, konfigurierte Image-Referenz und die
/// Image-ID, mit der der Container tatsaechlich laeuft.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ContainerImage {
    service: String,
    image_ref: String,
    running_id: String,
}

async fn docker(args: &[&str]) -> Result<String, String> {
    let out = Command::new("docker")
        .current_dir(services::compose_dir())
        .args(args)
        .output()
        .await
        .map_err(|e| format!("spawn docker {args:?}: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "docker {args:?}: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Liest pro Service die Image-Referenz und die Image-ID des bestehenden
/// Containers. Frueher wurde `compose images` vor/nach dem Pull verglichen —
/// das liefert aber die Image-ID des CONTAINERS, die sich durch einen Pull
/// nicht aendert; ausserdem fand "Pruefen" + "Anwenden" nichts mehr, weil
/// beim Anwenden schon alles gezogen war.
async fn container_images() -> Result<Vec<ContainerImage>, String> {
    let ps = docker(&["compose", "ps", "-a", "--format", "json"]).await?;
    let rows = crate::supervisor::parse_json_rows(&ps);
    let mut out = Vec::new();
    for v in rows {
        let service = v.get("Service").and_then(|x| x.as_str()).unwrap_or("");
        let image_ref = v.get("Image").and_then(|x| x.as_str()).unwrap_or("");
        let cid = v.get("ID").and_then(|x| x.as_str()).unwrap_or("");
        if service.is_empty() || image_ref.is_empty() || cid.is_empty() {
            continue;
        }
        let running_id = docker(&["inspect", "--format", "{{.Image}}", cid])
            .await
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        out.push(ContainerImage {
            service: service.to_string(),
            image_ref: image_ref.to_string(),
            running_id,
        });
    }
    Ok(out)
}

/// Lokale Image-ID einer Referenz (nach dem Pull = neueste Version).
async fn local_image_id(image_ref: &str) -> Option<String> {
    docker(&["image", "inspect", "--format", "{{.Id}}", image_ref])
        .await
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Reine Vergleichslogik: Update = Container laeuft mit einer anderen
/// Image-ID als die, auf die die Referenz lokal (nach dem Pull) zeigt.
fn diff_updates(
    containers: &[ContainerImage],
    local_ids: &HashMap<String, String>,
) -> Vec<UpdateAvailable> {
    let mut updates: Vec<UpdateAvailable> = containers
        .iter()
        .filter_map(|c| {
            let new_id = local_ids.get(&c.image_ref)?;
            if c.running_id.is_empty() || new_id == &c.running_id {
                return None;
            }
            Some(UpdateAvailable {
                service: c.service.clone(),
                image: c.image_ref.clone(),
                old_id: c.running_id.clone(),
                new_id: new_id.clone(),
            })
        })
        .collect();
    updates.sort_by(|a, b| a.service.cmp(&b.service));
    updates.dedup_by(|a, b| a.service == b.service);
    updates
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

/// Prueft auf Image-Updates ohne sie anzuwenden: `docker compose pull`,
/// danach laufende Container-Image-IDs mit den lokal getaggten vergleichen.
/// Mehrfach aufrufbar — ein vorheriger Pull versteckt keine Updates.
pub async fn check() -> Result<CheckResult, String> {
    compose_pull().await?;
    let containers = container_images().await?;
    let mut local_ids = HashMap::new();
    for c in &containers {
        if !local_ids.contains_key(&c.image_ref) {
            if let Some(id) = local_image_id(&c.image_ref).await {
                local_ids.insert(c.image_ref.clone(), id);
            }
        }
    }
    Ok(CheckResult {
        checked_at_iso: Local::now().to_rfc3339(),
        updates: diff_updates(&containers, &local_ids),
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
    // Lock ueber Backup + Recreate: kein Restore/Backup dazwischen.
    let _guard = backup::op_lock().lock().await;
    let backup = backup::create_unlocked(Some("vor-update"))
        .await
        .map_err(|e| format!("Pre-Backup fehlgeschlagen, Update abgebrochen: {e}"))?;

    let log = compose_up().await?;
    drop(_guard);
    // Aufbewahrung auch hier anwenden, sonst wachsen Pre-Update-Backups an.
    let _ = backup::prune(backup::retention_from_config());

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
    let enabled = crate::config::flag(&cfg, "CONTAINER_AUTOUPDATE_ENABLED", false);
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

#[cfg(test)]
mod tests {
    use super::*;

    fn c(svc: &str, r: &str, id: &str) -> ContainerImage {
        ContainerImage { service: svc.into(), image_ref: r.into(), running_id: id.into() }
    }

    #[test]
    fn diff_detects_only_changed_images() {
        let containers = vec![c("pb", "reg/pb:main", "sha256:old"), c("app", "reg/app:main", "sha256:same")];
        let mut ids = HashMap::new();
        ids.insert("reg/pb:main".to_string(), "sha256:new".to_string());
        ids.insert("reg/app:main".to_string(), "sha256:same".to_string());
        let u = diff_updates(&containers, &ids);
        assert_eq!(u.len(), 1);
        assert_eq!(u[0].service, "pb");
        assert_eq!(u[0].old_id, "sha256:old");
        assert_eq!(u[0].new_id, "sha256:new");
    }

    #[test]
    fn diff_ignores_unknown_refs_and_empty_ids() {
        let containers = vec![c("pb", "reg/pb:main", ""), c("app", "lokal:dev", "sha256:a")];
        let ids = HashMap::new();
        assert!(diff_updates(&containers, &ids).is_empty());
    }
}
