use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{Manager, Runtime};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

const DEFAULT_EDGE_PORT: u16 = 3210;
const EDGE_SIDECAR_NAME: &str = "agenthub-edge";
const LOCAL_EDGE_TARGET_ID: &str = "local-edge";
const LOCAL_EDGE_ROUTE: &str = "local-edge-api";
const DEFAULT_RUNNER_PROFILE: &str = "claude-code";
const EDGE_STORE_DB_FILE_NAME: &str = "agenthub-edge.sqlite";
const READINESS_STORE_DB_PLACEHOLDER: &str = "<app-data>/agenthub-edge.sqlite";

#[derive(Debug, Clone, serde::Serialize)]
pub struct EdgeStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub port: u16,
    pub health_url: String,
    pub last_error: Option<String>,
    pub log_paths: EdgeLogPaths,
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
    pub health_url: String,
    pub store_db_policy: &'static str,
    pub log_paths: EdgeLogPaths,
    pub sidecar_args: Vec<String>,
    pub preflight: EdgePreflight,
    pub direct_cli_spawn: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct EdgeLogPaths {
    pub directory: String,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct EdgePreflight {
    pub sidecar_available: bool,
    pub fallback_executable_available: bool,
    pub auth_token_ready: bool,
    pub status: &'static str,
    pub blocker: Option<String>,
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
        stdout_task: Option<tokio::task::JoinHandle<()>>,
        stderr_task: Option<tokio::task::JoinHandle<()>>,
    },
}

pub struct EdgeManager {
    child: Option<EdgeChild>,
    edge_path: PathBuf,
    store_path: PathBuf,
    local_auth_token: Option<String>,
    last_error: Option<String>,
    log_paths: EdgeLogPaths,
    port: u16,
}

impl EdgeManager {
    pub fn new(edge_path: PathBuf, store_path: PathBuf) -> Result<Self, String> {
        Ok(Self {
            child: None,
            edge_path,
            store_path,
            local_auth_token: Some(generate_local_auth_token()?),
            last_error: None,
            log_paths: placeholder_edge_log_paths(),
            port: DEFAULT_EDGE_PORT,
        })
    }

    /// Constructor used when cryptographically-random token generation fails.
    /// The desktop shell can still report diagnostics, but Local Edge startup
    /// is blocked until a real auth token can be generated.
    pub fn new_unavailable(edge_path: PathBuf, store_path: PathBuf, error: String) -> Self {
        Self {
            child: None,
            edge_path,
            store_path,
            local_auth_token: None,
            last_error: Some(format!(
                "Local Edge auth token is unavailable; refusing to start Local Edge: {}",
                error
            )),
            log_paths: placeholder_edge_log_paths(),
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

        let auth_token = match self.local_auth_token.as_ref() {
            Some(token) => token.clone(),
            None => {
                let error = self.last_error.clone().unwrap_or_else(|| {
                    "Local Edge auth token is unavailable; refusing to start Local Edge".to_string()
                });
                return Err(error);
            }
        };

        let addr = edge_bind_addr(self.port);

        // Resolve packaged store path through app data; tests/dev can still inject fallback path.
        let (store_path, log_paths) = match app_handle.path().app_data_dir() {
            Ok(dir) => {
                std::fs::create_dir_all(&dir)
                    .map_err(|e| format!("Failed to create app data dir: {}", e))?;
                let log_paths = edge_log_paths(dir.clone());
                std::fs::create_dir_all(PathBuf::from(&log_paths.directory))
                    .map_err(|e| format!("Failed to create Local Edge log dir: {}", e))?;
                (edge_store_db_path(dir), log_paths)
            }
            Err(_) => (self.store_path.clone(), self.log_paths.clone()),
        };
        self.log_paths = log_paths.clone();
        let store_path_str = store_path
            .to_str()
            .unwrap_or(EDGE_STORE_DB_FILE_NAME)
            .to_string();

        let args = edge_launch_args(&store_path_str, &addr);

        // ── Try sidecar first (release / bundled builds) ─────────────────
        let sidecar_result = app_handle.shell().sidecar(EDGE_SIDECAR_NAME);
        if sidecar_result.is_err() && !self.edge_path.exists() {
            let error = format!(
                "Local Edge sidecar is not bundled and fallback executable is missing: {}",
                self.edge_path.display()
            );
            self.last_error = Some(error.clone());
            append_edge_log_line(&log_paths.stderr, &error);
            return Err(error);
        }

        if let Ok(sidecar_cmd) = sidecar_result {
            let mut cmd = sidecar_cmd.args(&args);

            if cfg!(debug_assertions) {
                cmd = cmd.env("AGENTHUB_DEV", "1");
            } else {
                cmd = cmd.env("AGENTHUB_EDGE_AUTH_TOKEN", &auth_token);
            }

            match cmd.spawn() {
                Ok((mut rx, child)) => {
                    let pid = child.pid();
                    let stdout_log = log_paths.stdout.clone();
                    let stderr_log = log_paths.stderr.clone();

                    let event_task = tokio::spawn(async move {
                        while let Some(event) = rx.recv().await {
                            match event {
                                CommandEvent::Stdout(line) => {
                                    if let Ok(s) = String::from_utf8(line) {
                                        let line = s.trim_end().to_string();
                                        append_edge_log_line(&stdout_log, &line);
                                        log::info!("[edge] {}", line);
                                    }
                                }
                                CommandEvent::Stderr(line) => {
                                    if let Ok(s) = String::from_utf8(line) {
                                        let line = s.trim_end().to_string();
                                        append_edge_log_line(&stderr_log, &line);
                                        log::warn!("[edge] {}", line);
                                    }
                                }
                                CommandEvent::Error(e) => {
                                    append_edge_log_line(&stderr_log, &format!("sidecar error: {}", e));
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
                    self.last_error = None;
                    self.child = Some(EdgeChild::Sidecar {
                        child,
                        pid,
                        event_task,
                    });
                    return Ok(());
                }
                Err(e) => {
                    let message = format!("Sidecar spawn failed, falling back to direct path: {}", e);
                    append_edge_log_line(&log_paths.stderr, &message);
                    log::warn!("{}", message);
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
            command.env("AGENTHUB_EDGE_AUTH_TOKEN", &auth_token);
        }

        let mut child = command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| {
                let error = format!("Failed to start Edge Server: {}", e);
                append_edge_log_line(&log_paths.stderr, &error);
                self.last_error = Some(error.clone());
                error
            })?;

        let pid = child.id().unwrap_or(0);
        let stdout_task = child.stdout.take().map(|stdout| {
            spawn_pipe_logger(stdout, log_paths.stdout.clone(), log::Level::Info)
        });
        let stderr_task = child.stderr.take().map(|stderr| {
            spawn_pipe_logger(stderr, log_paths.stderr.clone(), log::Level::Warn)
        });
        log::info!(
            "Edge Server started via direct path (pid={}, path={:?})",
            pid,
            self.edge_path
        );
        self.last_error = None;
        self.child = Some(EdgeChild::Direct {
            child,
            stdout_task,
            stderr_task,
        });
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
            Some(EdgeChild::Direct {
                mut child,
                stdout_task,
                stderr_task,
            }) => {
                child
                    .kill()
                    .await
                    .map_err(|e| format!("Failed to stop Edge Server: {}", e))?;
                child
                    .wait()
                    .await
                    .map_err(|e| format!("Failed to wait for Edge Server exit: {}", e))?;
                if let Some(task) = stdout_task {
                    task.abort();
                }
                if let Some(task) = stderr_task {
                    task.abort();
                }
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
                EdgeChild::Direct { child, .. } => child.id(),
            }),
            port: self.port,
            health_url: edge_health_url(self.port),
            last_error: self.last_error.clone(),
            log_paths: self.log_paths.clone(),
        }
    }

    pub fn is_running(&self) -> bool {
        self.child.is_some()
    }

    pub fn local_auth_token(&self) -> Result<&str, String> {
        self.local_auth_token.as_deref().ok_or_else(|| {
            self.last_error.clone().unwrap_or_else(|| {
                "Local Edge auth token is unavailable; refusing to start Local Edge".to_string()
            })
        })
    }

    #[cfg(test)]
    pub fn host_readiness(&self) -> EdgeHostReadiness {
        self.build_host_readiness(false, self.log_paths.clone())
    }

    pub fn host_readiness_for_app<R: Runtime>(
        &self,
        app_handle: &tauri::AppHandle<R>,
    ) -> EdgeHostReadiness {
        let sidecar_available = app_handle.shell().sidecar(EDGE_SIDECAR_NAME).is_ok();
        let log_paths = app_handle
            .path()
            .app_data_dir()
            .map(edge_log_paths)
            .unwrap_or_else(|_| self.log_paths.clone());
        self.build_host_readiness(sidecar_available, log_paths)
    }

    fn build_host_readiness(
        &self,
        sidecar_available: bool,
        log_paths: EdgeLogPaths,
    ) -> EdgeHostReadiness {
        let status = self.status();
        let auth_token_ready = self.local_auth_token.is_some();
        let fallback_executable_available = self.edge_path.exists();
        EdgeHostReadiness {
            running: status.running,
            pid: status.pid,
            port: status.port,
            sidecar_name: EDGE_SIDECAR_NAME,
            target_id: LOCAL_EDGE_TARGET_ID,
            route: LOCAL_EDGE_ROUTE,
            bind_addr: edge_bind_addr(status.port),
            health_url: edge_health_url(status.port),
            store_db_policy: READINESS_STORE_DB_PLACEHOLDER,
            log_paths,
            sidecar_args: edge_launch_args(
                READINESS_STORE_DB_PLACEHOLDER,
                &edge_bind_addr(status.port),
            ),
            preflight: edge_preflight(
                sidecar_available,
                fallback_executable_available,
                auth_token_ready,
                self.last_error.clone(),
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
        "--store-backend".to_string(),
        "sqlite".to_string(),
        "--store-db".to_string(),
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

fn edge_health_url(port: u16) -> String {
    format!("http://{}/v1/health", edge_bind_addr(port))
}

fn edge_store_db_path(app_data_dir: PathBuf) -> PathBuf {
    app_data_dir.join(EDGE_STORE_DB_FILE_NAME)
}

fn edge_log_paths(app_data_dir: PathBuf) -> EdgeLogPaths {
    let directory = app_data_dir.join("edge-logs");
    EdgeLogPaths {
        stdout: directory
            .join("local-edge.stdout.log")
            .to_string_lossy()
            .to_string(),
        stderr: directory
            .join("local-edge.stderr.log")
            .to_string_lossy()
            .to_string(),
        directory: directory.to_string_lossy().to_string(),
    }
}

fn placeholder_edge_log_paths() -> EdgeLogPaths {
    EdgeLogPaths {
        directory: "<app-data>/edge-logs".to_string(),
        stdout: "<app-data>/edge-logs/local-edge.stdout.log".to_string(),
        stderr: "<app-data>/edge-logs/local-edge.stderr.log".to_string(),
    }
}

fn edge_preflight(
    sidecar_available: bool,
    fallback_executable_available: bool,
    auth_token_ready: bool,
    last_error: Option<String>,
) -> EdgePreflight {
    let blocker = if !auth_token_ready {
        last_error.or_else(|| {
            Some("Local Edge auth token is unavailable; refusing to start Local Edge".to_string())
        })
    } else if !sidecar_available && !fallback_executable_available {
        Some("Local Edge sidecar is not bundled and fallback executable is missing".to_string())
    } else {
        None
    };

    EdgePreflight {
        sidecar_available,
        fallback_executable_available,
        auth_token_ready,
        status: if blocker.is_some() { "blocked" } else { "ready" },
        blocker,
    }
}

fn append_edge_log_line(path: &str, line: &str) {
    if path.starts_with("<app-data>") {
        return;
    }
    if let Some(parent) = std::path::Path::new(path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        use std::io::Write as _;
        let _ = writeln!(file, "{}", line);
    }
}

fn spawn_pipe_logger<T>(
    pipe: T,
    log_path: String,
    level: log::Level,
) -> tokio::task::JoinHandle<()>
where
    T: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(pipe).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    append_edge_log_line(&log_path, &line);
                    log::log!(level, "[edge] {}", line);
                }
                Ok(None) => break,
                Err(error) => {
                    append_edge_log_line(
                        &log_path,
                        &format!("failed to read Local Edge pipe: {}", error),
                    );
                    break;
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edge_launch_args_keep_runtime_behind_local_edge() {
        let args = edge_launch_args(
            "fixtures/app-data/agenthub-edge.sqlite",
            "127.0.0.1:3210",
        );

        assert_eq!(
            args,
            vec![
                "--store-backend",
                "sqlite",
                "--store-db",
                "fixtures/app-data/agenthub-edge.sqlite",
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
        let manager = EdgeManager::new(
            PathBuf::from("edge-server/agenthub-edge"),
            PathBuf::from("agenthub-edge.sqlite"),
        )
        .expect("test token generation should succeed");

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
        assert!(!readiness.direct_cli_spawn);
        assert!(!readiness
            .sidecar_args
            .iter()
            .any(|arg| arg.contains("AppData") || arg.contains("Users")));
    }

    #[test]
    fn readiness_snapshot_reports_local_edge_preflight_blocker() {
        let manager = EdgeManager::new(
            PathBuf::from("fixtures/missing-agenthub-edge"),
            PathBuf::from("agenthub-edge.sqlite"),
        )
        .expect("test token generation should succeed");

        let readiness = manager.host_readiness();

        assert_eq!(readiness.health_url, "http://127.0.0.1:3210/v1/health");
        assert_eq!(readiness.store_db_policy, "<app-data>/agenthub-edge.sqlite");
        assert!(!readiness.preflight.sidecar_available);
        assert!(!readiness.preflight.fallback_executable_available);
        assert_eq!(readiness.preflight.status, "blocked");
        assert_eq!(
            readiness.preflight.blocker,
            Some("Local Edge sidecar is not bundled and fallback executable is missing".to_string())
        );
        assert!(!readiness.direct_cli_spawn);
    }

    #[test]
    fn token_generation_failure_blocks_local_edge_startup() {
        let manager = EdgeManager::new_unavailable(
            PathBuf::from("fixtures/agenthub-edge"),
            PathBuf::from("agenthub-edge.sqlite"),
            "entropy unavailable".to_string(),
        );

        let readiness = manager.host_readiness();

        assert_eq!(readiness.preflight.status, "blocked");
        assert!(!readiness.preflight.auth_token_ready);
        assert_eq!(
            readiness.preflight.blocker,
            Some(
                "Local Edge auth token is unavailable; refusing to start Local Edge: entropy unavailable"
                    .to_string()
            )
        );
        assert!(manager.local_auth_token().is_err());
        assert_eq!(
            manager.status().last_error,
            Some(
                "Local Edge auth token is unavailable; refusing to start Local Edge: entropy unavailable"
                    .to_string()
            )
        );
    }

    #[test]
    fn packaged_store_db_path_lives_under_app_data() {
        let path = edge_store_db_path(PathBuf::from("fixtures/app-data"));

        assert_eq!(path, PathBuf::from("fixtures/app-data/agenthub-edge.sqlite"));
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
