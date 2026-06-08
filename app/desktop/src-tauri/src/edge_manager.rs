use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{Manager, Runtime};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

const DEFAULT_EDGE_PORT: u16 = 3210;
const EDGE_SIDECAR_NAME: &str = "agenthub-edge";
const LOCAL_EDGE_TARGET_ID: &str = "local-edge";
const LOCAL_EDGE_ROUTE: &str = "local-edge-api";
const DEFAULT_RUNNER_PROFILE: &str = "claude-code";
const READINESS_STORE_FILE_PLACEHOLDER: &str = "<app-data>/agenthub-edge-store.json";

#[derive(Debug, Clone, serde::Serialize)]
pub struct EdgeStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub port: u16,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct EdgeHostReadiness {
    pub running: bool,
    pub pid: Option<u32>,
    pub port: u16,
    pub sidecar_name: &'static str,
    pub target_id: &'static str,
    pub route: &'static str,
    pub bind_addr: String,
    pub sidecar_args: Vec<String>,
    pub direct_cli_spawn: bool,
}

/// Wrapper for the two child-process types: Tauri sidecar (release) or
/// tokio process (dev).
enum EdgeChild {
    Sidecar {
        child: CommandChild,
        pid: u32,
        #[allow(dead_code)]
        event_task: tokio::task::JoinHandle<()>,
    },
    Direct {
        child: Child,
    },
}

pub struct EdgeManager {
    child: Option<EdgeChild>,
    edge_path: PathBuf,
    store_path: PathBuf,
    local_auth_token: String,
    port: u16,
}

impl EdgeManager {
    pub fn new(edge_path: PathBuf, store_path: PathBuf) -> Result<Self, String> {
        Ok(Self {
            child: None,
            edge_path,
            store_path,
            local_auth_token: generate_local_auth_token()?,
            port: DEFAULT_EDGE_PORT,
        })
    }

    /// Fallback constructor used when cryptographically-random token generation
    /// fails. Uses an empty token — Edge connections won't authenticate, but
    /// the app stays running instead of panicking.
    pub fn new_fallback(edge_path: PathBuf, store_path: PathBuf) -> Self {
        Self {
            child: None,
            edge_path,
            store_path,
            local_auth_token: String::new(),
            port: DEFAULT_EDGE_PORT,
        }
    }

    pub async fn start<R: Runtime>(
        &mut self,
        app_handle: &tauri::AppHandle<R>,
    ) -> Result<(), String> {
        if self.child.is_some() {
            return Err("Edge Server is already running".into());
        }

        let addr = edge_bind_addr(self.port);

        // Resolve store path: prefer app data dir over temp
        let store_path = match app_handle.path().app_data_dir() {
            Ok(dir) => {
                std::fs::create_dir_all(&dir)
                    .map_err(|e| format!("Failed to create app data dir: {}", e))?;
                dir.join("agenthub-edge-store.json")
            }
            Err(_) => self.store_path.clone(),
        };
        let store_path_str = store_path
            .to_str()
            .unwrap_or("agenthub-edge-store.json")
            .to_string();

        let args = edge_launch_args(&store_path_str, &addr);

        // ── Try sidecar first (release / bundled builds) ─────────────────
        if let Ok(sidecar_cmd) = app_handle.shell().sidecar(EDGE_SIDECAR_NAME) {
            let mut cmd = sidecar_cmd.args(&args);

            if cfg!(debug_assertions) {
                cmd = cmd.env("AGENTHUB_DEV", "1");
            } else {
                cmd = cmd.env("AGENTHUB_EDGE_AUTH_TOKEN", &self.local_auth_token);
            }

            match cmd.spawn() {
                Ok((mut rx, child)) => {
                    let pid = child.pid();

                    let event_task = tokio::spawn(async move {
                        while let Some(event) = rx.recv().await {
                            match event {
                                CommandEvent::Stdout(line) => {
                                    if let Ok(s) = String::from_utf8(line) {
                                        log::info!("[edge] {}", s.trim_end());
                                    }
                                }
                                CommandEvent::Stderr(line) => {
                                    if let Ok(s) = String::from_utf8(line) {
                                        log::warn!("[edge] {}", s.trim_end());
                                    }
                                }
                                CommandEvent::Error(e) => {
                                    log::error!("[edge] error: {}", e);
                                }
                                CommandEvent::Terminated(payload) => {
                                    log::info!(
                                        "[edge] terminated (code={:?}, signal={:?})",
                                        payload.code,
                                        payload.signal
                                    );
                                    break;
                                }
                                _ => {}
                            }
                        }
                    });

                    log::info!("Edge Server started via sidecar (pid={})", pid);
                    self.child = Some(EdgeChild::Sidecar {
                        child,
                        pid,
                        event_task,
                    });
                    return Ok(());
                }
                Err(e) => {
                    log::warn!("Sidecar spawn failed, falling back to direct path: {}", e);
                }
            }
        } else {
            log::debug!("Sidecar not available, falling back to direct path");
        }

        // ── Fallback: tokio::process::Command (dev mode) ─────────────────
        let mut command = Command::new(&self.edge_path);
        command.args(&args);
        if cfg!(debug_assertions) {
            command.env("AGENTHUB_DEV", "1");
        } else {
            command.env("AGENTHUB_EDGE_AUTH_TOKEN", &self.local_auth_token);
        }

        let child = command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Failed to start Edge Server: {}", e))?;

        let pid = child.id().unwrap_or(0);
        log::info!(
            "Edge Server started via direct path (pid={}, path={:?})",
            pid,
            self.edge_path
        );
        self.child = Some(EdgeChild::Direct { child });
        Ok(())
    }

    pub async fn stop(&mut self) -> Result<(), String> {
        match self.child.take() {
            Some(EdgeChild::Sidecar {
                child,
                pid,
                event_task,
            }) => {
                let _ = child.kill();
                event_task.abort();
                log::info!("Edge Server (sidecar, pid={}) stopped", pid);
                Ok(())
            }
            Some(EdgeChild::Direct { mut child }) => {
                child
                    .kill()
                    .await
                    .map_err(|e| format!("Failed to stop Edge Server: {}", e))?;
                child
                    .wait()
                    .await
                    .map_err(|e| format!("Failed to wait for Edge Server exit: {}", e))?;
                log::info!("Edge Server (direct) stopped");
                Ok(())
            }
            None => Err("Edge Server is not running".into()),
        }
    }

    pub fn status(&self) -> EdgeStatus {
        EdgeStatus {
            running: self.child.is_some(),
            pid: self.child.as_ref().and_then(|c| match c {
                EdgeChild::Sidecar { pid, .. } => Some(*pid),
                EdgeChild::Direct { child } => child.id(),
            }),
            port: self.port,
        }
    }

    pub fn is_running(&self) -> bool {
        self.child.is_some()
    }

    pub fn local_auth_token(&self) -> &str {
        &self.local_auth_token
    }

    pub fn host_readiness(&self) -> EdgeHostReadiness {
        let status = self.status();
        EdgeHostReadiness {
            running: status.running,
            pid: status.pid,
            port: status.port,
            sidecar_name: EDGE_SIDECAR_NAME,
            target_id: LOCAL_EDGE_TARGET_ID,
            route: LOCAL_EDGE_ROUTE,
            bind_addr: edge_bind_addr(status.port),
            sidecar_args: edge_launch_args(
                READINESS_STORE_FILE_PLACEHOLDER,
                &edge_bind_addr(status.port),
            ),
            direct_cli_spawn: false,
        }
    }
}

pub type SharedEdgeManager = Arc<Mutex<EdgeManager>>;

fn generate_local_auth_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|e| format!("Failed to generate Edge auth token: {}", e))?;
    let mut token = String::with_capacity(5 + bytes.len() * 2);
    token.push_str("aght_");
    for byte in bytes {
        use std::fmt::Write as _;
        write!(&mut token, "{:02x}", byte)
            .map_err(|e| format!("Failed to format Edge auth token: {}", e))?;
    }
    Ok(token)
}

fn edge_binary_name() -> &'static str {
    if cfg!(windows) {
        "agenthub-edge.exe"
    } else {
        "agenthub-edge"
    }
}

fn edge_binary_candidates() -> Vec<PathBuf> {
    let binary_name = edge_binary_name();
    let mut candidates = Vec::new();

    candidates.push(PathBuf::from("edge-server").join(binary_name));
    candidates.push(PathBuf::from(binary_name));

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest_dir.join(binary_name));
    if let Some(desktop_dir) = manifest_dir.parent() {
        candidates.push(desktop_dir.join(binary_name));
        if let Some(app_dir) = desktop_dir.parent() {
            if let Some(repo_root) = app_dir.parent() {
                candidates.push(repo_root.join("edge-server").join(binary_name));
                candidates.push(repo_root.join(binary_name));
            }
        }
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.push(exe_dir.join(binary_name));
            candidates.push(exe_dir.join("edge-server").join(binary_name));
        }
    }

    candidates
}

fn edge_launch_args(store_path: &str, addr: &str) -> Vec<String> {
    vec![
        "--store-file".to_string(),
        store_path.to_string(),
        "--addr".to_string(),
        addr.to_string(),
        "--runner-profile".to_string(),
        DEFAULT_RUNNER_PROFILE.to_string(),
    ]
}

fn edge_bind_addr(port: u16) -> String {
    format!("127.0.0.1:{}", port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edge_launch_args_keep_runtime_behind_local_edge() {
        let args = edge_launch_args(
            "C:/Users/dev/AppData/Roaming/AgentHub/agenthub-edge-store.json",
            "127.0.0.1:3210",
        );

        assert_eq!(
            args,
            vec![
                "--store-file",
                "C:/Users/dev/AppData/Roaming/AgentHub/agenthub-edge-store.json",
                "--addr",
                "127.0.0.1:3210",
                "--runner-profile",
                "claude-code",
            ]
        );
        assert!(!args.iter().any(|arg| arg == "claude" || arg == "codex"));
    }

    #[test]
    fn readiness_snapshot_advertises_local_edge_sidecar_route() {
        let manager = EdgeManager::new_fallback(
            PathBuf::from("edge-server/agenthub-edge"),
            PathBuf::from("agenthub-edge-store.json"),
        );

        let readiness = manager.host_readiness();

        assert!(!readiness.running);
        assert_eq!(readiness.sidecar_name, "agenthub-edge");
        assert_eq!(readiness.route, "local-edge-api");
        assert_eq!(readiness.target_id, "local-edge");
        assert_eq!(readiness.port, 3210);
        assert_eq!(readiness.bind_addr, "127.0.0.1:3210");
        assert_eq!(
            readiness.sidecar_args,
            vec![
                "--store-file",
                "<app-data>/agenthub-edge-store.json",
                "--addr",
                "127.0.0.1:3210",
                "--runner-profile",
                "claude-code",
            ]
        );
        assert!(!readiness.direct_cli_spawn);
        assert!(!readiness
            .sidecar_args
            .iter()
            .any(|arg| arg.contains("AppData") || arg.contains("Users")));
    }
}

pub fn resolve_edge_path() -> PathBuf {
    // 1. Check EDGE_BINARY env var
    if let Ok(path) = std::env::var("EDGE_BINARY") {
        let p = PathBuf::from(&path);
        if p.exists() {
            return p;
        }
    }

    // 2. Check common dev/bundle locations. Tauri dev often runs from
    // app/desktop or app/desktop/src-tauri, not the repository root.
    for candidate in edge_binary_candidates() {
        if candidate.exists() {
            return candidate;
        }
    }

    // Default: return the repository-root dev path when it can be derived.
    // The subsequent spawn error then includes the path that should be built.
    edge_binary_candidates()
        .into_iter()
        .find(|candidate| {
            candidate
                .components()
                .any(|part| part.as_os_str() == std::ffi::OsStr::new("edge-server"))
        })
        .unwrap_or_else(|| PathBuf::from("edge-server").join(edge_binary_name()))
}
