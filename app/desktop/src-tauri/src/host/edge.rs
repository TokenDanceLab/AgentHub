use crate::edge_manager::{EdgeHostReadiness, EdgeStatus, SharedEdgeManager};
use crate::host::auth::{build_packaged_login_readiness, PackagedLoginReadiness};
use serde::Serialize;
use std::collections::VecDeque;
use std::env;
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::State;

#[derive(Debug, Clone, Serialize)]
pub struct LocalEdgeLogTail {
    pub stdout: Vec<String>,
    pub stderr: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalEdgeDiagnostics {
    pub readiness: EdgeHostReadiness,
    pub status: EdgeStatus,
    pub local_cli_discovery: LocalCliDiscoveryManifest,
    pub packaged_login: PackagedLoginReadiness,
    pub log_tail: LocalEdgeLogTail,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCliDiscoveryItem {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub version: Option<String>,
    pub path: String,
    pub no_spend: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCliDiscoveryManifest {
    pub mode: String,
    pub readiness_manifest: String,
    pub readiness_script: String,
    pub generated_at: Option<String>,
    pub items: Vec<LocalCliDiscoveryItem>,
}

#[tauri::command]
pub async fn get_edge_status(state: State<'_, SharedEdgeManager>) -> Result<EdgeStatus, String> {
    let mgr = state.lock().await;
    Ok(mgr.status())
}

#[tauri::command]
pub async fn get_edge_host_readiness(
    app: tauri::AppHandle,
    state: State<'_, SharedEdgeManager>,
) -> Result<EdgeHostReadiness, String> {
    let mgr = state.lock().await;
    Ok(mgr.host_readiness_for_app(&app))
}

#[tauri::command]
pub async fn get_local_edge_diagnostics(
    app: tauri::AppHandle,
    state: State<'_, SharedEdgeManager>,
) -> Result<LocalEdgeDiagnostics, String> {
    let mgr = state.lock().await;
    let readiness = mgr.host_readiness_for_app(&app);
    let status = mgr.status();
    let packaged_login = build_packaged_login_readiness();
    let log_tail = LocalEdgeLogTail {
        stdout: read_log_tail(&readiness.log_paths.stdout, 20),
        stderr: read_log_tail(&readiness.log_paths.stderr, 20),
    };

    Ok(LocalEdgeDiagnostics {
        readiness,
        status,
        local_cli_discovery: build_local_cli_discovery(),
        packaged_login,
        log_tail,
    })
}

#[tauri::command]
pub async fn get_local_cli_discovery() -> Result<LocalCliDiscoveryManifest, String> {
    Ok(build_local_cli_discovery())
}

#[tauri::command]
pub async fn get_edge_auth_token(state: State<'_, SharedEdgeManager>) -> Result<String, String> {
    let mgr = state.lock().await;
    mgr.local_auth_token().map(str::to_string)
}

fn build_local_cli_discovery() -> LocalCliDiscoveryManifest {
    LocalCliDiscoveryManifest {
        mode: "no-spend-discovery".to_string(),
        readiness_manifest: "docs/governance/README.md".to_string(),
        readiness_script: "scripts/verify/verify-edge-cli-real-readiness.py".to_string(),
        generated_at: None,
        items: vec![
            discover_cli("codex", "Codex CLI", "codex", "AGENTHUB_CODEX_PATH"),
            discover_cli(
                "claude-code",
                "Claude Code",
                "claude",
                "AGENTHUB_CLAUDE_CODE_PATH",
            ),
            discover_cli(
                "opencode",
                "OpenCode",
                "opencode",
                "AGENTHUB_OPENCODE_PATH",
            ),
        ],
    }
}

fn discover_cli(id: &str, name: &str, command: &str, env_var: &str) -> LocalCliDiscoveryItem {
    let configured = env::var(env_var)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| command.to_string());
    let resolved_path = resolve_cli_path(&configured);
    let installed = resolved_path.is_some();
    let path = resolved_path.unwrap_or(configured);
    let version = if installed {
        read_cli_version(&path)
    } else {
        None
    };

    LocalCliDiscoveryItem {
        id: id.to_string(),
        name: name.to_string(),
        installed,
        version,
        path,
        no_spend: true,
    }
}

fn resolve_cli_path(command: &str) -> Option<String> {
    let candidate = Path::new(command);
    if candidate.is_absolute() || command.contains('/') || command.contains('\\') {
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
        return None;
    }

    let lookup = if cfg!(target_os = "windows") {
        ("where.exe", command)
    } else {
        ("which", command)
    };
    let output = Command::new(lookup.0).arg(lookup.1).output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

fn read_cli_version(path: &str) -> Option<String> {
    let mut child = Command::new(path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => {
                let output = child.wait_with_output().ok()?;
                let text = if output.stdout.is_empty() {
                    String::from_utf8_lossy(&output.stderr)
                } else {
                    String::from_utf8_lossy(&output.stdout)
                };
                return text
                    .lines()
                    .map(str::trim)
                    .find(|line| !line.is_empty())
                    .map(|line| line.chars().take(120).collect());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    Some("version probe timed out".to_string())
}

#[tauri::command]
pub async fn get_packaged_login_readiness() -> Result<PackagedLoginReadiness, String> {
    Ok(build_packaged_login_readiness())
}

fn read_log_tail(path: &str, max_lines: usize) -> Vec<String> {
    if max_lines == 0 || path.starts_with("<app-data>") {
        return Vec::new();
    }

    let Ok(content) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut tail = VecDeque::with_capacity(max_lines);
    for line in content.lines() {
        if tail.len() == max_lines {
            tail.pop_front();
        }
        tail.push_back(line.to_string());
    }
    tail.into_iter().collect()
}

#[tauri::command]
pub async fn start_edge(
    app: tauri::AppHandle,
    state: State<'_, SharedEdgeManager>,
) -> Result<EdgeStatus, String> {
    let mut mgr = state.lock().await;
    mgr.start(&app).await?;
    Ok(mgr.status())
}

#[tauri::command]
pub async fn stop_edge(state: State<'_, SharedEdgeManager>) -> Result<EdgeStatus, String> {
    let mut mgr = state.lock().await;
    mgr.stop().await?;
    Ok(mgr.status())
}

#[cfg(test)]
pub(crate) fn edge_host_readiness_snapshot(
    mgr: &crate::edge_manager::EdgeManager,
) -> EdgeHostReadiness {
    mgr.host_readiness()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edge_manager::EdgeManager;
    use std::path::PathBuf;

    #[test]
    fn edge_host_readiness_command_snapshot_is_sidecar_only() {
        let manager = EdgeManager::new(
            PathBuf::from("edge-server/agenthub-edge"),
            PathBuf::from("agenthub-edge.sqlite"),
        )
        .expect("test token generation should succeed");

        let readiness = edge_host_readiness_snapshot(&manager);

        assert_eq!(readiness.sidecar_name, "agenthub-edge");
        assert_eq!(readiness.target_id, "local-edge");
        assert_eq!(readiness.route, "local-edge-api");
        assert_eq!(readiness.bind_addr, "127.0.0.1:3210");
        assert_eq!(readiness.health_url, "http://127.0.0.1:3210/v1/health");
        assert_eq!(
            readiness.log_paths.stdout,
            "<app-data>/edge-logs/local-edge.stdout.log"
        );
        assert!(readiness.preflight.auth_token_ready);
        assert_eq!(
            readiness.sidecar_args,
            vec![
                "--store-backend",
                "sqlite",
                "--store-db",
                "<app-data>/agenthub-edge.sqlite",
                "--addr",
                "127.0.0.1:3210",
                "--runner-profile",
                "claude-code",
            ]
        );
        assert!(!readiness.running);
        assert!(!readiness.direct_cli_spawn);
    }

    #[test]
    fn local_cli_discovery_missing_probe_is_no_spend() {
        let item = discover_cli(
            "codex",
            "Codex CLI",
            "agenthub-definitely-missing-cli-for-test",
            "AGENTHUB_MISSING_CLI_FOR_TEST",
        );

        assert_eq!(item.id, "codex");
        assert_eq!(item.name, "Codex CLI");
        assert!(!item.installed);
        assert_eq!(item.version, None);
        assert_eq!(item.path, "agenthub-definitely-missing-cli-for-test");
        assert!(item.no_spend);
    }

    #[test]
    fn local_cli_discovery_manifest_advertises_readiness_gate() {
        let manifest = build_local_cli_discovery();

        assert_eq!(manifest.mode, "no-spend-discovery");
        assert_eq!(
            manifest.readiness_manifest,
            "docs/governance/README.md"
        );
        assert_eq!(
            manifest.readiness_script,
            "scripts/verify/verify-edge-cli-real-readiness.py"
        );
        assert_eq!(manifest.items.len(), 3);
        assert!(manifest.items.iter().all(|item| item.no_spend));
        assert!(manifest
            .items
            .iter()
            .all(|item| ["codex", "claude-code", "opencode"].contains(&item.id.as_str())));
    }
}
