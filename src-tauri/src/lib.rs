use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Listener, Manager,
};

/// Beenden in zwei Schritten, damit entprellte Änderungen nicht verloren gehen: Rust sendet
/// `rapport:quit-requested`, das Frontend schreibt offene Änderungen (storage/adapter.ts) und
/// antwortet mit `rapport:quit-ready`; erst dann wird beendet.
#[derive(Default)]
struct QuitState {
    /// Beenden läuft: Fenster-Schliessen versteckt nicht mehr, die Anfrage geht nur einmal raus.
    requested: AtomicBool,
    /// Frontend hat gespeichert (oder Timeout): ExitRequested nicht mehr abfangen.
    ready: AtomicBool,
}

/// Höchstens so lange auf das Frontend warten (hängt es oder ist es nicht geladen, wird trotzdem beendet).
const QUIT_TIMEOUT: Duration = Duration::from_secs(3);

fn request_quit(app: &tauri::AppHandle) {
    if app
        .state::<QuitState>()
        .requested
        .swap(true, Ordering::SeqCst)
    {
        return;
    }
    if app.emit("rapport:quit-requested", ()).is_err() {
        finish_quit(app);
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(QUIT_TIMEOUT);
        finish_quit(&app);
    });
}

fn finish_quit(app: &tauri::AppHandle) {
    app.state::<QuitState>().ready.store(true, Ordering::SeqCst);
    app.exit(0);
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(QuitState::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Datenordner (storage/file-adapter.ts): Ordnerwahl per Dialog, Zugriff nur auf den gewählten Ordner.
        // Der Dialog erweitert den fs-Scope zur Laufzeit; persisted-scope behält ihn über Neustarts (muss nach fs stehen).
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !window.state::<QuitState>().requested.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let show = MenuItem::with_id(app, "show", "Rapport öffnen", true, None::<&str>)?;
            let dashboard =
                MenuItem::with_id(app, "nav:dashboard", "Dashboard", true, None::<&str>)?;
            let time = MenuItem::with_id(app, "nav:time", "Zeiterfassung", true, None::<&str>)?;
            let projects = MenuItem::with_id(app, "nav:projects", "Projekte", true, None::<&str>)?;
            let accounting =
                MenuItem::with_id(app, "nav:buchhaltung", "Buchhaltung", true, None::<&str>)?;
            let settings =
                MenuItem::with_id(app, "nav:settings", "Einstellungen", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Beenden", true, Some("Cmd+Q"))?;

            let menu = Menu::with_items(
                app,
                &[
                    &show,
                    &sep1,
                    &dashboard,
                    &time,
                    &projects,
                    &accounting,
                    &settings,
                    &sep2,
                    &quit,
                ],
            )?;

            // Das Standard-„Quit“ im macOS-App-Menü (NSApp terminate:) beendet sofort, ohne ExitRequested.
            // Ersetzt durch einen eigenen Eintrag mit derselben id wie im Tray — der Handler unten
            // bekommt Menü-Events aus beiden Menüs.
            #[cfg(target_os = "macos")]
            {
                let app_menu = Menu::default(app.handle())?;
                if let Some(tauri::menu::MenuItemKind::Submenu(first)) =
                    app_menu.items()?.into_iter().next()
                {
                    let count = first.items()?.len();
                    if count > 0 {
                        first.remove_at(count - 1)?;
                    }
                    first.append(&MenuItem::with_id(
                        app,
                        "quit",
                        "Rapport beenden",
                        true,
                        Some("CmdOrCtrl+Q"),
                    )?)?;
                }
                app.set_menu(app_menu)?;
            }

            let handle = app.handle().clone();
            app.listen("rapport:quit-ready", move |_| finish_quit(&handle));

            // Fehlt das Fenster-Icon (kaputtes Bundle), startet die App trotzdem — nur das Tray-Symbol bleibt leer.
            let mut tray = TrayIconBuilder::with_id("main");
            match app.default_window_icon() {
                Some(icon) => tray = tray.icon(icon.clone()),
                None => log::warn!("Kein Fenster-Icon gefunden, Tray ohne Symbol"),
            }
            let _tray = tray
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "quit" => request_quit(app),
                    id if id.starts_with("nav:") => {
                        show_main_window(app);
                        let view = &id["nav:".len()..];
                        let _ = app.emit("rapport:navigate", view.to_string());
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { code, api, .. } = event {
                // Neustart nach Update: das Frontend speichert selbst vor relaunch() (utils/updater.ts)
                if code == Some(tauri::RESTART_EXIT_CODE)
                    || app.state::<QuitState>().ready.load(Ordering::SeqCst)
                {
                    app.state::<QuitState>()
                        .requested
                        .store(true, Ordering::SeqCst);
                    return;
                }
                api.prevent_exit();
                request_quit(app);
            }
        });
}
