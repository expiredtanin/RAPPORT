//! RAPPORT Server-App — Tauri-Entry-Point.
//!
//! Hier wird der Process-Supervisor initialisiert, in den App-State gehängt,
//! und alle `#[tauri::command]`-Handler registriert.

mod backup;
mod commands;
mod config;
mod container_update;
mod disk;
mod events;
mod firstaid;
mod health;
mod http_server;
mod paths;
mod pb_embed;
mod services;
mod setup;
mod stats;
mod supervisor;

use std::sync::Arc;
use supervisor::Supervisor;
use tauri::Manager;
use tokio::sync::Mutex;

/// Geteilter Supervisor-State über `tauri::State`.
pub struct AppState {
    pub supervisor: Arc<Mutex<Supervisor>>,
}

/// Aggregat-Status fuer die Tray-Icon-Farbe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrayStatus {
    /// keine Services laufen (alle stopped) oder Liste leer
    Off,
    /// alle laufen, niemand error/starting
    Ok,
    /// gemischt: einige laufen, andere stopped/starting (oder noch nicht alle ready)
    Warn,
    /// mind. ein service in error
    Error,
}

fn aggregate_status(statuses: &[supervisor::ServiceStatus]) -> TrayStatus {
    use supervisor::ServiceState as S;
    if statuses.is_empty() {
        return TrayStatus::Off;
    }
    let mut has_error = false;
    let mut has_running = false;
    let mut has_transitioning = false;
    let mut has_stopped = false;
    for s in statuses {
        match s.state {
            S::Error => has_error = true,
            S::Running => has_running = true,
            S::Starting | S::Stopping => has_transitioning = true,
            S::Stopped => has_stopped = true,
        }
    }
    if has_error {
        TrayStatus::Error
    } else if has_running && !has_transitioning && !has_stopped {
        TrayStatus::Ok
    } else if !has_running && !has_transitioning && has_stopped {
        TrayStatus::Off
    } else {
        TrayStatus::Warn
    }
}

/// 44x44 Farb-PNG-Bytes (Pillow-generiert, in `icons/` checked-in).
const TRAY_OFF_PNG: &[u8] = include_bytes!("../icons/tray-off@2x.png");
const TRAY_OK_PNG: &[u8] = include_bytes!("../icons/tray-ok@2x.png");
const TRAY_WARN_PNG: &[u8] = include_bytes!("../icons/tray-warn@2x.png");
const TRAY_ERROR_PNG: &[u8] = include_bytes!("../icons/tray-error@2x.png");

fn set_tray_icon(app: &tauri::AppHandle, status: TrayStatus) {
    let bytes = match status {
        TrayStatus::Off => TRAY_OFF_PNG,
        TrayStatus::Ok => TRAY_OK_PNG,
        TrayStatus::Warn => TRAY_WARN_PNG,
        TrayStatus::Error => TRAY_ERROR_PNG,
    };
    let tooltip = match status {
        TrayStatus::Off => "RAPPORT Server — gestoppt",
        TrayStatus::Ok => "RAPPORT Server — alle Services laufen",
        TrayStatus::Warn => "RAPPORT Server — teilweise gestartet / im Uebergang",
        TrayStatus::Error => "RAPPORT Server — Fehler in mindestens einem Service",
    };
    let Some(tray) = app.tray_by_id("main-tray") else { return };
    if let Ok(image) = tauri::image::Image::from_bytes(bytes) {
        let _ = tray.set_icon(Some(image));
        let _ = tray.set_icon_as_template(false);
    }
    let _ = tray.set_tooltip(Some(tooltip));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_default_env()
        .filter_level(log::LevelFilter::Info)
        .init();

    log::info!("RAPPORT Server-App starting ...");

    // PATH IMMER erweitern (auch wenn ~/.rapport/bin/ noch nicht existiert) —
    // sonst klappt der Auto-Start nach dem Setup-Wizard nicht weil unser
    // Prozess den frisch installierten docker/colima nicht findet.
    let rapport_bin = setup::bin_dir();
    let cur = std::env::var("PATH").unwrap_or_default();
    let new_path = format!("{}:{cur}", rapport_bin.display());
    std::env::set_var("PATH", new_path);
    log::info!("PATH erweitert um {}", rapport_bin.display());

    let supervisor = Arc::new(Mutex::new(Supervisor::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Autostart: macOS legt einen LaunchAgent unter
        // ~/Library/LaunchAgents/com.rapport.server-app.plist an.
        // Beim Login-Launch passen wir `--hidden` mit, damit das Fenster
        // direkt im Tray landet (kein Popup im Login-Flow).
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .manage(AppState {
            supervisor: supervisor.clone(),
        })
        .setup(move |app| {
            // App-Data-Verzeichnisse (pb-data-Volume-Mount, logs, backups) anlegen.
            if let Err(e) = paths::ensure_dirs() {
                log::error!("ensure_dirs: {e}");
            }

            // `--hidden` aus dem Login-Launch: Fenster sofort verstecken,
            // App lebt nur im Tray weiter.
            let launched_hidden = std::env::args().any(|a| a == "--hidden");
            if launched_hidden {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }

            // Compose-Verzeichnis aufloesen (kommt aus config.env oder
            // Auto-Detect-Reihe). Ohne das gibt's nichts zu supervisen.
            let compose_override = config::load()
                .ok()
                .and_then(|c| c.get("COMPOSE_DIR").cloned());
            match services::init_compose_dir(compose_override) {
                Ok(p) => log::info!("Compose-Dir: {}", p.display()),
                Err(e) => log::error!("Compose-Dir nicht gefunden: {e}"),
            }

            // config.env vorhanden? Sonst Defaults generieren und persistieren.
            // Sonst landen Template-Platzhalter ({PB_SUPERUSER_PASSWORD}) literal
            // in den Container-Envs.
            match config::load() {
                Ok(mut map) => {
                    let before = map.len();
                    config::ensure_defaults(&mut map);
                    if map.len() != before {
                        if let Err(e) = config::save(&map) {
                            log::error!("config save: {e}");
                        } else {
                            log::info!("Initialized config.env with defaults");
                        }
                    }
                }
                Err(e) => log::error!("config load: {e}"),
            }

            // Auto-register alle Services beim Start (noch ohne sie zu starten).
            let supervisor_clone = supervisor.clone();
            let auto_start_containers = config::load()
                .ok()
                .and_then(|c| c.get("AUTO_START_CONTAINERS_ON_LAUNCH").cloned())
                .map(|v| v == "true" || v == "1")
                .unwrap_or(false);
            tauri::async_runtime::spawn(async move {
                let mut sv = supervisor_clone.lock().await;
                let n = services::default_services().len();
                for service_def in services::default_services() {
                    sv.register(service_def);
                }
                let how = if launched_hidden { " (hidden launch)" } else { "" };
                events::info(format!(
                    "RAPPORT Server-App gestartet{how} — {n} Services registriert"
                )).await;
                drop(sv);
                if auto_start_containers {
                    // Nur autostart wenn Daemon erreichbar ist — sonst landen
                    // alle Services in Error, Auto-Recovery spinnt nutzlos und
                    // der Setup-Wizard kommt nie zum Zug.
                    let daemon_ok = tokio::process::Command::new("docker")
                        .arg("info")
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .status()
                        .await
                        .map(|s| s.success())
                        .unwrap_or(false);
                    if daemon_ok {
                        events::info("Auto-Start: Container werden hochgefahren ...").await;
                        if let Err(e) = supervisor::Supervisor::start_all_managed(supervisor_clone.clone()).await {
                            events::warn(format!("Auto-Start fehlgeschlagen: {e}")).await;
                        }
                    } else {
                        events::info("Auto-Start uebersprungen — Docker-Daemon nicht erreichbar (Setup noetig?)").await;
                    }
                }
            });

            // Pre-pull aller Compose-Images im Hintergrund. Erste Klicks
            // sollen nicht hinter einem 150-MB-Pull haengen bleiben.
            tauri::async_runtime::spawn(async move {
                events::info("Pre-pull Docker-Images gestartet").await;
                let out = tokio::process::Command::new("docker")
                    .current_dir(services::compose_dir())
                    .args(["compose", "pull"])
                    .output()
                    .await;
                match out {
                    Ok(o) if o.status.success() => events::info("Pre-pull fertig").await,
                    Ok(o) => {
                        events::warn(format!(
                            "Pre-pull mit Fehlern: {}",
                            String::from_utf8_lossy(&o.stderr).trim().chars().take(200).collect::<String>()
                        )).await;
                    }
                    Err(e) => events::warn(format!("Pre-pull konnte nicht starten: {e}")).await,
                }
            });

            // Backup-Scheduler — pg_dumpall alle BACKUP_INTERVAL_HOURS Stunden.
            tauri::async_runtime::spawn(async move {
                backup::scheduler_loop().await;
            });

            // Container-Update-Scheduler — alle CONTAINER_AUTOUPDATE_INTERVAL_HOURS:
            // docker compose pull + (falls Updates) Backup + Compose-Up.
            tauri::async_runtime::spawn(async move {
                container_update::scheduler_loop().await;
            });

            // Health-Tick-Loop: alle 2s State aus compose ps, daraus:
            //   - Tray-Icon-Farbe (gruen/gelb/rot)
            //   - macOS-Notification fuer NEU in Error gerutschte Services
            let supervisor_for_health = supervisor.clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_notification::NotificationExt;
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));
                let mut last_state: Option<TrayStatus> = None;
                loop {
                    interval.tick().await;
                    let mut sv = supervisor_for_health.lock().await;
                    let newly_errored = sv.tick_health().await;
                    let agg = aggregate_status(&sv.list());
                    // Display-Names holen bevor wir den Lock abgeben.
                    let error_titles: Vec<(String, String)> = newly_errored
                        .iter()
                        .map(|id| (id.clone(), sv.display_name(id).unwrap_or_else(|| id.clone())))
                        .collect();
                    drop(sv);

                    if Some(agg) != last_state {
                        set_tray_icon(&app_handle, agg);
                        last_state = Some(agg);
                    }
                    for (id, name) in error_titles {
                        events::error(format!("Service {name} ist in den Fehler-State gewechselt")).await;
                        let _ = app_handle
                            .notification()
                            .builder()
                            .title("RAPPORT Server — Fehler")
                            .body(format!("{name} ({id}) ist auf 'unhealthy'/'restarting'."))
                            .show();
                    }
                }
            });

            // Auto-Recovery-Loop: alle 15s pruefen ob Services in Error sind die
            // jetzt einen Restart-Versuch bekommen sollen (mit exponential backoff).
            let supervisor_for_recovery = supervisor.clone();
            let app_handle_for_recovery = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_notification::NotificationExt;
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(15));
                interval.tick().await; // initial tick verwerfen
                loop {
                    interval.tick().await;
                    let cfg = config::load().unwrap_or_default();
                    let enabled = cfg
                        .get("AUTO_RECOVERY_ENABLED")
                        .map(|v| v != "false" && v != "0")
                        .unwrap_or(true);
                    if !enabled {
                        continue;
                    }
                    let base_delay = std::time::Duration::from_secs(
                        cfg.get("AUTO_RECOVERY_BASE_DELAY_SECONDS")
                            .and_then(|v| v.parse().ok())
                            .unwrap_or(60),
                    );
                    let max_attempts: u32 = cfg
                        .get("AUTO_RECOVERY_MAX_ATTEMPTS")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(5);

                    // Wenn der Daemon gerade aus ist (Wizard noch nicht durch),
                    // gar nicht erst versuchen — sonst pumpen wir die Versuchs-
                    // zaehler hoch und geben spaeter auf wenn's eigentlich
                    // ginge.
                    let daemon_ok = tokio::process::Command::new("docker")
                        .arg("info")
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .status()
                        .await
                        .map(|s| s.success())
                        .unwrap_or(false);
                    if !daemon_ok {
                        continue;
                    }

                    let mut sv = supervisor_for_recovery.lock().await;
                    let report = sv.recovery_candidates(max_attempts, base_delay);
                    drop(sv);

                    for id in &report.to_restart {
                        events::warn(format!("Auto-Recovery: Restart-Versuch fuer {id}")).await;
                        let mut sv = supervisor_for_recovery.lock().await;
                        let display = sv.display_name(id).unwrap_or_else(|| id.clone());
                        if let Err(e) = sv.restart(id).await {
                            events::warn(format!(
                                "Auto-Recovery {display}: {e}"
                            )).await;
                        }
                    }
                    for id in &report.maxed_out {
                        events::error(format!("Auto-Recovery aufgegeben fuer {id} — manueller Eingriff noetig")).await;
                        let sv = supervisor_for_recovery.lock().await;
                        let display = sv.display_name(id).unwrap_or_else(|| id.clone());
                        drop(sv);
                        let _ = app_handle_for_recovery
                            .notification()
                            .builder()
                            .title("RAPPORT Server — Auto-Recovery aufgegeben")
                            .body(format!(
                                "{display} ({id}) crasht wiederholt. Bitte manuell pruefen."
                            ))
                            .show();
                    }
                }
            });

            // HTTP-Admin-WebUI (LAN-Zugriff fuer headless Mac Mini).
            let supervisor_for_http = supervisor.clone();
            let static_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("dist");
            tauri::async_runtime::spawn(async move {
                let cfg = config::load().unwrap_or_default();
                let bind = cfg
                    .get("ADMIN_UI_BIND")
                    .cloned()
                    .unwrap_or_else(|| "127.0.0.1".into());
                let port: u16 = cfg
                    .get("ADMIN_UI_PORT")
                    .and_then(|p| p.parse().ok())
                    .unwrap_or(9090);
                let password = cfg
                    .get("ADMIN_UI_PASSWORD")
                    .cloned()
                    .unwrap_or_default();
                let tls = cfg
                    .get("ADMIN_UI_TLS")
                    .map(|v| v != "false" && v != "0")
                    .unwrap_or(true);
                if password.is_empty() {
                    log::warn!("ADMIN_UI_PASSWORD leer — WebUI nicht gestartet");
                    return;
                }
                if let Err(e) = http_server::serve(
                    bind, port, password, tls, supervisor_for_http, static_dir,
                )
                .await
                {
                    log::error!("http_server: {e}");
                }
            });

            // Tray-Icon mit Show/Quit-Menue. Fenster schliessen reduziert in
            // den Tray (Container laufen weiter). Quit aus dem Tray beendet
            // die App tatsaechlich.
            #[cfg(desktop)]
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};

                let show_item = MenuItem::with_id(app, "show", "Show Dashboard", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit", "Quit RAPPORT Server", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

                let _ = TrayIconBuilder::with_id("main-tray")
                    .tooltip("RAPPORT Server")
                    .icon(app.default_window_icon().unwrap().clone())
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                            if let Some(window) = tray.app_handle().get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    })
                    .build(app)?;
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Fenster schliessen → in den Tray verstecken statt App killen.
            // So laufen die Docker-Container weiter, der HTTP-WebUI-Server
            // bleibt erreichbar, und der Health-Tick-Loop tickt weiter.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
            // PocketBase-Embed (falls sichtbar) an neue Fenstergroesse anpassen.
            if let tauri::WindowEvent::Resized(_) = event {
                pb_embed::reposition_on_resize(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_services,
            commands::start_service,
            commands::stop_service,
            commands::restart_service,
            commands::start_all,
            commands::stop_all,
            commands::restart_all,
            commands::service_logs,
            commands::service_status,
            commands::backup_now,
            commands::list_backups,
            commands::restore_backup,
            commands::check_container_updates,
            commands::apply_container_updates,
            commands::list_events,
            commands::list_stats,
            commands::disk_usage,
            commands::firstaid_recreate,
            commands::firstaid_reset_data,
            commands::firstaid_diagnose,
            commands::setup_status,
            commands::setup_install,
            commands::get_config,
            commands::set_config_value,
            pb_embed::show_pocketbase_embed,
            pb_embed::hide_pocketbase_embed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
