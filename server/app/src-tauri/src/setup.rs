//! Setup-Wizard: Detection + Direct-Download-Installation von Docker-CLI,
//! Colima und Lima. Kein Brew, keine externen Package-Manager.
//!
//! Layout:
//!   ~/.rapport/
//!     ├── bin/
//!     │   ├── docker
//!     │   ├── docker-compose
//!     │   ├── colima
//!     │   └── limactl
//!     ├── lima-share/    (von Lima-Tarball, share/lima/)
//!     └── home/          (HOME-Override fuer Colima/Lima Konfig)
//!
//! `lib.rs::run()` prependet `~/.rapport/bin` an PATH und setzt `LIMA_HOME`
//! etc. damit die Tools die mitgelieferten Files finden.

use serde::Serialize;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

// ---- Pinned Versionen ----------------------------------------------------
const DOCKER_VERSION: &str = "29.5.2";
const COLIMA_VERSION: &str = "v0.10.1";
const LIMA_VERSION: &str = "v2.1.1";
// Quelle fuer den Compose-Stack — wird beim Setup-Wizard automatisch nach
// ~/.rapport/compose/ heruntergeladen wenn lokal noch nichts gefunden wird.
const COMPOSE_TARBALL_URL: &str =
    "https://git.openbureau.ch/karim/RAPPORT-SERVER/archive/main.tar.gz";

#[derive(Debug, Clone, Serialize)]
pub struct SetupStatus {
    pub docker_cli: bool,
    pub colima_installed: bool,
    pub limactl_installed: bool,
    pub daemon_running: bool,
    pub ready: bool,
    pub recommended_action: RecommendedAction,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RecommendedAction {
    /// Alles ok — UI rendert das Dashboard.
    NoneReady,
    /// Tools alle installiert, nur Daemon ist aus → `colima start`.
    StartColima,
    /// Tools fehlen → Direct-Download.
    InstallAll,
}

pub fn install_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".rapport")
}

pub fn bin_dir() -> PathBuf {
    install_dir().join("bin")
}

pub fn compose_dir() -> PathBuf {
    install_dir().join("compose")
}

/// Lima erwartet die Templates relativ zur Binary unter `<bin>/../share/lima/`.
/// Wir halten uns an dieses Layout in `~/.rapport/share/`.
fn lima_share_dir() -> PathBuf {
    install_dir().join("share")
}

pub async fn status() -> SetupStatus {
    let docker_cli = bin_exists("docker") || which("docker").await;
    let colima_installed = bin_exists("colima") || which("colima").await;
    let limactl_installed = bin_exists("limactl") || which("limactl").await;
    let daemon_running = if docker_cli { docker_info_ok().await } else { false };
    let ready = daemon_running;
    let action = if ready {
        RecommendedAction::NoneReady
    } else if docker_cli && colima_installed && limactl_installed {
        RecommendedAction::StartColima
    } else {
        RecommendedAction::InstallAll
    };
    SetupStatus {
        docker_cli,
        colima_installed,
        limactl_installed,
        daemon_running,
        ready,
        recommended_action: action,
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct InstallResult {
    pub finished_at_iso: String,
    pub log: String,
}

pub async fn install_and_start() -> Result<InstallResult, String> {
    let s = status().await;
    crate::events::info(format!("Setup: Aktion = {:?}", s.recommended_action)).await;
    let mut log = String::new();

    if matches!(s.recommended_action, RecommendedAction::InstallAll) {
        download_all(&mut log).await?;
    }

    // Compose-Stack-Bootstrap: nur wenn noch nichts gefunden wird (z.B.
    // Erst-Install). Wer eine eigene SERVER-CONTAINER-Repo hat (lokaler
    // Klon unter ~/RAPPORT/SERVER-CONTAINER/) bleibt unberuehrt.
    if let Err(_) = crate::services::init_compose_dir(None) {
        bootstrap_compose_stack(&mut log).await?;
    }

    crate::events::info("Setup: colima start ...").await;
    log.push_str("\n=== colima start ===\n");
    let colima = pick_path("colima");
    let limactl = pick_path("limactl");
    let extra_path = format!(
        "{}:{}",
        bin_dir().display(),
        std::env::var("PATH").unwrap_or_default()
    );
    let out = Command::new(&colima)
        .args(["start", "--cpu", "2", "--memory", "4", "--disk", "30"])
        .env("PATH", &extra_path)
        .env("LIMA_HOME", install_dir().join("lima-home"))
        .env("HOME", std::env::var("HOME").unwrap_or_default())
        .output()
        .await
        .map_err(|e| format!("spawn colima ({}): {e}", colima.display()))?;
    log.push_str(&format!(
        "stdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    ));
    if !out.status.success() {
        return Err(format!("colima start failed:\n{log}\n\nlimactl: {}", limactl.display()));
    }

    let after = status().await;
    if !after.daemon_running {
        return Err(format!(
            "Daemon nach Setup nicht erreichbar. Log:\n{log}"
        ));
    }
    crate::events::info("Setup fertig: Daemon laeuft").await;
    Ok(InstallResult {
        finished_at_iso: chrono::Local::now().to_rfc3339(),
        log,
    })
}

// ---------------------------------------------------------------------------
// Direct-Download-Sektion
// ---------------------------------------------------------------------------

async fn download_all(log: &mut String) -> Result<(), String> {
    let arch = detect_arch()?;
    std::fs::create_dir_all(bin_dir()).map_err(|e| format!("mkdir bin: {e}"))?;
    std::fs::create_dir_all(lima_share_dir()).map_err(|e| format!("mkdir lima-share: {e}"))?;

    // Lima zuerst (Colima braucht es).
    if !file_exists(&bin_dir().join("limactl")) {
        install_lima(&arch, log).await?;
    }
    if !file_exists(&bin_dir().join("colima")) {
        install_colima(&arch, log).await?;
    }
    if !file_exists(&bin_dir().join("docker")) {
        install_docker(&arch, log).await?;
    }
    Ok(())
}

struct Arch {
    /// `arm64` oder `amd64`
    docker_label: &'static str,
    /// `Darwin-arm64` oder `Darwin-x86_64`
    colima_label: &'static str,
    /// `Darwin-arm64` oder `Darwin-x86_64`
    lima_label: &'static str,
    /// `aarch64` oder `x86_64` (subdir auf download.docker.com)
    docker_subdir: &'static str,
}

fn detect_arch() -> Result<Arch, String> {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Ok(Arch {
            docker_label: "arm64",
            colima_label: "Darwin-arm64",
            lima_label: "Darwin-arm64",
            docker_subdir: "aarch64",
        })
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Ok(Arch {
            docker_label: "amd64",
            colima_label: "Darwin-x86_64",
            lima_label: "Darwin-x86_64",
            docker_subdir: "x86_64",
        })
    } else {
        Err("Setup-Wizard unterstuetzt aktuell nur macOS (Mac Intel + Apple Silicon)".into())
    }
}

async fn install_lima(arch: &Arch, log: &mut String) -> Result<(), String> {
    let url = format!(
        "https://github.com/lima-vm/lima/releases/download/{LIMA_VERSION}/lima-{ver}-{lbl}.tar.gz",
        ver = LIMA_VERSION.trim_start_matches('v'),
        lbl = arch.lima_label
    );
    crate::events::info(format!("Setup: lade Lima {LIMA_VERSION} ...")).await;
    log.push_str(&format!("=== lima ===\n{url}\n"));
    let tmp = tempdir_path("lima.tar.gz");
    download_to(&url, &tmp).await?;
    let extract_to = install_dir();
    extract_tar_gz(&tmp, &extract_to).await?;
    // Tarball legt `bin/` und `share/` ab — moven nach unserer Struktur.
    let _ = std::fs::rename(extract_to.join("bin/limactl"), bin_dir().join("limactl"));
    let _ = std::fs::rename(extract_to.join("share"), lima_share_dir());
    let _ = std::fs::remove_dir(extract_to.join("bin"));
    let _ = std::fs::remove_file(&tmp);
    chmod_x(&bin_dir().join("limactl"))?;
    unquarantine(&bin_dir().join("limactl"));
    Ok(())
}

async fn install_colima(arch: &Arch, log: &mut String) -> Result<(), String> {
    let url = format!(
        "https://github.com/abiosoft/colima/releases/download/{COLIMA_VERSION}/colima-{lbl}",
        lbl = arch.colima_label
    );
    crate::events::info(format!("Setup: lade Colima {COLIMA_VERSION} ...")).await;
    log.push_str(&format!("\n=== colima ===\n{url}\n"));
    let dest = bin_dir().join("colima");
    download_to(&url, &dest).await?;
    chmod_x(&dest)?;
    unquarantine(&dest);
    Ok(())
}

async fn install_docker(arch: &Arch, log: &mut String) -> Result<(), String> {
    let url = format!(
        "https://download.docker.com/mac/static/stable/{sub}/docker-{ver}.tgz",
        sub = arch.docker_subdir,
        ver = DOCKER_VERSION
    );
    crate::events::info(format!("Setup: lade Docker-CLI {DOCKER_VERSION} ...")).await;
    log.push_str(&format!("\n=== docker ===\n{url}\n"));
    let tmp = tempdir_path("docker.tgz");
    download_to(&url, &tmp).await?;
    let extract_to = tempdir_path("docker-extract");
    std::fs::create_dir_all(&extract_to).map_err(|e| format!("mkdir extract: {e}"))?;
    extract_tar_gz(&tmp, &extract_to).await?;
    // Tarball-Layout: docker/{docker,docker-compose,docker-buildx,...}
    let src = extract_to.join("docker");
    for bin in &["docker", "docker-compose", "docker-buildx"] {
        let from = src.join(bin);
        let to = bin_dir().join(bin);
        if from.exists() {
            let _ = std::fs::rename(&from, &to);
            chmod_x(&to)?;
            unquarantine(&to);
        }
    }
    let _ = std::fs::remove_dir_all(&extract_to);
    let _ = std::fs::remove_file(&tmp);
    Ok(())
}

// ---------------------------------------------------------------------------
// Compose-Stack-Bootstrap
// ---------------------------------------------------------------------------

async fn bootstrap_compose_stack(log: &mut String) -> Result<(), String> {
    crate::events::info("Setup: lade Compose-Stack von Gitea ...").await;
    log.push_str("\n=== compose-stack download ===\n");

    let dest = compose_dir();
    std::fs::create_dir_all(&dest).map_err(|e| format!("mkdir compose dir: {e}"))?;

    let tmp = tempdir_path("compose.tar.gz");
    download_to(COMPOSE_TARBALL_URL, &tmp).await?;
    // Gitea-Archiv legt einen Top-Level-Ordner an — strip-components=1
    let status = Command::new("tar")
        .args(["-xzf"])
        .arg(&tmp)
        .args(["-C"])
        .arg(&dest)
        .arg("--strip-components=1")
        .status()
        .await
        .map_err(|e| format!("spawn tar: {e}"))?;
    if !status.success() {
        return Err(format!("tar -xzf {} failed", tmp.display()));
    }
    let _ = std::fs::remove_file(&tmp);

    // .env aus .env.example mit unseren Secrets generieren — sonst startet
    // compose nicht.
    let env_path = dest.join(".env");
    if !env_path.exists() {
        let example_path = dest.join(".env.example");
        let template = if example_path.exists() {
            std::fs::read_to_string(&example_path)
                .map_err(|e| format!("read .env.example: {e}"))?
        } else {
            String::new()
        };
        let env_content = render_compose_env(&template)?;
        std::fs::write(&env_path, env_content).map_err(|e| format!("write .env: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&env_path, std::fs::Permissions::from_mode(0o600));
        }
        crate::events::info(format!(".env generiert: {}", env_path.display())).await;
    }

    crate::events::info(format!("Compose-Stack bereit unter {}", dest.display())).await;
    Ok(())
}

/// Generiert eine `.env` aus dem Template — bekannte Keys mit Werten aus
/// unserer `config.env` oder mit sinnvollen Defaults, unbekannte werden 1:1
/// uebernommen falls schon ein Wert dort steht, sonst leer gelassen.
fn render_compose_env(template: &str) -> Result<String, String> {
    let app_cfg = crate::config::load().unwrap_or_default();
    let superuser_email = app_cfg
        .get("PB_SUPERUSER_EMAIL")
        .cloned()
        .ok_or_else(|| "PB_SUPERUSER_EMAIL fehlt in config.env".to_string())?;
    let superuser_password = app_cfg
        .get("PB_SUPERUSER_PASSWORD")
        .cloned()
        .ok_or_else(|| "PB_SUPERUSER_PASSWORD fehlt in config.env".to_string())?;
    let api_external_url = app_cfg
        .get("API_EXTERNAL_URL")
        .cloned()
        .unwrap_or_else(|| "http://localhost:18090".into());

    let defaults: std::collections::HashMap<&str, String> = [
        ("PB_SUPERUSER_EMAIL", superuser_email),
        ("PB_SUPERUSER_PASSWORD", superuser_password),
        ("API_EXTERNAL_URL", api_external_url),
        ("APP_PORT", "18080".into()),
        ("PB_PORT", "18090".into()),
        ("RAPPORT_APP_TAG", "main".into()),
        ("RAPPORT_PB_TAG", "main".into()),
    ]
    .into_iter()
    .collect();

    let mut out = String::from("# Auto-generiert vom RAPPORT Server-App Setup-Wizard.\n");
    out.push_str("# Werte koennen hier oder im Settings-Tab der App geaendert werden.\n\n");
    for line in template.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            out.push_str(line);
            out.push('\n');
            continue;
        }
        if let Some(eq_pos) = trimmed.find('=') {
            let key = trimmed[..eq_pos].trim();
            if let Some(val) = defaults.get(key) {
                out.push_str(&format!("{key}={val}\n"));
            } else {
                // Unbekannter Key — 1:1 uebernehmen
                out.push_str(line);
                out.push('\n');
            }
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn bin_exists(name: &str) -> bool {
    file_exists(&bin_dir().join(name))
}

fn file_exists(p: &std::path::Path) -> bool {
    p.is_file()
}

fn pick_path(name: &str) -> PathBuf {
    let local = bin_dir().join(name);
    if local.is_file() {
        local
    } else {
        PathBuf::from(name) // PATH-Lookup
    }
}

async fn which(cmd: &str) -> bool {
    match Command::new("which").arg(cmd).output().await {
        Ok(o) => o.status.success() && !o.stdout.is_empty(),
        Err(_) => false,
    }
}

async fn docker_info_ok() -> bool {
    let docker = pick_path("docker");
    let extra_path = format!(
        "{}:{}",
        bin_dir().display(),
        std::env::var("PATH").unwrap_or_default()
    );
    match Command::new(&docker)
        .arg("info")
        .env("PATH", &extra_path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
    {
        Ok(s) => s.success(),
        Err(_) => false,
    }
}

fn tempdir_path(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("rapport-setup-{name}"))
}

async fn download_to(url: &str, dest: &std::path::Path) -> Result<(), String> {
    let resp = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("reqwest build: {e}"))?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("http get {url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {} fuer {url}", resp.status()));
    }
    let mut out = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("create {}: {e}", dest.display()))?;
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("read body: {e}"))?;
    out.write_all(&bytes)
        .await
        .map_err(|e| format!("write {}: {e}", dest.display()))?;
    out.flush().await.map_err(|e| format!("flush: {e}"))?;
    Ok(())
}

async fn extract_tar_gz(tar_path: &std::path::Path, out_dir: &std::path::Path) -> Result<(), String> {
    let status = Command::new("tar")
        .args(["-xzf"])
        .arg(tar_path)
        .arg("-C")
        .arg(out_dir)
        .status()
        .await
        .map_err(|e| format!("spawn tar: {e}"))?;
    if !status.success() {
        return Err(format!("tar -xzf {} failed", tar_path.display()));
    }
    let _ = AsyncReadExt::read(&mut tokio::io::empty(), &mut [0u8; 0]).await; // silence unused
    Ok(())
}

fn chmod_x(p: &std::path::Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o755);
        std::fs::set_permissions(p, perms).map_err(|e| format!("chmod {}: {e}", p.display()))?;
    }
    let _ = p;
    Ok(())
}

fn unquarantine(p: &std::path::Path) {
    // Macht aus dem GitHub-Download eine "vertrauenswuerdige" Datei, sonst
    // blockt macOS Gatekeeper das Ausfuehren beim ersten Mal.
    let _ = std::process::Command::new("xattr")
        .args(["-d", "com.apple.quarantine"])
        .arg(p)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}
