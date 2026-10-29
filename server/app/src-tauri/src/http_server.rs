//! HTTP/HTTPS-Server fuer den Admin-WebUI-Zugang.
//!
//! Spiegelt die Tauri-Commands als REST-Endpoints + serviert das React-`dist/`.
//! Konfiguration aus `config.env`:
//! - `ADMIN_UI_BIND`     (Default `127.0.0.1`; LAN-Freigabe → `0.0.0.0`)
//! - `ADMIN_UI_PORT`     (Default `9090`)
//! - `ADMIN_UI_PASSWORD` (Auto-generiert, ~32 Bytes random)
//! - `ADMIN_UI_TLS`      (Default `true` — self-signed Cert wird automatisch
//!                        in `<data_dir>/admin-ui-cert.pem` erzeugt)
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
use tower_http::services::ServeDir;

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

#[derive(Clone)]
pub struct HttpState {
    pub supervisor: Arc<Mutex<Supervisor>>,
    pub password: String,
    fails: FailMap,
}

pub async fn serve(
    bind: String,
    port: u16,
    password: String,
    tls: bool,
    supervisor: Arc<Mutex<Supervisor>>,
    static_dir: std::path::PathBuf,
) -> Result<(), String> {
    let state = HttpState {
        supervisor,
        password,
        fails: Arc::new(Mutex::new(HashMap::new())),
    };

    let api = Router::new()
        .route("/services", get(list_services))
        .route("/services/start-all", post(start_all))
        .route("/services/stop-all", post(stop_all))
        .route("/services/:id/start", post(start_service))
        .route("/services/:id/stop", post(stop_service))
        .route("/services/:id/restart", post(restart_service_h))
        .route("/services/restart-all", post(restart_all_h))
        .route("/services/:id/logs", get(service_logs))
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

    let static_service = ServeDir::new(&static_dir).append_index_html_on_directories(true);

    // Middleware-Reihenfolge (innen → aussen):
    //   csrf_check   — state-changing Requests brauchen den Custom-Header
    //   basic_auth   — IP-Lockout + Credential-Check
    //   security_headers — auf allen Antworten (auch 401 etc.)
    let app = Router::new()
        .nest("/api", api)
        .fallback_service(static_service)
        .layer(middleware::from_fn(csrf_check))
        .layer(middleware::from_fn_with_state(state.clone(), basic_auth))
        .layer(middleware::from_fn(security_headers))
        .with_state(state);

    let addr: SocketAddr = format!("{bind}:{port}")
        .parse()
        .map_err(|e| format!("bad bind addr {bind}:{port}: {e}"))?;

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
    std::fs::write(&key, cert_kp.key_pair.serialize_pem())
        .map_err(|e| format!("write key: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&key, std::fs::Permissions::from_mode(0o600));
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
    let rec = fails.entry(ip).or_default();
    let now = Instant::now();
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
    user == "admin" && pass.as_bytes().ct_eq(password.as_bytes()).into()
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
    match crate::backup::create().await {
        Ok(info) => Json(info).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

async fn restore_backup_h(Path(filename): Path<String>) -> Response {
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
