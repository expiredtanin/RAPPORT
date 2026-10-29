//! Eingebettete PocketBase-Admin-UI: ein zusaetzliches natives Child-Webview
//! im selben Fenster statt eines eigenen Fensters oder eines iframes.
//!
//! PocketBase sendet "Content-Security-Policy: frame-ancestors 'none'" — ein
//! iframe waere komplett blockiert. Ein natives Child-Webview (Tauris
//! `Window::add_child`, Feature "unstable") ist keine Frame-Einbettung im
//! DOM-Sinn, sondern eine zweite WKWebView-Instanz im selben NSWindow, und
//! faellt deshalb nicht unter diese CSP-Sperre.

use crate::AppState;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, State, WebviewBuilder, WebviewUrl};

const EMBED_LABEL: &str = "pb-embed";

// Deckt sich mit server/app/src/styles.css: Sidebar 210px + 15px Aussenabstand.
const SIDEBAR_OFFSET_X: f64 = 225.0;
const MARGIN: f64 = 15.0;

/// RAPPORT-Theme-Overlay fuer die PocketBase-Admin-UI, per Init-Script injiziert.
/// Ein initialization_script laeuft als WKUserScript AUSSERHALB der
/// Seiten-CSP — "style-src 'self'" greift hier nicht, anders als beim
/// fehlgeschlagenen Versuch mit einem <link>-Tag im nginx-Setup (siehe
/// server/container/rapport-admin-theme.css). Farben/Radius von dort uebernommen,
/// KEIN --accentColor: PB setzt die Akzentfarbe nach Login per JS als Inline-
/// Style (aus settings.meta.accentColor) — das kommt aus der pb/-
/// Migration 1787700000, nicht von hier.
const THEME_CSS: &str = r#"
:root, .dropdown, .base-surface {
  --primaryColor: #252520;
  --primaryTxtColor: #f0ede8;
  --surfaceColor: #fdfcfa;
  --surfaceAlt1Color: #f7f4f0;
  --surfaceAlt2Color: #f0ece4;
  --surfaceAlt3Color: #e6e1da;
  --surfaceAlt4Color: #ddd8d0;
  --surfaceAlt5Color: #d8d2ca;
  --surfaceTxtColor: #1a1a18;
  --surfaceTxtHintColor: #6a6660;
  --surfaceTxtDisabledColor: #b0aca4;
  --borderRadius: 10px;
  --lgBorderRadius: 18px;
}
[data-color-scheme=dark], [data-color-scheme=dark] .dropdown {
  --primaryColor: #2e2e28;
  --primaryTxtColor: #e8e5df;
  --surfaceColor: #222220;
  --surfaceAlt1Color: #292924;
  --surfaceAlt2Color: #2e2e28;
  --surfaceAlt3Color: #333328;
  --surfaceAlt4Color: #38382e;
  --surfaceAlt5Color: color-mix(in srgb, var(--surfaceColor), white 12%);
  --surfaceTxtColor: #e8e5df;
  --surfaceTxtHintColor: #9a968e;
  --surfaceTxtDisabledColor: #565450;
}
"#;

fn init_script() -> String {
    format!(
        r#"(function() {{
  function inject() {{
    var s = document.createElement('style');
    s.textContent = {css:?};
    (document.head || document.documentElement).appendChild(s);
  }}
  if (document.readyState === 'loading') {{
    document.addEventListener('DOMContentLoaded', inject);
  }} else {{
    inject();
  }}
}})();"#,
        css = THEME_CSS
    )
}

/// Position+Groesse fuer den Content-Bereich rechts der Sidebar, analog zur
/// CSS-Konstante in styles.css. Faellt zurueck auf `None`, wenn das
/// Hauptfenster (noch) nicht existiert oder die Grössenabfrage scheitert.
fn content_bounds(app: &AppHandle) -> Option<(LogicalPosition<f64>, LogicalSize<f64>)> {
    let window = app.get_window("main")?;
    let scale = window.scale_factor().ok()?;
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    let w = (size.width - SIDEBAR_OFFSET_X - MARGIN).max(100.0);
    let h = (size.height - MARGIN * 2.0).max(100.0);
    Some((
        LogicalPosition::new(SIDEBAR_OFFSET_X, MARGIN),
        LogicalSize::new(w, h),
    ))
}

#[tauri::command]
pub async fn show_pocketbase_embed(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let port = {
        let sv = state.supervisor.lock().await;
        sv.status("pb").map(|s| s.port).unwrap_or(18090)
    };

    if let Some(webview) = app.get_webview(EMBED_LABEL) {
        if let Some((pos, size)) = content_bounds(&app) {
            let _ = webview.set_position(pos);
            let _ = webview.set_size(size);
        }
        webview.show().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let window = app.get_window("main").ok_or("main window missing")?;
    let (pos, size) = content_bounds(&app).ok_or("could not compute embed bounds")?;
    let url = format!("http://127.0.0.1:{port}/_/");
    let target = url.parse().map_err(|e: url::ParseError| e.to_string())?;

    let builder =
        WebviewBuilder::new(EMBED_LABEL, WebviewUrl::External(target)).initialization_script(init_script());
    window
        .add_child(builder, pos, size)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn hide_pocketbase_embed(app: AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview(EMBED_LABEL) {
        webview.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Bei Fenster-Resize das Embed (falls vorhanden) neu positionieren — sonst
/// bleibt es bei der Groesse vom letzten `show_pocketbase_embed`-Aufruf
/// haengen und ragt ueber den Rand oder laesst Luecken zur Sidebar.
pub fn reposition_on_resize(app: &AppHandle) {
    if let Some(webview) = app.get_webview(EMBED_LABEL) {
        if let Some((pos, size)) = content_bounds(app) {
            let _ = webview.set_position(pos);
            let _ = webview.set_size(size);
        }
    }
}
