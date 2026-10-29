//! Globaler App-Event-Log fuer das Status-Dashboard.
//!
//! Ringbuffer (max 100 Eintraege) mit Timestamp + Severity + Message.
//! Wird von verschiedenen Stellen geschrieben (Supervisor, Backup-Scheduler,
//! Container-Update, Pre-Pull, App-Startup) und vom Frontend gepollt.

use chrono::Local;
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::OnceLock;
use tokio::sync::Mutex;

const CAPACITY: usize = 100;

#[derive(Debug, Clone, Serialize)]
pub struct Event {
    pub ts_iso: String,
    pub kind: &'static str,
    pub message: String,
}

static EVENTS: OnceLock<Mutex<VecDeque<Event>>> = OnceLock::new();

fn store() -> &'static Mutex<VecDeque<Event>> {
    EVENTS.get_or_init(|| Mutex::new(VecDeque::with_capacity(CAPACITY)))
}

pub async fn append(kind: &'static str, message: impl Into<String>) {
    let msg = message.into();
    log::info!("[event] {}", msg);
    let mut q = store().lock().await;
    if q.len() >= CAPACITY {
        q.pop_front();
    }
    q.push_back(Event {
        ts_iso: Local::now().to_rfc3339(),
        kind,
        message: msg,
    });
}

pub async fn info(msg: impl Into<String>) {
    append("info", msg).await
}

pub async fn warn(msg: impl Into<String>) {
    append("warn", msg).await
}

pub async fn error(msg: impl Into<String>) {
    append("error", msg).await
}

pub async fn list() -> Vec<Event> {
    let q = store().lock().await;
    q.iter().rev().cloned().collect()
}
