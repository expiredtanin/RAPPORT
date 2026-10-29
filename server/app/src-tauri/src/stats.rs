//! Container-Live-Stats via `docker stats --no-stream`.
//!
//! Wird auf Demand abgerufen (separater Tauri-Command + HTTP-Endpoint),
//! NICHT in den 2s-Health-Tick eingehaengt — `docker stats` braucht selbst
//! ~500ms-1s und wuerde den UI-Poll ausbremsen.

use serde::Serialize;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct ContainerStats {
    /// Compose-Service-ID (z.B. `db`, `auth`) — abgeleitet vom Container-Namen.
    pub service_id: String,
    pub cpu_percent: f32,
    pub mem_bytes: u64,
    pub mem_percent: f32,
}

pub async fn collect() -> Vec<ContainerStats> {
    let out = Command::new("docker")
        .args(["stats", "--no-stream", "--format", "{{json .}}"])
        .output()
        .await;
    let stdout = match out {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
        _ => return vec![],
    };

    let mut stats = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let name = v.get("Name").and_then(|x| x.as_str()).unwrap_or("");
        let Some(service_id) = name.strip_prefix("rapport-").map(str::to_string) else {
            continue;
        };
        // Sonderfall: das Frontend-Image heisst `rapport-server-app` in compose
        // (container_name), aber Compose-Service ist `app`. Manuelles Mapping.
        let service_id = if service_id == "server-app" {
            "app".into()
        } else {
            service_id
        };
        let cpu = parse_percent(v.get("CPUPerc").and_then(|x| x.as_str()).unwrap_or(""));
        let mem_pct = parse_percent(v.get("MemPerc").and_then(|x| x.as_str()).unwrap_or(""));
        let mem_bytes = parse_mem_usage(v.get("MemUsage").and_then(|x| x.as_str()).unwrap_or(""));
        stats.push(ContainerStats {
            service_id,
            cpu_percent: cpu,
            mem_bytes,
            mem_percent: mem_pct,
        });
    }
    stats
}

fn parse_percent(s: &str) -> f32 {
    s.trim_end_matches('%').trim().parse().unwrap_or(0.0)
}

/// "55.32MiB / 7.756GiB" → 55.32 MiB in Bytes
fn parse_mem_usage(s: &str) -> u64 {
    let part = s.split('/').next().unwrap_or("").trim();
    parse_size(part)
}

fn parse_size(s: &str) -> u64 {
    let split_idx = s.find(|c: char| c.is_alphabetic()).unwrap_or(s.len());
    let (num_str, unit) = s.split_at(split_idx);
    let n: f64 = num_str.parse().unwrap_or(0.0);
    let mul = match unit.trim().to_lowercase().as_str() {
        "b" => 1.0,
        "kib" | "kb" | "k" => 1024.0,
        "mib" | "mb" | "m" => 1024.0 * 1024.0,
        "gib" | "gb" | "g" => 1024.0 * 1024.0 * 1024.0,
        "tib" | "tb" | "t" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => 1.0,
    };
    (n * mul) as u64
}
