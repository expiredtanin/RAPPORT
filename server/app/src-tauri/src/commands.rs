//! Tauri-Commands.
//!
//! Schmaler Layer zwischen WebView-Frontend und Supervisor. Jeder Command
//! ist `async`, sperrt den Supervisor-Mutex moeglichst kurz und gibt das
//! Ergebnis als JSON-serialisierbare Struktur zurueck.

use crate::backup::{self, BackupInfo, RestoreResult};
use crate::config;
use crate::container_update::{self, ApplyResult, CheckResult};
use crate::disk::{self, DiskUsage};
use crate::events::{self, Event};
use crate::firstaid::{self, DiagnoseResult, RecreateResult, ResetResult};
use crate::setup::{self, InstallResult, SetupStatus};
use crate::stats::{self, ContainerStats};
use crate::supervisor::ServiceStatus;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub async fn list_services(state: State<'_, AppState>) -> Result<Vec<ServiceStatus>, String> {
    // Mit Timeout + Cache — falls Supervisor-Mutex durch lange Operation belegt.
    Ok(crate::supervisor::list_with_timeout(&state.supervisor, 300).await)
}

#[tauri::command]
pub async fn service_status(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<ServiceStatus>, String> {
    let sv = state.supervisor.lock().await;
    Ok(sv.status(&id))
}

#[tauri::command]
pub async fn service_logs(state: State<'_, AppState>, id: String) -> Result<Vec<String>, String> {
    let sv = state.supervisor.lock().await;
    Ok(sv.logs(&id).await)
}

#[tauri::command]
pub async fn start_service(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut sv = state.supervisor.lock().await;
    sv.start(&id).await
}

#[tauri::command]
pub async fn stop_service(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut sv = state.supervisor.lock().await;
    sv.stop(&id).await
}

#[tauri::command]
pub async fn restart_service(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut sv = state.supervisor.lock().await;
    sv.restart(&id).await
}

#[tauri::command]
pub async fn restart_all(state: State<'_, AppState>) -> Result<(), String> {
    crate::supervisor::Supervisor::restart_all_managed(state.supervisor.clone()).await
}

#[tauri::command]
pub async fn start_all(state: State<'_, AppState>) -> Result<(), String> {
    crate::supervisor::Supervisor::start_all_managed(state.supervisor.clone()).await
}

#[tauri::command]
pub async fn stop_all(state: State<'_, AppState>) -> Result<(), String> {
    crate::supervisor::Supervisor::stop_all_managed(state.supervisor.clone()).await
}

#[tauri::command]
pub async fn get_config() -> Result<config::EnvMap, String> {
    let mut map = config::load()?;
    config::ensure_defaults(&mut map);
    Ok(map)
}

#[tauri::command]
pub async fn set_config_value(key: String, value: String) -> Result<(), String> {
    let mut map = config::load()?;
    map.insert(key, value);
    config::save(&map)
}

#[tauri::command]
pub async fn backup_now() -> Result<BackupInfo, String> {
    let info = backup::create().await?;
    // Direkt nach manuellem Backup auch prunen (sonst macht's nur der Scheduler).
    let retention = config::load()
        .ok()
        .and_then(|c| c.get("BACKUP_RETENTION_COUNT").cloned())
        .and_then(|v| v.parse().ok())
        .unwrap_or(7);
    let _ = backup::prune(retention);
    Ok(info)
}

#[tauri::command]
pub async fn list_backups() -> Result<Vec<BackupInfo>, String> {
    Ok(backup::list())
}

#[tauri::command]
pub async fn restore_backup(filename: String) -> Result<RestoreResult, String> {
    backup::restore(&filename).await
}

#[tauri::command]
pub async fn check_container_updates() -> Result<CheckResult, String> {
    container_update::check().await
}

#[tauri::command]
pub async fn apply_container_updates() -> Result<ApplyResult, String> {
    container_update::apply().await
}

#[tauri::command]
pub async fn list_events() -> Result<Vec<Event>, String> {
    Ok(events::list().await)
}

#[tauri::command]
pub async fn list_stats() -> Result<Vec<ContainerStats>, String> {
    Ok(stats::collect().await)
}

#[tauri::command]
pub async fn disk_usage() -> Result<DiskUsage, String> {
    Ok(disk::collect().await)
}

#[tauri::command]
pub async fn firstaid_recreate() -> Result<RecreateResult, String> {
    firstaid::recreate_containers().await
}

#[tauri::command]
pub async fn firstaid_reset_data() -> Result<ResetResult, String> {
    firstaid::reset_data().await
}

#[tauri::command]
pub async fn firstaid_diagnose() -> Result<DiagnoseResult, String> {
    firstaid::diagnose_bundle().await
}

#[tauri::command]
pub async fn setup_status() -> Result<SetupStatus, String> {
    Ok(setup::status().await)
}

#[tauri::command]
pub async fn setup_install(state: State<'_, AppState>) -> Result<InstallResult, String> {
    // Wir starten die Container hier NICHT automatisch — der User soll bewusst
    // "Alle starten" klicken sobald das Dashboard erscheint. Beim spaeteren
    // App-Reboot (Daemon schon hochgefahren) feuert die AUTO_START-Logik in
    // lib.rs::setup() ganz normal.
    let _ = state; // state nur fuer eventual zukuenftige Verwendung
    setup::install_and_start().await
}
