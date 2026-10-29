//! Process-Supervisor — duenner Wrapper um `docker compose`.
//!
//! Statt selbst Container-Argumente zu bauen, delegieren wir Start/Stop/Logs
//! an die Compose-Datei in `services::compose_dir()`. Das hat den Vorteil dass
//! Image-/Env-/Volume-Konfiguration nur einmal existiert (in server/container/)
//! und nicht hier und dort gepflegt werden muss.

use crate::services::{self, ServiceDef};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

const LOG_RING_CAPACITY: usize = 1000;

/// Globaler Status-Cache fuer schnelles `list_services` ohne den Supervisor-Mutex
/// blockieren zu muessen. Wird von list_with_timeout() gefuellt; bei lang
/// laufenden compose-Calls (z.B. Erst-Start mit Image-Pull) liefert der Cache
/// die letzte bekannte Liste so dass die UI nicht hangs zeigt.
static STATUS_CACHE: std::sync::OnceLock<Arc<Mutex<Vec<ServiceStatus>>>> =
    std::sync::OnceLock::new();

fn status_cache() -> &'static Arc<Mutex<Vec<ServiceStatus>>> {
    STATUS_CACHE.get_or_init(|| Arc::new(Mutex::new(Vec::new())))
}

/// Versucht den Supervisor-Mutex in `timeout_ms` zu kriegen — wenn nicht,
/// gibt den Cache zurueck. Aktualisiert Cache bei jedem Erfolg.
pub async fn list_with_timeout(
    supervisor: &Arc<Mutex<Supervisor>>,
    timeout_ms: u64,
) -> Vec<ServiceStatus> {
    let timeout = std::time::Duration::from_millis(timeout_ms);
    match tokio::time::timeout(timeout, supervisor.lock()).await {
        Ok(sv) => {
            let list = sv.list();
            *status_cache().lock().await = list.clone();
            list
        }
        Err(_) => status_cache().lock().await.clone(),
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ServiceState {
    Stopped,
    Starting,
    Running,
    Stopping,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServiceStatus {
    pub id: String,
    pub display_name: String,
    pub state: ServiceState,
    pub pid: Option<u32>,
    pub port: u16,
    pub last_error: Option<String>,
}

struct ServiceEntry {
    def: ServiceDef,
    state: ServiceState,
    log_pump: Option<Child>,
    pid: Option<u32>,
    last_error: Option<String>,
    logs: Arc<Mutex<VecDeque<String>>>,
    /// Wann zum erstmals in Error gerutscht — gesetzt bei Transition INTO Error,
    /// gecleart wenn raus.
    errored_since: Option<Instant>,
    recovery_attempts: u32,
    /// Wann der naechste Auto-Restart-Versuch faellig ist.
    next_recovery_at: Option<Instant>,
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct RecoveryReport {
    pub to_restart: Vec<String>,
    pub maxed_out: Vec<String>,
}

pub struct Supervisor {
    services: HashMap<String, ServiceEntry>,
    pub activity: Arc<Mutex<String>>,
}

impl Supervisor {
    pub fn new() -> Self {
        Self {
            services: HashMap::new(),
            activity: Arc::new(Mutex::new(String::new())),
        }
    }

    pub fn activity_handle(&self) -> Arc<Mutex<String>> {
        self.activity.clone()
    }

    pub async fn current_activity(&self) -> String {
        self.activity.lock().await.clone()
    }

    pub fn register(&mut self, def: ServiceDef) {
        let id = def.id.clone();
        self.services.insert(
            id,
            ServiceEntry {
                def,
                state: ServiceState::Stopped,
                log_pump: None,
                pid: None,
                last_error: None,
                logs: Arc::new(Mutex::new(VecDeque::with_capacity(LOG_RING_CAPACITY))),
                errored_since: None,
                recovery_attempts: 0,
                next_recovery_at: None,
            },
        );
    }

    pub fn list(&self) -> Vec<ServiceStatus> {
        let mut out: Vec<_> = self
            .services
            .values()
            .map(|e| ServiceStatus {
                id: e.def.id.clone(),
                display_name: e.def.display_name.clone(),
                state: e.state,
                pid: e.pid,
                port: e.def.port,
                last_error: e.last_error.clone(),
            })
            .collect();
        out.sort_by(|a, b| a.port.cmp(&b.port));
        out
    }

    pub fn status(&self, id: &str) -> Option<ServiceStatus> {
        let e = self.services.get(id)?;
        Some(ServiceStatus {
            id: e.def.id.clone(),
            display_name: e.def.display_name.clone(),
            state: e.state,
            pid: e.pid,
            port: e.def.port,
            last_error: e.last_error.clone(),
        })
    }

    pub async fn logs(&self, id: &str) -> Vec<String> {
        let Some(e) = self.services.get(id) else { return vec![] };
        e.logs.lock().await.iter().cloned().collect()
    }

    pub async fn start(&mut self, id: &str) -> Result<(), String> {
        log::info!("start({id})");
        let entry = self
            .services
            .get_mut(id)
            .ok_or_else(|| format!("unknown service: {id}"))?;
        if matches!(entry.state, ServiceState::Running | ServiceState::Starting) {
            return Ok(());
        }
        entry.state = ServiceState::Starting;
        entry.last_error = None;

        let logs_ref = entry.logs.clone();
        let result = compose_up(&entry.def.id, logs_ref).await;
        let entry = self.services.get_mut(id).unwrap();
        match result {
            Ok(log_pump) => {
                entry.pid = log_pump.id();
                entry.log_pump = Some(log_pump);
                Ok(())
            }
            Err(e) => {
                entry.state = ServiceState::Error;
                entry.last_error = Some(e.clone());
                Err(e)
            }
        }
    }

    /// Drop-in replacement fuer `start_all` als freie Funktion — haelt den
    /// Supervisor-Mutex NUR fuer kurze State-Updates, NICHT waehrend `docker
    /// compose up -d`. So bleibt die UI responsive auch beim Erst-Pull.
    pub async fn start_all_managed(arc: Arc<Mutex<Self>>) -> Result<(), String> {
        log::info!("start_all_managed (docker compose up -d, lock-frei waehrend compose)");
        crate::events::info("Container werden hochgefahren (kann beim Erst-Start bis zu 1 Min dauern) ...").await;
        // 1) Quick lock: mark all Starting + prime Cache
        {
            let mut sv = arc.lock().await;
            sv.mark_all_starting();
            *status_cache().lock().await = sv.list();
        }
        // 2) Slow compose call — KEIN Lock gehalten
        let compose_result = compose(&["up", "-d"]).await;
        // 3) Quick lock: finalize
        let mut sv = arc.lock().await;
        match compose_result {
            Err(e) => {
                sv.mark_all_error(&e);
                *status_cache().lock().await = sv.list();
                crate::events::error(format!("Start fehlgeschlagen: {e}")).await;
                Err(e)
            }
            Ok(_) => {
                sv.ensure_log_pumps().await;
                *status_cache().lock().await = sv.list();
                drop(sv);
                crate::events::info("Alle Services gestartet").await;
                Ok(())
            }
        }
    }

    pub async fn stop_all_managed(arc: Arc<Mutex<Self>>) -> Result<(), String> {
        log::info!("stop_all_managed (docker compose down, lock-frei waehrend compose)");
        crate::events::info("Alle Services stoppen ...").await;
        {
            let mut sv = arc.lock().await;
            sv.mark_all_stopping().await;
            *status_cache().lock().await = sv.list();
        }
        let res = compose(&["down"]).await;
        let mut sv = arc.lock().await;
        sv.mark_all_stopped();
        *status_cache().lock().await = sv.list();
        res.map(|_| ())
    }

    pub async fn restart_all_managed(arc: Arc<Mutex<Self>>) -> Result<(), String> {
        log::info!("restart_all_managed (docker compose restart, lock-frei waehrend compose)");
        crate::events::info("Alle Services neu starten ...").await;
        {
            let mut sv = arc.lock().await;
            for entry in sv.services.values_mut() {
                entry.state = ServiceState::Starting;
                entry.last_error = None;
                if let Some(mut lp) = entry.log_pump.take() {
                    let _ = lp.kill().await;
                }
            }
            *status_cache().lock().await = sv.list();
        }
        let res = compose(&["restart"]).await;
        let mut sv = arc.lock().await;
        match res {
            Err(e) => {
                sv.mark_all_error(&e);
                *status_cache().lock().await = sv.list();
                crate::events::error(format!("Restart-All fehlgeschlagen: {e}")).await;
                Err(e)
            }
            Ok(_) => {
                sv.ensure_log_pumps().await;
                *status_cache().lock().await = sv.list();
                drop(sv);
                crate::events::info("Alle Services neu gestartet").await;
                Ok(())
            }
        }
    }

    pub async fn restart(&mut self, id: &str) -> Result<(), String> {
        log::info!("restart({id})");
        crate::events::info(format!("Service {id} neu starten ...")).await;
        let entry = self
            .services
            .get_mut(id)
            .ok_or_else(|| format!("unknown service: {id}"))?;
        entry.state = ServiceState::Starting;
        entry.last_error = None;
        if let Some(mut lp) = entry.log_pump.take() {
            let _ = lp.kill().await;
        }
        let logs = entry.logs.clone();
        let id_clone = entry.def.id.clone();

        let res = compose(&["restart", &id_clone]).await;
        let entry = self.services.get_mut(id).unwrap();
        if let Err(ref e) = res {
            entry.state = ServiceState::Error;
            entry.last_error = Some(e.clone());
            return Err(e.clone());
        }
        // Log-Pump neu starten — der alte Stream ist tot.
        match spawn_log_pump(&id_clone, logs).await {
            Ok(lp) => {
                entry.pid = lp.id();
                entry.log_pump = Some(lp);
            }
            Err(e) => log::warn!("log pump restart {id_clone}: {e}"),
        }
        crate::events::info(format!("Service {id} neu gestartet")).await;
        Ok(())
    }

    pub async fn stop(&mut self, id: &str) -> Result<(), String> {
        log::info!("stop({id})");
        let entry = self
            .services
            .get_mut(id)
            .ok_or_else(|| format!("unknown service: {id}"))?;
        if matches!(entry.state, ServiceState::Stopped) {
            return Ok(());
        }
        entry.state = ServiceState::Stopping;
        if let Some(mut lp) = entry.log_pump.take() {
            let _ = lp.kill().await;
        }
        let id_clone = entry.def.id.clone();
        let _ = compose(&["stop", &id_clone]).await;
        entry.pid = None;
        entry.state = ServiceState::Stopped;
        Ok(())
    }

    /// Quick: alle Services auf `Starting` setzen + Cache update.
    /// Wird vor dem langen compose-Call aufgerufen damit die UI nicht hangs sieht.
    fn mark_all_starting(&mut self) {
        for entry in self.services.values_mut() {
            entry.state = ServiceState::Starting;
            entry.last_error = None;
        }
    }

    /// Quick: alle auf `Stopping` setzen + Log-Pumps killen.
    async fn mark_all_stopping(&mut self) {
        for entry in self.services.values_mut() {
            if let Some(mut lp) = entry.log_pump.take() {
                let _ = lp.kill().await;
            }
            entry.state = ServiceState::Stopping;
        }
    }

    /// Quick: alle als Stopped markieren (Endzustand nach compose down).
    fn mark_all_stopped(&mut self) {
        for entry in self.services.values_mut() {
            entry.state = ServiceState::Stopped;
            entry.pid = None;
        }
    }

    /// Quick: alle als Error markieren (Endzustand wenn compose-Call schiefging).
    fn mark_all_error(&mut self, msg: &str) {
        for entry in self.services.values_mut() {
            entry.state = ServiceState::Error;
            entry.last_error = Some(msg.to_string());
        }
    }

    /// Quick: Log-Pumps fuer alle Services nachstarten falls noch keiner laeuft.
    async fn ensure_log_pumps(&mut self) {
        let ids: Vec<String> = self.services.keys().cloned().collect();
        for id in ids {
            let Some(entry) = self.services.get_mut(&id) else { continue };
            if entry.log_pump.is_none() {
                if let Ok(lp) = spawn_log_pump(&entry.def.id, entry.logs.clone()).await {
                    entry.pid = lp.id();
                    entry.log_pump = Some(lp);
                }
            }
        }
    }

    /// Fragt `docker compose ps` nach dem aktuellen Stand und uebernimmt
    /// die State-Machine daraus. Liefert die Liste der Services die in
    /// diesem Tick NEU in den Error-State gewechselt sind — der Caller
    /// dispatched daraus z.B. eine macOS-Notification.
    pub async fn tick_health(&mut self) -> Vec<String> {
        let mut newly_errored = Vec::new();
        let statuses = match query_compose_status().await {
            Ok(m) => m,
            Err(e) => {
                log::warn!("compose ps failed: {e}");
                return newly_errored;
            }
        };
        let ids: Vec<String> = self.services.keys().cloned().collect();
        for id in ids {
            let Some(e) = self.services.get_mut(&id) else { continue };
            let cs = statuses.get(&id);
            let new_state = match cs {
                // Container nicht in compose ps:
                //   - wenn wir gerade auf Starting sind (z.B. compose up haengt
                //     noch im Pull) → bleibt Starting (sonst flackert die UI)
                //   - sonst → Stopped
                None => {
                    if e.state == ServiceState::Starting {
                        ServiceState::Starting
                    } else {
                        ServiceState::Stopped
                    }
                }
                Some(s) if s.health == Some("unhealthy".to_string()) => ServiceState::Error,
                Some(s) if s.state == "restarting" || s.state == "dead" => ServiceState::Error,
                Some(s) if s.state == "exited" || s.state == "stopped" || s.state == "removing" => {
                    ServiceState::Stopped
                }
                Some(s) if s.state == "created" || s.state == "paused" => ServiceState::Starting,
                Some(s) if s.state == "running" => match s.health.as_deref() {
                    Some("starting") => ServiceState::Starting,
                    _ => ServiceState::Running,
                },
                Some(_) => ServiceState::Starting,
            };
            if e.state != new_state {
                let was_error = matches!(e.state, ServiceState::Error);
                if new_state == ServiceState::Error {
                    if let Some(s) = cs {
                        e.last_error = Some(format!("{}: {}", s.state, s.health.clone().unwrap_or_default()));
                    }
                    if !was_error {
                        // Transition INTO Error: Recovery-Counter starten.
                        e.errored_since = Some(Instant::now());
                        e.recovery_attempts = 0;
                        // Erste Recovery erst nach base-delay (lib.rs setzt das spaeter neu).
                        e.next_recovery_at = Some(Instant::now() + Duration::from_secs(60));
                        newly_errored.push(id.clone());
                    }
                } else {
                    // Out of Error: Recovery-State resetten.
                    e.errored_since = None;
                    e.recovery_attempts = 0;
                    e.next_recovery_at = None;
                    if matches!(new_state, ServiceState::Running | ServiceState::Stopped) {
                        e.last_error = None;
                    }
                }
                e.state = new_state;
            }
        }
        newly_errored
    }

    /// Display-Name fuer eine Service-ID (fuer Notifications, UI etc.).
    pub fn display_name(&self, id: &str) -> Option<String> {
        self.services.get(id).map(|e| e.def.display_name.clone())
    }

    /// Bewertet welche Services jetzt einen Recovery-Restart bekommen sollen.
    /// Inkrementiert dabei den Versuchszaehler atomisch und plant den naechsten
    /// Versuch via exponential backoff. Wenn `max_attempts` erreicht ist,
    /// landet die Service-ID in `maxed_out` und es wird nicht weiter versucht.
    pub fn recovery_candidates(
        &mut self,
        max_attempts: u32,
        base_delay: Duration,
    ) -> RecoveryReport {
        let now = Instant::now();
        let mut report = RecoveryReport::default();
        for entry in self.services.values_mut() {
            if !matches!(entry.state, ServiceState::Error) {
                continue;
            }
            if entry.recovery_attempts >= max_attempts {
                continue; // bereits aufgegeben — keine Doppel-Notification
            }
            let due = entry.next_recovery_at.map(|t| now >= t).unwrap_or(true);
            if !due {
                continue;
            }
            entry.recovery_attempts += 1;
            if entry.recovery_attempts >= max_attempts {
                entry.next_recovery_at = None;
                report.maxed_out.push(entry.def.id.clone());
            } else {
                // exponential backoff: 1×, 2×, 4×, 8×, ... base_delay (capped 8x)
                let exp = (entry.recovery_attempts.saturating_sub(1)).min(8);
                let backoff = base_delay.saturating_mul(1u32 << exp);
                entry.next_recovery_at = Some(now + backoff);
            }
            report.to_restart.push(entry.def.id.clone());
        }
        report
    }
}

// ---------------------------------------------------------------------------
// Compose helpers
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize)]
struct ComposeStatusRaw {
    #[serde(rename = "Service")]
    service: String,
    #[serde(rename = "State")]
    state: String,
    #[serde(rename = "Health", default)]
    health: String,
}

struct ComposeStatus {
    state: String,
    health: Option<String>,
}

async fn query_compose_status() -> Result<HashMap<String, ComposeStatus>, String> {
    let output = Command::new("docker")
        .current_dir(services::compose_dir())
        .args(["compose", "ps", "-a", "--format", "json"])
        .output()
        .await
        .map_err(|e| format!("spawn: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let mut out = HashMap::new();
    // Compose gibt JSON-Lines aus (ein Objekt pro Zeile), nicht ein Array.
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        match serde_json::from_str::<ComposeStatusRaw>(line) {
            Ok(raw) => {
                out.insert(
                    raw.service,
                    ComposeStatus {
                        state: raw.state,
                        health: if raw.health.is_empty() {
                            None
                        } else {
                            Some(raw.health)
                        },
                    },
                );
            }
            Err(e) => log::warn!("compose ps json parse: {e} | line={line}"),
        }
    }
    Ok(out)
}

async fn compose(args: &[&str]) -> Result<std::process::Output, String> {
    let mut cmd = Command::new("docker");
    cmd.current_dir(services::compose_dir()).arg("compose");
    for a in args {
        cmd.arg(a);
    }
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("spawn docker compose: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "docker compose {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(output)
}

async fn compose_up(service: &str, logs: Arc<Mutex<VecDeque<String>>>) -> Result<Child, String> {
    compose(&["up", "-d", service]).await?;
    spawn_log_pump(service, logs).await
}

async fn spawn_log_pump(
    service: &str,
    logs: Arc<Mutex<VecDeque<String>>>,
) -> Result<Child, String> {
    let mut cmd = Command::new("docker");
    cmd.current_dir(services::compose_dir())
        .args(["compose", "logs", "-f", "--no-log-prefix", service])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn docker compose logs: {e}"))?;
    if let Some(stdout) = child.stdout.take() {
        tokio::spawn(pump_lines(stdout, logs.clone()));
    }
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(pump_lines(stderr, logs));
    }
    Ok(child)
}

async fn pump_lines<R: tokio::io::AsyncRead + Unpin + Send + 'static>(
    reader: R,
    logs: Arc<Mutex<VecDeque<String>>>,
) {
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let mut buf = logs.lock().await;
        if buf.len() >= LOG_RING_CAPACITY {
            buf.pop_front();
        }
        buf.push_back(line);
    }
}
