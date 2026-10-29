//! Health-Probes für Subprozesse.
//!
//! Jeder Service hat einen Probe-Typ. `HealthProbe::check()` ist async und
//! liefert `Ok(())` wenn der Service als gesund gilt, sonst eine Fehler-
//! beschreibung.

use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HealthProbe {
    /// HTTP GET, erwartet 2xx-Status.
    Http { url: String },
}

const TIMEOUT: Duration = Duration::from_secs(3);

impl HealthProbe {
    pub async fn check(&self) -> Result<(), String> {
        match self {
            HealthProbe::Http { url } => check_http(url).await,
        }
    }
}

async fn check_http(url: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| format!("reqwest build: {e}"))?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("http get {url}: {e}"))?;
    if resp.status().is_success() || resp.status().is_redirection() {
        Ok(())
    } else {
        Err(format!("status {}", resp.status()))
    }
}
