//! HTTP/HTTPS-Server fuer den Admin-WebUI-Zugang.
//!
//! Spiegelt die Tauri-Commands als REST-Endpoints + serviert das React-`dist/`.
//! Konfiguration aus `config.env`:
//! - `ADMIN_UI_BIND`     (Default `127.0.0.1`; LAN-Freigabe → `0.0.0.0`)
//! - `ADMIN_UI_PORT`     (Default `9090`)
//! - `ADMIN_UI_PASSWORD` (Auto-generiert, ~32 Bytes random)
//! - `ADMIN_UI_TLS`      (Default `true` — self-signed Cert wird automatisch
//!   in `<data_dir>/admin-ui-cert.pem` erzeugt; `false` nur mit Loopback-Bind)
//!
//! Auth: Basic-Auth mit User `admin`. Fehlversuche werden pro IP gezaehlt;
//! nach `MAX_FAILS` Fehlern in `FAIL_WINDOW` Sekunden ist die IP fuer
//! `LOCKOUT` Sekunden geblockt.

use crate::supervisor::Supervisor;
use axum::{
    body::Body,
    extract::{ConnectInfo, Path, State},
    http::{header, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use axum_server::tls_rustls::RustlsConfig;
use base64::Engine;
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const MAX_FAILS: u32 = 5;
const FAIL_WINDOW: Duration = Duration::from_secs(60);
const LOCKOUT: Duration = Duration::from_secs(300);

#[derive(Default)]
struct AuthFailure {
    count: u32,
    first_seen: Option<Instant>,
    locked_until: Option<Instant>,
}

type FailMap = Arc<Mutex<HashMap<IpAddr, AuthFailure>>>;

/// Obergrenze fuer die Fehlversuch-Tabelle (Schutz vor Speicherwachstum).
const MAX_FAIL_ENTRIES: usize = 4096;

#[derive(Clone)]
pub struct HttpState {
    pub supervisor: Arc<Mutex<Supervisor>>,
    pub password: String,
    fails: FailMap,
    /// Liefert die in die App eingebetteten Frontend-Dateien aus.
    app: tauri::AppHandle,
}

/// Bind-Adresse pruefen. Ohne TLS nur Loopback — sonst ginge das
/// Admin-Passwort im Klartext (Basic-Auth) durchs LAN.
pub fn resolve_bind(bind: &str, port: u16, tls: bool) -> Result<SocketAddr, String> {
    let ip: IpAddr = bind
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .parse()
        .map_err(|e| format!("ungueltige ADMIN_UI_BIND {bind:?}: {e}"))?;
    if !tls && !ip.is_loopback() {
        return Err(format!(
            "ADMIN_UI_TLS=false ist nur mit Loopback-Bind erlaubt (ist: {ip}) — \
             Basic-Auth wuerde sonst unverschluesselt durchs LAN gehen"
        ));
    }
    Ok(SocketAddr::new(ip, port))
}

pub async fn serve(
    bind: String,
    port: u16,
    password: String,
    tls: bool,
    supervisor: Arc<Mutex<Supervisor>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let addr = resolve_bind(&bind, port, tls)?;
    let state = HttpState {
        supervisor,
        password,
        fails: Arc::new(Mutex::new(HashMap::new())),
        app,
    };

    let api = Router::new()
        .route("/services", get(list_services))
        .route("/services/start-all", post(start_all))
        .route("/services/stop-all", post(stop_all))
        .route("/services/:id/start", post(start_service))
        .route("/services/:id/stop", post(stop_service))
        .route("/services/:id/restart", post(restart_service_h))
        .route("/services/restart-all", post(restart_all_h))
        .route("/services/:id", get(service_status_h))
        .route("/services/:id/logs", get(service_logs))
        .route("/config", get(get_config_h).post(set_config_h))
        .route("/activity", get(current_activity))
        .route("/backups", get(list_backups_h))
        .route("/backups/now", post(backup_now_h))
        .route("/backups/:filename/restore", post(restore_backup_h))
        .route("/container-updates/check", post(check_updates_h))
        .route("/container-updates/apply", post(apply_updates_h))
        .route("/events", get(list_events_h))
        .route("/stats", get(list_stats_h))
        .route("/disk", get(disk_usage_h))
        .route("/firstaid/recreate", post(firstaid_recreate_h))
        .route("/firstaid/reset-data", post(firstaid_reset_data_h))
        .route("/firstaid/diagnose", post(firstaid_diagnose_h))
        .route("/setup/status", get(setup_status_h))
        .route("/setup/install", post(setup_install_h));

    // Middleware-Reihenfolge (innen → aussen):
    //   csrf_check   — state-changing Requests brauchen den Custom-Header
    //   basic_auth   — IP-Lockout + Credential-Check
    //   security_headers — auf allen Antworten (auch 401 etc.)
    let app = Router::new()
        .nest("/api", api)
        .fallback(static_handler)
        .layer(middleware::from_fn(csrf_check))
        .layer(middleware::from_fn_with_state(state.clone(), basic_auth))
        .layer(middleware::from_fn(security_headers))
        .with_state(state);

    if tls {
        // rustls 0.23 verlangt expliziten Crypto-Provider. Egal welcher zuerst —
        // ignore_err falls schon installiert.
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
        let (cert_path, key_path) = ensure_tls_cert()?;
        let config = RustlsConfig::from_pem_file(cert_path, key_path)
            .await
            .map_err(|e| format!("rustls config: {e}"))?;
        log::info!("Admin WebUI listening on https://{addr} (user: admin)");
        axum_server::bind_rustls(addr, config)
            .serve(app.into_make_service_with_connect_info::<SocketAddr>())
            .await
            .map_err(|e| format!("axum_server: {e}"))?;
    } else {
        log::info!("Admin WebUI listening on http://{addr} (user: admin) — TLS off!");
        let listener = tokio::net::TcpListener::bind(addr)
            .await
            .map_err(|e| format!("listen {addr}: {e}"))?;
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .map_err(|e| format!("axum serve: {e}"))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// TLS cert provisioning
// ---------------------------------------------------------------------------

fn ensure_tls_cert() -> Result<(std::path::PathBuf, std::path::PathBuf), String> {
    let cert = crate::paths::admin_ui_cert_path();
    let key = crate::paths::admin_ui_key_path();
    if cert.exists() && key.exists() {
        // Rechte bestehender Keys nachziehen (aeltere Versionen: 0644-Fenster).
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&key, std::fs::Permissions::from_mode(0o600));
        }
        return Ok((cert, key));
    }
    log::info!("Generating self-signed TLS cert for Admin WebUI ...");
    crate::paths::ensure_dirs().map_err(|e| format!("ensure_dirs: {e}"))?;
    let hostname = hostname::get()
        .ok()
        .and_then(|n| n.into_string().ok())
        .unwrap_or_else(|| "localhost".into());
    let san = vec![
        "localhost".to_string(),
        "127.0.0.1".to_string(),
        hostname.clone(),
        format!("{hostname}.local"),
    ];
    let cert_kp = rcgen::generate_simple_self_signed(san)
        .map_err(|e| format!("rcgen: {e}"))?;
    std::fs::write(&cert, cert_kp.cert.pem()).map_err(|e| format!("write cert: {e}"))?;
    // Key direkt mit 0600 anlegen (nicht erst schreiben, dann chmod).
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    {
        use std::io::Write;
        let mut f = opts.open(&key).map_err(|e| format!("write key: {e}"))?;
        f.write_all(cert_kp.key_pair.serialize_pem().as_bytes())
            .map_err(|e| format!("write key: {e}"))?;
    }
    Ok((cert, key))
}

// ---------------------------------------------------------------------------
// Basic-Auth middleware + per-IP rate limit
// ---------------------------------------------------------------------------

async fn basic_auth(
    State(state): State<HttpState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    req: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let ip = peer.ip();

    // Lockout-Check.
    {
        let mut fails = state.fails.lock().await;
        if let Some(rec) = fails.get_mut(&ip) {
            if let Some(until) = rec.locked_until {
                if Instant::now() < until {
                    return Ok(too_many("Too many failed attempts. Locked out."));
                }
                // Lockout abgelaufen — Reset.
                *rec = AuthFailure::default();
            }
        }
    }

    let ok = check_auth(req.headers().get(header::AUTHORIZATION), &state.password);

    if ok {
        let mut fails = state.fails.lock().await;
        fails.remove(&ip);
        return Ok(next.run(req).await);
    }

    // Failure registrieren.
    let mut fails = state.fails.lock().await;
    let now = Instant::now();
    if fails.len() >= MAX_FAIL_ENTRIES {
        // Abgelaufene Eintraege wegraeumen, damit die Tabelle nicht waechst.
        fails.retain(|_, r| {
            r.locked_until.map(|t| now < t).unwrap_or(false)
                || r.first_seen.map(|t| now.duration_since(t) < FAIL_WINDOW).unwrap_or(false)
        });
    }
    let rec = fails.entry(ip).or_default();
    match rec.first_seen {
        Some(first) if now.duration_since(first) < FAIL_WINDOW => {
            rec.count += 1;
        }
        _ => {
            rec.count = 1;
            rec.first_seen = Some(now);
        }
    }
    if rec.count >= MAX_FAILS {
        rec.locked_until = Some(now + LOCKOUT);
        log::warn!(
            "Auth lockout: {} after {} fails — blocked for {}s",
            ip,
            rec.count,
            LOCKOUT.as_secs()
        );
    }

    Ok(unauthorized())
}

fn check_auth(header: Option<&axum::http::HeaderValue>, password: &str) -> bool {
    let s = match header.and_then(|h| h.to_str().ok()) {
        Some(s) => s,
        None => return false,
    };
    let Some(b64) = s.strip_prefix("Basic ") else { return false };
    let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(b64) else { return false };
    let Ok(s) = std::str::from_utf8(&decoded) else { return false };
    let Some((user, pass)) = s.split_once(':') else { return false };
    // Zeitkonstanter Vergleich: ein naiver `==` auf dem Passwort-String bricht
    // beim ersten abweichenden Byte ab — die Laufzeit haengt dann minimal vom
    // Praefix ab, was ueber genug Versuche das Passwort Byte fuer Byte leaken
    // kann (Timing-Angriff). `ct_eq` vergleicht immer alle Bytes.
    use subtle::ConstantTimeEq;
    let user_ok = user.as_bytes().ct_eq(b"admin");
    let pass_ok = pass.as_bytes().ct_eq(password.as_bytes());
    !password.is_empty() && bool::from(user_ok & pass_ok)
}

fn unauthorized() -> Response {
    let mut resp = Response::new(Body::from("Authentication required"));
    *resp.status_mut() = StatusCode::UNAUTHORIZED;
    resp.headers_mut().insert(
        header::WWW_AUTHENTICATE,
        "Basic realm=\"RAPPORT Server Admin\"".parse().unwrap(),
    );
    resp
}

fn too_many(msg: &'static str) -> Response {
    let mut resp = Response::new(Body::from(msg));
    *resp.status_mut() = StatusCode::TOO_MANY_REQUESTS;
    resp
}

// ---------------------------------------------------------------------------
// CSRF — Custom-Header-Pflicht fuer state-changing Methoden
// ---------------------------------------------------------------------------
//
// Browser senden Authorization-Header automatisch wenn sie Credentials gecacht
// haben. Damit eine boesartige Seite nicht via auto-submittendem `<form>` einen
// `start-all` triggern kann, verlangen wir auf POST/PUT/DELETE/PATCH den
// Custom-Header `X-Rapport-Csrf: 1`. Cross-origin `<form>` kann diesen nicht
// setzen; cross-origin `fetch()` triggert dafuer CORS-Preflight, das wir nicht
// allowen — also auch geblockt.

async fn csrf_check(req: Request<Body>, next: Next) -> Result<Response, StatusCode> {
    let method = req.method();
    let is_writing = matches!(
        method.as_str(),
        "POST" | "PUT" | "DELETE" | "PATCH"
    );
    if is_writing && req.headers().get("x-rapport-csrf").is_none() {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(next.run(req).await)
}

// ---------------------------------------------------------------------------
// Security-Header — Defense-in-Depth fuer den WebUI-Browser-Tab
// ---------------------------------------------------------------------------

async fn security_headers(req: Request<Body>, next: Next) -> Response {
    let mut resp = next.run(req).await;
    let h = resp.headers_mut();
    // Clickjacking
    h.insert("x-frame-options", "DENY".parse().unwrap());
    // MIME-Sniffing
    h.insert("x-content-type-options", "nosniff".parse().unwrap());
    // Kein Referer rauslassen (privates LAN)
    h.insert("referrer-policy", "no-referrer".parse().unwrap());
    // Strict-Transport-Security — Browser merken sich, dass nur HTTPS gilt.
    // 1 Woche reicht; spaeter koennen wir hochdrehen wenn das setup stabil ist.
    h.insert(
        "strict-transport-security",
        "max-age=604800".parse().unwrap(),
    );
    // CSP: kein externes JS, kein eval, keine inline-Scripts.
    // Inline-Styles sind erlaubt weil React StyleSheets manchmal so generiert.
    h.insert(
        "content-security-policy",
        "default-src 'self'; \
         script-src 'self'; \
         style-src 'self' 'unsafe-inline'; \
         img-src 'self' data:; \
         connect-src 'self'; \
         font-src 'self'; \
         object-src 'none'; \
         base-uri 'self'; \
         form-action 'self'; \
         frame-ancestors 'none'"
            .parse()
            .unwrap(),
    );
    resp
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async fn list_services(State(s): State<HttpState>) -> impl IntoResponse {
    Json(crate::supervisor::list_with_timeout(&s.supervisor, 300).await)
}

async fn start_all(State(s): State<HttpState>) -> impl IntoResponse {
    map_result(crate::supervisor::Supervisor::start_all_managed(s.supervisor.clone()).await)
}

async fn stop_all(State(s): State<HttpState>) -> impl IntoResponse {
    map_result(crate::supervisor::Supervisor::stop_all_managed(s.supervisor.clone()).await)
}

async fn start_service(
    State(s): State<HttpState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let mut sv = s.supervisor.lock().await;
    map_result(sv.start(&id).await)
}

async fn stop_service(
    State(s): State<HttpState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let mut sv = s.supervisor.lock().await;
    map_result(sv.stop(&id).await)
}

async fn restart_service_h(
    State(s): State<HttpState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let mut sv = s.supervisor.lock().await;
    map_result(sv.restart(&id).await)
}

async fn restart_all_h(State(s): State<HttpState>) -> impl IntoResponse {
    map_result(crate::supervisor::Supervisor::restart_all_managed(s.supervisor.clone()).await)
}

async fn service_status_h(
    State(s): State<HttpState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let sv = s.supervisor.lock().await;
    Json(sv.status(&id))
}

/// Platzhalter fuer geheime Werte in `GET /api/config`.
const REDACTED: &str = "<redacted>";

/// Schluessel, die ueber HTTP nicht gesetzt werden duerfen: Geheimnisse
/// (Passwoerter nur lokal in der App) und `COMPOSE_DIR` (wuerde `docker
/// compose` auf ein beliebiges Verzeichnis umlenken).
fn http_writable(key: &str) -> bool {
    !crate::config::is_secret_key(key) && key != "COMPOSE_DIR"
}

async fn get_config_h() -> Response {
    match crate::config::load() {
        Ok(mut map) => {
            crate::config::ensure_defaults(&mut map);
            for (k, v) in map.iter_mut() {
                if crate::config::is_secret_key(k) {
                    *v = REDACTED.to_string();
                }
            }
            Json(map).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

#[derive(serde::Deserialize)]
struct SetConfigBody {
    key: String,
    value: String,
}

async fn set_config_h(Json(body): Json<SetConfigBody>) -> Response {
    if !http_writable(&body.key) {
        return (
            StatusCode::FORBIDDEN,
            "Dieser Schluessel ist nur in der App auf dem Server aenderbar",
        )
            .into_response();
    }
    match crate::config::set_value(&body.key, &body.value) {
        Ok(()) => (StatusCode::OK, "ok").into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
    }
}

/// Liefert das Frontend aus den in die App eingebetteten Assets (Tauri
/// AssetResolver) — frueher kam es aus `<crate>/../dist` zur Build-Zeit,
/// was in der verteilten App nicht existiert. Unbekannte Pfade ohne
/// Dateiendung bekommen `index.html` (SPA). `..`-Pfade werden abgelehnt
/// (im Dev-Modus liest der Resolver direkt vom Dateisystem).
async fn static_handler(State(s): State<HttpState>, uri: axum::http::Uri) -> Response {
    let raw = uri.path();
    if raw.starts_with("/api/") || raw == "/api" {
        // Unbekannte API-Route: kein index.html ausliefern.
        return StatusCode::NOT_FOUND.into_response();
    }
    if !is_safe_asset_path(raw) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let path = raw.trim_start_matches('/').to_string();
    match s.app.asset_resolver().get(path) {
        Some(asset) => {
            let mut resp = Response::new(Body::from(asset.bytes));
            if let Ok(v) = asset.mime_type.parse() {
                resp.headers_mut().insert(header::CONTENT_TYPE, v);
            }
            resp
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// Kein `..`-Segment, kein Backslash, kein NUL und keine kodierten Punkte/
/// Trenner (Frontend-Assets brauchen die nie).
fn is_safe_asset_path(p: &str) -> bool {
    let lower = p.to_ascii_lowercase();
    !p.contains('\\')
        && !p.contains('\0')
        && !p.split('/').any(|seg| seg == ".." || seg == ".")
        && !["%2e", "%2f", "%5c", "%00"].iter().any(|bad| lower.contains(bad))
}

async fn service_logs(
    State(s): State<HttpState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let sv = s.supervisor.lock().await;
    Json(sv.logs(&id).await)
}

async fn current_activity(State(s): State<HttpState>) -> impl IntoResponse {
    let sv = s.supervisor.lock().await;
    Json(sv.current_activity().await)
}

async fn list_backups_h() -> impl IntoResponse {
    Json(crate::backup::list())
}

async fn backup_now_h() -> Response {
    match crate::backup::create_and_prune().await {
        Ok(info) => Json(info).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

async fn restore_backup_h(Path(filename): Path<String>) -> Response {
    if !crate::backup::is_valid_backup_name(&filename) {
        return (StatusCode::BAD_REQUEST, "ungueltiger Dateiname").into_response();
    }
    match crate::backup::restore(&filename).await {
        Ok(res) => Json(res).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

async fn check_updates_h() -> Response {
    match crate::container_update::check().await {
        Ok(res) => Json(res).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

async fn apply_updates_h() -> Response {
    match crate::container_update::apply().await {
        Ok(res) => Json(res).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

async fn list_events_h() -> impl IntoResponse {
    Json(crate::events::list().await)
}

async fn list_stats_h() -> impl IntoResponse {
    Json(crate::stats::collect().await)
}

async fn disk_usage_h() -> impl IntoResponse {
    Json(crate::disk::collect().await)
}

async fn firstaid_recreate_h() -> Response {
    match crate::firstaid::recreate_containers().await {
        Ok(r) => Json(r).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

async fn firstaid_reset_data_h() -> Response {
    match crate::firstaid::reset_data().await {
        Ok(r) => Json(r).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

async fn firstaid_diagnose_h() -> Response {
    match crate::firstaid::diagnose_bundle().await {
        Ok(r) => Json(r).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

async fn setup_status_h() -> impl IntoResponse {
    Json(crate::setup::status().await)
}

async fn setup_install_h(State(s): State<HttpState>) -> Response {
    let _ = s;
    match crate::setup::install_and_start().await {
        Ok(r) => Json(r).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

fn map_result(r: Result<(), String>) -> Response {
    match r {
        Ok(()) => (StatusCode::OK, "ok").into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn basic(user: &str, pass: &str) -> axum::http::HeaderValue {
        let b = base64::engine::general_purpose::STANDARD.encode(format!("{user}:{pass}"));
        format!("Basic {b}").parse().unwrap()
    }

    #[test]
    fn auth_checks() {
        assert!(check_auth(Some(&basic("admin", "geheim")), "geheim"));
        assert!(!check_auth(Some(&basic("admin", "falsch")), "geheim"));
        assert!(!check_auth(Some(&basic("root", "geheim")), "geheim"));
        assert!(!check_auth(Some(&basic("admin", "")), ""));
        assert!(!check_auth(None, "geheim"));
        let bad: axum::http::HeaderValue = "Bearer xyz".parse().unwrap();
        assert!(!check_auth(Some(&bad), "geheim"));
    }

    #[test]
    fn bind_rules() {
        assert!(resolve_bind("127.0.0.1", 9090, true).is_ok());
        assert!(resolve_bind("0.0.0.0", 9090, true).is_ok());
        assert!(resolve_bind("::1", 9090, false).is_ok());
        assert!(resolve_bind("[::]", 9090, true).is_ok());
        assert!(resolve_bind("0.0.0.0", 9090, false).is_err());
        assert!(resolve_bind("kaputt", 9090, true).is_err());
    }

    #[test]
    fn asset_paths() {
        assert!(is_safe_asset_path("/"));
        assert!(is_safe_asset_path("/assets/index-abc.js"));
        assert!(!is_safe_asset_path("/../etc/passwd"));
        assert!(!is_safe_asset_path("/assets/%2e%2e/%2e%2e/x"));
        assert!(!is_safe_asset_path("/a/..%2f..%2fx"));
        assert!(!is_safe_asset_path("/a\\b"));
    }

    #[test]
    fn http_config_write_rules() {
        assert!(http_writable("BACKUP_HOUR"));
        assert!(http_writable("ADMIN_UI_BIND"));
        assert!(!http_writable("ADMIN_UI_PASSWORD"));
        assert!(!http_writable("PB_SUPERUSER_PASSWORD"));
        assert!(!http_writable("COMPOSE_DIR"));
    }
}
