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

/// Cache nach einem Tick aktualisieren (ohne Supervisor-Lock lesbar).
pub async fn update_status_cache(list: Vec<ServiceStatus>) {
    *status_cache().lock().await = list;
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
    /// Solange gesetzt und nicht abgelaufen, bleibt ein `Starting`-Service
    /// auch dann `Starting`, wenn `compose ps` (noch) keinen Container zeigt
    /// (z.B. waehrend `compose up` noch Images zieht). Danach → `Stopped`,
    /// statt ewig in `Starting` haengen zu bleiben.
    starting_hold_until: Option<Instant>,
    /// Letzter Start eines Log-Pumps — Respawn hoechstens alle
    /// `LOG_PUMP_RESPAWN_MIN`, falls `docker compose logs -f` sofort stirbt.
    log_pump_spawned_at: Option<Instant>,
}

/// Wie lange ein laufender compose-Aufruf `Starting` ohne Container erlaubt.
const STARTING_HOLD_DURING_OP: Duration = Duration::from_secs(15 * 60);
/// Nachlauf nach Ende des compose-Aufrufs, bis `ps` den Container zeigt.
const STARTING_HOLD_AFTER_OP: Duration = Duration::from_secs(30);
const LOG_PUMP_RESPAWN_MIN: Duration = Duration::from_secs(30);

/// Ergebnis eines Health-Ticks fuer den Aufrufer (Tray, Notifications).
#[derive(Debug, Default, Clone)]
pub struct TickReport {
    /// Services, die in diesem Tick NEU in `Error` gewechselt sind.
    pub newly_errored: Vec<String>,
    /// `Some(fehler)` wenn Docker in diesem Tick unerreichbar wurde.
    pub docker_lost: Option<String>,
    /// Docker ist nach einem Ausfall wieder erreichbar.
    pub docker_back: bool,
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct RecoveryReport {
    pub to_restart: Vec<String>,
    pub maxed_out: Vec<String>,
}

pub struct Supervisor {
    services: HashMap<String, ServiceEntry>,
    pub activity: Arc<Mutex<String>>,
    /// Ergebnis des letzten `compose ps` (false = Docker/Compose nicht erreichbar).
    docker_ok: bool,
}

impl Supervisor {
    pub fn new() -> Self {
        Self {
            services: HashMap::new(),
            activity: Arc::new(Mutex::new(String::new())),
            docker_ok: true,
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
                starting_hold_until: None,
                log_pump_spawned_at: None,
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
        out.sort_by_key(|a| a.port);
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
        entry.starting_hold_until = Some(Instant::now() + STARTING_HOLD_DURING_OP);

        let logs_ref = entry.logs.clone();
        let result = compose_up(&entry.def.id, logs_ref).await;
        let Some(entry) = self.services.get_mut(id) else {
            return result.map(|_| ());
        };
        entry.starting_hold_until = Some(Instant::now() + STARTING_HOLD_AFTER_OP);
        match result {
            Ok(log_pump) => {
                entry.pid = log_pump.id();
                entry.log_pump = Some(log_pump);
                entry.log_pump_spawned_at = Some(Instant::now());
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
        sv.set_starting_hold(STARTING_HOLD_AFTER_OP);
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
        match res {
            Ok(_) => {
                sv.mark_all_stopped();
                *status_cache().lock().await = sv.list();
                Ok(())
            }
            Err(e) => {
                // Nicht blind `Stopped` behaupten — der naechste Tick liest
                // den echten Stand aus `compose ps`.
                for entry in sv.services.values_mut() {
                    entry.last_error = Some(e.clone());
                }
                *status_cache().lock().await = sv.list();
                crate::events::error(format!("Stop-All fehlgeschlagen: {e}")).await;
                Err(e)
            }
        }
    }

    pub async fn restart_all_managed(arc: Arc<Mutex<Self>>) -> Result<(), String> {
        log::info!("restart_all_managed (docker compose restart, lock-frei waehrend compose)");
        crate::events::info("Alle Services neu starten ...").await;
        {
            let mut sv = arc.lock().await;
            sv.mark_all_starting();
            for entry in sv.services.values_mut() {
                if let Some(mut lp) = entry.log_pump.take() {
                    let _ = lp.kill().await;
                }
            }
            *status_cache().lock().await = sv.list();
        }
        // `compose restart` startet nur existierende Container neu. Fehlen
        // welche (z.B. nach `down`), legt `up -d --no-recreate` sie an, ohne
        // die eben neu gestarteten noch einmal anzufassen.
        let res = match compose(&["restart"]).await {
            Ok(_) => compose(&["up", "-d", "--no-recreate"]).await,
            Err(e) => Err(e),
        };
        let mut sv = arc.lock().await;
        sv.set_starting_hold(STARTING_HOLD_AFTER_OP);
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
        entry.starting_hold_until = Some(Instant::now() + STARTING_HOLD_DURING_OP);
        if let Some(mut lp) = entry.log_pump.take() {
            let _ = lp.kill().await;
        }
        let logs = entry.logs.clone();
        let id_clone = entry.def.id.clone();

        // Wie restart_all: fehlt der Container, legt `up --no-recreate` ihn an.
        let res = match compose(&["restart", &id_clone]).await {
            Ok(_) => compose(&["up", "-d", "--no-recreate", &id_clone]).await,
            Err(e) => Err(e),
        };
        let Some(entry) = self.services.get_mut(id) else {
            return res.map(|_| ());
        };
        entry.starting_hold_until = Some(Instant::now() + STARTING_HOLD_AFTER_OP);
        if let Err(ref e) = res {
            entry.state = ServiceState::Error;
            entry.last_error = Some(e.clone());
            return Err(e.clone());
        }
        // Log-Pump neu starten — der alte Stream ist tot.
        match spawn_log_pump(&id_clone, logs) {
            Ok(lp) => {
                entry.pid = lp.id();
                entry.log_pump = Some(lp);
                entry.log_pump_spawned_at = Some(Instant::now());
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
        let res = compose(&["stop", &id_clone]).await;
        let Some(entry) = self.services.get_mut(id) else {
            return res.map(|_| ());
        };
        entry.pid = None;
        match res {
            Ok(_) => {
                entry.state = ServiceState::Stopped;
                Ok(())
            }
            Err(e) => {
                // State bleibt `Stopping`; der naechste Tick uebernimmt den
                // echten Stand aus `compose ps`.
                entry.last_error = Some(e.clone());
                Err(e)
            }
        }
    }

    /// Beendet alle Log-Pump-Prozesse (synchron, fuer den App-Exit — dort
    /// laufen keine Drops mehr, `kill_on_drop` greift also nicht).
    pub fn kill_all_log_pumps(&mut self) {
        for entry in self.services.values_mut() {
            if let Some(mut lp) = entry.log_pump.take() {
                let _ = lp.start_kill();
            }
            entry.pid = None;
        }
    }

    /// Haelt `Starting` ohne Container noch `d` lang (siehe `starting_hold_until`).
    fn set_starting_hold(&mut self, d: Duration) {
        let until = Instant::now() + d;
        for entry in self.services.values_mut() {
            if entry.state == ServiceState::Starting {
                entry.starting_hold_until = Some(until);
            }
        }
    }

    /// Quick: alle Services auf `Starting` setzen + Cache update.
    /// Wird vor dem langen compose-Call aufgerufen damit die UI nicht hangs sieht.
    fn mark_all_starting(&mut self) {
        let until = Instant::now() + STARTING_HOLD_DURING_OP;
        for entry in self.services.values_mut() {
            entry.state = ServiceState::Starting;
            entry.last_error = None;
            entry.starting_hold_until = Some(until);
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
                if let Ok(lp) = spawn_log_pump(&entry.def.id, entry.logs.clone()) {
                    entry.pid = lp.id();
                    entry.log_pump = Some(lp);
                    entry.log_pump_spawned_at = Some(Instant::now());
                }
            }
        }
    }

    /// Uebernimmt das Ergebnis von `query_compose_status()` in die
    /// State-Machine. Der `compose ps`-Aufruf selbst laeuft im Aufrufer
    /// OHNE Supervisor-Lock (siehe lib.rs), damit UI-Abfragen nicht 2s-weise
    /// hinter einem haengenden Docker-Daemon warten.
    pub fn apply_health(
        &mut self,
        statuses: Result<HashMap<String, ComposeStatus>, String>,
    ) -> TickReport {
        let mut report = TickReport::default();
        let now = Instant::now();
        let statuses = match statuses {
            Ok(m) => {
                if !self.docker_ok {
                    report.docker_back = true;
                    // Fehlermeldung "Docker nicht erreichbar" wieder entfernen.
                    for e in self.services.values_mut() {
                        if e.state != ServiceState::Error {
                            e.last_error = None;
                        }
                    }
                }
                self.docker_ok = true;
                m
            }
            Err(err) => {
                log::warn!("compose ps failed: {err}");
                if self.docker_ok {
                    report.docker_lost = Some(err.clone());
                }
                self.docker_ok = false;
                // Ohne Daemon laeuft kein Container mehr. Statt den letzten
                // Stand (z.B. "running") ewig weiter anzuzeigen: alles auf
                // Stopped mit klarer Ursache. Keine Error-Transition — sonst
                // gaebe es je Service eine Notification + Recovery-Versuche.
                let msg = format!("Docker nicht erreichbar: {err}");
                for e in self.services.values_mut() {
                    if e.state == ServiceState::Starting
                        && e.starting_hold_until.map(|t| now < t).unwrap_or(false)
                    {
                        continue; // laufender compose-Aufruf — der meldet selber
                    }
                    e.state = ServiceState::Stopped;
                    e.errored_since = None;
                    e.recovery_attempts = 0;
                    e.next_recovery_at = None;
                    e.last_error = Some(msg.clone());
                    if let Some(mut lp) = e.log_pump.take() {
                        let _ = lp.start_kill();
                    }
                    e.pid = None;
                }
                return report;
            }
        };
        let ids: Vec<String> = self.services.keys().cloned().collect();
        for id in ids {
            let Some(e) = self.services.get_mut(&id) else { continue };
            let cs = statuses.get(&id);
            let hold = e.starting_hold_until.map(|t| now < t).unwrap_or(false);
            let new_state = map_state(cs, e.state, hold);
            if e.state != new_state {
                let was_error = matches!(e.state, ServiceState::Error);
                if new_state == ServiceState::Error {
                    if let Some(s) = cs {
                        e.last_error = Some(match &s.health {
                            Some(h) => format!("{}: {h}", s.state),
                            None => s.state.clone(),
                        });
                    }
                    if !was_error {
                        // Transition INTO Error: Recovery-Counter starten. Der
                        // erste Versuch wird in recovery_candidates() aus
                        // `errored_since + base_delay` berechnet.
                        e.errored_since = Some(now);
                        e.recovery_attempts = 0;
                        e.next_recovery_at = None;
                        report.newly_errored.push(id.clone());
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
            if new_state != ServiceState::Starting {
                e.starting_hold_until = None;
            }
            // Log-Pump pflegen: beendete Prozesse aufraeumen (kein Zombie,
            // kein toter Stream), fuer laufende Container ohne Pump einen
            // starten (z.B. ausserhalb der App per Terminal gestartet oder
            // nach einem Crash/Restart durch die Restart-Policy).
            if let Some(lp) = e.log_pump.as_mut() {
                if !matches!(lp.try_wait(), Ok(None)) {
                    e.log_pump = None;
                    e.pid = None;
                }
            }
            let respawn_ok = e
                .log_pump_spawned_at
                .map(|t| now.duration_since(t) >= LOG_PUMP_RESPAWN_MIN)
                .unwrap_or(true);
            if matches!(new_state, ServiceState::Running | ServiceState::Error)
                && e.log_pump.is_none()
                && respawn_ok
            {
                e.log_pump_spawned_at = Some(now);
                match spawn_log_pump(&e.def.id, e.logs.clone()) {
                    Ok(lp) => {
                        e.pid = lp.id();
                        e.log_pump = Some(lp);
                    }
                    Err(err) => log::warn!("log pump {id}: {err}"),
                }
            }
        }
        report
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
            // Erster Versuch: base_delay nach dem Wechsel in Error.
            let first_due = entry.errored_since.map(|t| t + base_delay);
            let due = entry
                .next_recovery_at
                .or(first_due)
                .map(|t| now >= t)
                .unwrap_or(true);
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

/// Zustand eines Containers laut `docker compose ps`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComposeStatus {
    pub state: String,
    pub health: Option<String>,
}

/// Zerlegt JSON-Ausgaben von Compose v2. Je nach Version kommt ein JSON-Array
/// (bis ca. 2.20) oder ein Objekt pro Zeile (NDJSON, ab 2.21). Leere Ausgabe
/// (keine Container) → leere Liste. Unlesbare Zeilen werden uebersprungen.
pub(crate) fn parse_json_rows(stdout: &str) -> Vec<serde_json::Value> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return vec![];
    }
    if trimmed.starts_with('[') {
        if let Ok(serde_json::Value::Array(arr)) = serde_json::from_str(trimmed) {
            return arr;
        }
    }
    let mut out = Vec::new();
    for line in trimmed.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        match serde_json::from_str::<serde_json::Value>(line) {
            Ok(serde_json::Value::Array(arr)) => out.extend(arr),
            Ok(v @ serde_json::Value::Object(_)) => out.push(v),
            Ok(_) => {}
            Err(e) => log::warn!("compose json parse: {e} | line={line}"),
        }
    }
    out
}

/// `docker compose ps -a --format json` → Service-Name → Zustand.
pub(crate) fn parse_compose_ps(stdout: &str) -> HashMap<String, ComposeStatus> {
    let mut out = HashMap::new();
    for v in parse_json_rows(stdout) {
        let Some(service) = v.get("Service").and_then(|x| x.as_str()) else { continue };
        let state = v
            .get("State")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let health = v
            .get("Health")
            .and_then(|x| x.as_str())
            .map(|h| h.to_ascii_lowercase())
            .filter(|h| !h.is_empty());
        out.insert(service.to_string(), ComposeStatus { state, health });
    }
    out
}

/// Bildet den Compose-Zustand auf die UI-State-Machine ab (Tabelle in
/// ARCHITECTURE.md §4). `hold` = laufender/kurz zurueckliegender
/// compose-Aufruf, waehrenddessen bleibt ein `Starting` ohne Container
/// `Starting`.
pub(crate) fn map_state(cs: Option<&ComposeStatus>, current: ServiceState, hold: bool) -> ServiceState {
    let Some(s) = cs else {
        return if current == ServiceState::Starting && hold {
            ServiceState::Starting
        } else {
            ServiceState::Stopped
        };
    };
    if s.health.as_deref() == Some("unhealthy") {
        return ServiceState::Error;
    }
    match s.state.as_str() {
        "restarting" | "dead" => ServiceState::Error,
        "exited" | "stopped" | "removing" => ServiceState::Stopped,
        "created" | "paused" => ServiceState::Starting,
        "running" => match s.health.as_deref() {
            Some("starting") => ServiceState::Starting,
            _ => ServiceState::Running,
        },
        _ => ServiceState::Starting,
    }
}

/// Fragt `docker compose ps` ab — bewusst ohne Supervisor-Lock aufrufen.
/// Mit Timeout, damit ein haengender Daemon (z.B. Colima-VM eingefroren)
/// den Tick-Loop nicht blockiert.
pub async fn query_compose_status() -> Result<HashMap<String, ComposeStatus>, String> {
    let fut = Command::new("docker")
        .current_dir(services::compose_dir())
        .args(["compose", "ps", "-a", "--format", "json"])
        .kill_on_drop(true)
        .output();
    let output = tokio::time::timeout(Duration::from_secs(20), fut)
        .await
        .map_err(|_| "docker compose ps: Timeout (Daemon haengt?)".to_string())?
        .map_err(|e| format!("spawn: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(parse_compose_ps(&String::from_utf8_lossy(&output.stdout)))
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
    spawn_log_pump(service, logs)
}

/// Startet `docker compose logs -f` fuer einen Service. Der Ring-Buffer wird
/// dabei geleert und mit `--tail` neu befuellt — sonst wuerde jeder Respawn
/// die komplette Container-Historie noch einmal anhaengen (Duplikate).
fn spawn_log_pump(service: &str, logs: Arc<Mutex<VecDeque<String>>>) -> Result<Child, String> {
    let tail = LOG_RING_CAPACITY.to_string();
    let mut cmd = Command::new("docker");
    cmd.current_dir(services::compose_dir())
        .args(["compose", "logs", "-f", "--no-log-prefix", "--no-color", "--tail", &tail, service])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn docker compose logs: {e}"))?;
    if let Ok(mut buf) = logs.try_lock() {
        buf.clear();
    }
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
    // `read_until` statt `lines()`: eine Zeile mit ungueltigem UTF-8 wuerde
    // `lines()` mit Fehler beenden — dann liest niemand mehr die Pipe, sie
    // laeuft voll und `docker compose logs` blockiert fuer immer.
    let mut reader = BufReader::new(reader);
    let mut raw = Vec::with_capacity(256);
    loop {
        raw.clear();
        match reader.read_until(b'\n', &mut raw).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let line = String::from_utf8_lossy(&raw)
            .trim_end_matches(['\n', '\r'])
            .to_string();
        let mut buf = logs.lock().await;
        if buf.len() >= LOG_RING_CAPACITY {
            buf.pop_front();
        }
        buf.push_back(line);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NDJSON: &str = r#"{"ID":"a1","Name":"rapport-pb","Service":"pb","State":"running","Health":"healthy","Image":"reg/pb:main"}
{"ID":"b2","Name":"rapport-server-app","Service":"app","State":"exited","Health":"","ExitCode":0}
"#;
    const ARRAY: &str = r#"[{"Service":"pb","State":"running","Health":"starting"},{"Service":"app","State":"restarting"}]"#;

    #[test]
    fn parse_ndjson() {
        let m = parse_compose_ps(NDJSON);
        assert_eq!(m.len(), 2);
        assert_eq!(m["pb"].state, "running");
        assert_eq!(m["pb"].health.as_deref(), Some("healthy"));
        assert_eq!(m["app"].health, None);
    }

    #[test]
    fn parse_array_and_empty() {
        let m = parse_compose_ps(ARRAY);
        assert_eq!(m["pb"].health.as_deref(), Some("starting"));
        assert_eq!(m["app"].state, "restarting");
        assert!(parse_compose_ps("").is_empty());
        assert!(parse_compose_ps("  \n").is_empty());
        assert!(parse_compose_ps("[]").is_empty());
        // Muell-Zeilen werden uebersprungen, gueltige bleiben
        let m = parse_compose_ps("WARN irgendwas\n{\"Service\":\"pb\",\"State\":\"running\"}\n");
        assert_eq!(m.len(), 1);
    }

    fn cs(state: &str, health: Option<&str>) -> ComposeStatus {
        ComposeStatus { state: state.into(), health: health.map(Into::into) }
    }

    #[test]
    fn state_mapping() {
        use ServiceState as S;
        let r = |c: ComposeStatus| map_state(Some(&c), S::Stopped, false);
        assert_eq!(r(cs("running", Some("healthy"))), S::Running);
        assert_eq!(r(cs("running", None)), S::Running);
        assert_eq!(r(cs("running", Some("starting"))), S::Starting);
        assert_eq!(r(cs("running", Some("unhealthy"))), S::Error);
        assert_eq!(r(cs("restarting", None)), S::Error);
        assert_eq!(r(cs("dead", None)), S::Error);
        assert_eq!(r(cs("exited", None)), S::Stopped);
        assert_eq!(r(cs("created", None)), S::Starting);
        assert_eq!(r(cs("paused", None)), S::Starting);
        // nicht in ps
        assert_eq!(map_state(None, S::Running, false), S::Stopped);
        assert_eq!(map_state(None, S::Starting, true), S::Starting);
        // Starting ohne laufenden compose-Aufruf haengt nicht ewig
        assert_eq!(map_state(None, S::Starting, false), S::Stopped);
    }

    fn sv_with(ids: &[&str]) -> Supervisor {
        let mut sv = Supervisor::new();
        for id in ids {
            sv.register(ServiceDef {
                id: (*id).into(),
                display_name: (*id).into(),
                port: 1,
                depends_on: vec![],
            });
        }
        sv
    }

    #[test]
    fn docker_lost_and_back() {
        let mut sv = sv_with(&["pb"]);
        sv.services.get_mut("pb").unwrap().state = ServiceState::Running;
        let r = sv.apply_health(Err("Cannot connect".into()));
        assert!(r.docker_lost.is_some());
        assert!(r.newly_errored.is_empty());
        assert_eq!(sv.status("pb").unwrap().state, ServiceState::Stopped);
        assert!(sv.status("pb").unwrap().last_error.unwrap().contains("Docker"));
        // zweiter Fehler-Tick meldet nicht erneut
        assert!(sv.apply_health(Err("x".into())).docker_lost.is_none());
        let r = sv.apply_health(Ok(HashMap::new()));
        assert!(r.docker_back);
        assert_eq!(sv.status("pb").unwrap().last_error, None);
    }

    // tokio-Runtime noetig: apply_health versucht fuer Error-Services einen
    // Log-Pump zu starten (scheitert ohne docker folgenlos).
    #[tokio::test]
    async fn error_transition_and_recovery_backoff() {
        let mut sv = sv_with(&["pb"]);
        let mut m = HashMap::new();
        m.insert("pb".to_string(), cs("restarting", None));
        let r = sv.apply_health(Ok(m.clone()));
        assert_eq!(r.newly_errored, vec!["pb".to_string()]);
        // im selben Zustand: keine neue Meldung
        assert!(sv.apply_health(Ok(m)).newly_errored.is_empty());
        // erster Versuch erst nach base_delay
        let rep = sv.recovery_candidates(3, Duration::from_secs(3600));
        assert!(rep.to_restart.is_empty());
        let rep = sv.recovery_candidates(3, Duration::ZERO);
        assert_eq!(rep.to_restart, vec!["pb".to_string()]);
        let rep = sv.recovery_candidates(3, Duration::ZERO);
        assert_eq!(rep.to_restart.len(), 1);
        let rep = sv.recovery_candidates(3, Duration::ZERO);
        assert_eq!(rep.maxed_out, vec!["pb".to_string()]);
        // danach Ruhe
        let rep = sv.recovery_candidates(3, Duration::ZERO);
        assert!(rep.to_restart.is_empty() && rep.maxed_out.is_empty());
    }
}
