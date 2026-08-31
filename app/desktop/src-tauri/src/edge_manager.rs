use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
#[cfg(test)]
use std::time::Duration;
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
const EDGE_AUTH_TOKEN_FILE: &str = "edge-auth-token";
const EDGE_STORE_BACKEND: &str = "sqlite";
const EDGE_STORE_READINESS_MANIFEST_SCHEMA: &str = "agenthub-edge-sqlite-readiness-v1";
const EDGE_STORE_EXPECTED_MIGRATION_VERSION: u16 = 4;
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
    pub store_backend: &'static str,
    pub store_db_policy: &'static str,
    pub store_readiness_manifest_schema: &'static str,
    pub expected_store_migration_version: u16,
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

/// Test-only sidecar smoke evidence struct. Narrowed from
/// `#[cfg(any(test, debug_assertions))]` to `#[cfg(test)]` so the non-test
/// lib build does not carry an unused type. Constructed only by the
/// test-only `observe_fixture_sidecar_smoke` helper.
#[cfg(test)]
#[derive(Debug, Clone, serde::Serialize)]
pub struct EdgeObservedSidecarSmoke {
    pub mode: &'static str,
    pub sidecar_name: &'static str,
    pub target_binding: EdgeObservedTargetBinding,
    pub app_data_dir: PathBuf,
    pub store_db_path: PathBuf,
    pub log_paths: EdgeLogPaths,
    pub sidecar_args: Vec<String>,
    pub health_url: String,
    pub health_online: bool,
    pub health_version: Option<String>,
    pub edge_id: Option<String>,
    pub preflight: EdgePreflight,
    pub stdout_tail: Vec<String>,
    pub stderr_tail: Vec<String>,
    pub direct_cli_spawn: bool,
}

/// Test-only observed target binding for sidecar smoke diagnostics. Narrowed
/// from `#[cfg(any(test, debug_assertions))]` to `#[cfg(test)]` so the
/// non-test lib build does not carry an unused type. Constructed only by the
/// test-only `observed_target_binding` helper.
#[cfg(test)]
#[derive(Debug, Clone, serde::Serialize)]
pub struct EdgeObservedTargetBinding {
    pub expected_target_id: String,
    pub observed_target_id: Option<String>,
    pub expected_edge_device_id: String,
    pub observed_edge_device_id: Option<String>,
    pub status: &'static str,
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
        child: Box<Child>,
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
    restart_count: u32,
    max_restarts: u32,
}

const EDGE_MAX_RESTARTS: u32 = 5;

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
            restart_count: 0,
            max_restarts: EDGE_MAX_RESTARTS,
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
            restart_count: 0,
            max_restarts: EDGE_MAX_RESTARTS,
        }
    }

    pub async fn start<R: Runtime>(
        &mut self,
        app_handle: &tauri::AppHandle<R>,
    ) -> Result<(), String> {
        if self.child.is_some() {
            return Err("Edge Server is already running".into());
        }

        // Pre-flight: check if port is already occupied by an existing Edge
        // process (e.g. leftover from a previous Desktop session). If so, skip
        // spawning a new one — the health poll will pick it up.
        if is_edge_port_occupied(self.port) {
            log::info!(
                "Port {} already in use — assuming existing Edge server is running",
                self.port
            );
            return Err(format!(
                "Port {} is already in use by another process. Stop the existing Edge server first.",
                self.port
            ));
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

        // Resolve home directory for workspace allowlist.
        let home_dir = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .ok();
        let args = edge_launch_args(&store_path_str, &addr, home_dir.as_deref());

        // Persist auth token to a file ONLY in debug builds so external dev
        // tools (e.g. Vite dev server) can pick it up without needing a Tauri
        // invoke bridge. In release builds the token is passed via env var to
        // the child process instead — never written to disk.
        #[cfg(debug_assertions)]
        {
            let token_path = store_path.parent().map(|p| p.join(EDGE_AUTH_TOKEN_FILE));
            if let Some(ref p) = token_path {
                let _ = std::fs::write(p, &auth_token);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o600));
                }
            }
        }
        // Env-var token for the child process. The Edge Server reads
        // AGENTHUB_EDGE_AUTH_TOKEN as its local bearer token; the Desktop
        // frontend fetches the same token via the get_edge_auth_token command
        // and attaches it as Authorization. We never set AGENTHUB_DEV: the
        // Edge keeps its fail-closed auth model even when launched by Desktop.
        let edge_auth_token_env = auth_token.clone();

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

            // Edge stays in its default fail-closed mode: the generated local
            // auth token authenticates the Desktop frontend, and the Edge is
            // still bound to 127.0.0.1 (see edge_launch_args).
            cmd = cmd.env("AGENTHUB_EDGE_AUTH_TOKEN", &edge_auth_token_env);

            match cmd.spawn() {
                Ok((mut rx, child)) => {
                    let pid = child.pid();
                    let stdout_log = log_paths.stdout.clone();
                    let stderr_log = log_paths.stderr.clone();
                    let app_for_restart = app_handle.clone();

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
                                    append_edge_log_line(
                                        &stderr_log,
                                        &format!("sidecar error: {}", e),
                                    );
                                    log::error!("[edge] error: {}", e);
                                }
                                CommandEvent::Terminated(payload) => {
                                    log::info!(
                                        "[edge] terminated (code={:?}, signal={:?})",
                                        payload.code,
                                        payload.signal
                                    );
                                    // Clear zombie child state and schedule an
                                    // auto-restart with exponential backoff.
                                    schedule_edge_restart(app_for_restart.clone());
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
                    let message =
                        format!("Sidecar spawn failed, falling back to direct path: {}", e);
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
        command.env("AGENTHUB_EDGE_AUTH_TOKEN", &edge_auth_token_env);

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
        let stdout_task = child
            .stdout
            .take()
            .map(|stdout| spawn_pipe_logger(stdout, log_paths.stdout.clone(), log::Level::Info));
        let stderr_task = child
            .stderr
            .take()
            .map(|stderr| spawn_pipe_logger(stderr, log_paths.stderr.clone(), log::Level::Warn));
        log::info!(
            "Edge Server started via direct path (pid={}, path={:?})",
            pid,
            self.edge_path
        );
        self.last_error = None;
        self.child = Some(EdgeChild::Direct {
            child: Box::new(child),
            stdout_task,
            stderr_task,
        });
        Ok(())
    }

    pub async fn stop(&mut self) -> Result<(), String> {
        // Clean up the persisted auth token file on stop.
        {
            let token_path = self
                .store_path
                .parent()
                .map(|p| p.join(EDGE_AUTH_TOKEN_FILE));
            if let Some(ref p) = token_path {
                let _ = std::fs::remove_file(p);
            }
        }
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

    /// Clear the child handle after a sidecar/process termination so that
    /// `is_running` reflects reality and `start` does not reject with
    /// "already running". Intended to be called from the restart scheduler
    /// and the health checker's zombie-detection path.
    pub fn clear_child(&mut self) {
        self.child = None;
    }

    /// Increment the restart counter. Returns `true` if a restart attempt is
    /// still within the `max_restarts` budget.
    pub fn increment_restart_count(&mut self) -> bool {
        self.restart_count += 1;
        let allowed = self.restart_count <= self.max_restarts;
        if !allowed {
            log::error!(
                "[edge] max restarts ({}) exceeded — giving up",
                self.max_restarts
            );
        }
        allowed
    }

    /// Reset the restart counter when the server is confirmed healthy.
    pub fn reset_restart_count(&mut self) {
        self.restart_count = 0;
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
            store_backend: EDGE_STORE_BACKEND,
            store_db_policy: READINESS_STORE_DB_PLACEHOLDER,
            store_readiness_manifest_schema: EDGE_STORE_READINESS_MANIFEST_SCHEMA,
            expected_store_migration_version: EDGE_STORE_EXPECTED_MIGRATION_VERSION,
            log_paths,
            sidecar_args: edge_launch_args(
                READINESS_STORE_DB_PLACEHOLDER,
                &edge_bind_addr(status.port),
                None, // readiness snapshot omits workspace allowlist paths
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

/// Exponential backoff in seconds for the Nth restart attempt (1-indexed).
/// Caps at 60s so a crash loop does not stall the app indefinitely.
fn edge_restart_backoff_secs(attempt: u32) -> u64 {
    // 2^attempt capped at 60: attempt 1→2s, 2→4s, 3→8s, 4→16s, 5→32s.
    let base = 2u64.checked_shl(attempt).unwrap_or(60);
    base.min(60)
}

/// Clear the zombie child handle, increment the restart counter, and (if the
/// budget allows) sleep with exponential backoff then call `EdgeManager::start`.
/// Intended to be spawned as a background task from the sidecar `Terminated`
/// handler and from the health checker's zombie-detection path.
pub(crate) fn schedule_edge_restart<R: Runtime>(app_handle: tauri::AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        let edge: SharedEdgeManager = match app_handle.try_state::<SharedEdgeManager>() {
            Some(state) => state.inner().clone(),
            None => {
                log::error!("[edge] cannot restart: SharedEdgeManager not found in app state");
                return;
            }
        };

        // Phase 1: clear child + increment counter under the lock.
        let (count, max) = {
            let mut mgr = edge.lock().await;
            mgr.clear_child();
            let allowed = mgr.increment_restart_count();
            (mgr.restart_count, mgr.max_restarts)
        };

        if count > max {
            return;
        }

        let backoff = edge_restart_backoff_secs(count);
        log::warn!("[edge] scheduling restart attempt {count}/{max} after {backoff}s backoff");
        tokio::time::sleep(std::time::Duration::from_secs(backoff)).await;

        // Phase 2: attempt restart. If start() fails, recursively schedule
        // another attempt (which will increment the counter again).
        let already_running = {
            let mgr = edge.lock().await;
            mgr.is_running()
        };
        if already_running {
            log::info!("[edge] child already present, skipping restart");
            return;
        }

        let mut mgr = edge.lock().await;
        match mgr.start(&app_handle).await {
            Ok(()) => {
                log::info!("[edge] restart attempt {count}/{max} succeeded");
            }
            Err(e) => {
                log::error!("[edge] restart attempt {count}/{max} failed: {e}");
                drop(mgr); // release lock before recursive scheduling
                schedule_edge_restart(app_handle.clone());
            }
        }
    });
}

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

fn edge_launch_args(
    store_path: &str,
    addr: &str,
    workspace_allowlist: Option<&str>,
) -> Vec<String> {
    let mut args = vec![
        "--store-backend".to_string(),
        "sqlite".to_string(),
        "--store-db".to_string(),
        store_path.to_string(),
        "--addr".to_string(),
        addr.to_string(),
        "--runner-profile".to_string(),
        DEFAULT_RUNNER_PROFILE.to_string(),
    ];
    // Default workspace allowlist: restrict to user's home directory.
    // Desktop is a local tool — allowing home and subdirectories is a
    // reasonable default while still satisfying the fail-closed AH-SR-006
    // security requirement.
    if let Some(dir) = workspace_allowlist {
        args.push("--workspace-allowlist".to_string());
        args.push(dir.to_string());
    }
    args
}

fn edge_bind_addr(port: u16) -> String {
    format!("127.0.0.1:{}", port)
}

fn edge_health_url(port: u16) -> String {
    format!("http://{}/v1/health", edge_bind_addr(port))
}

/// Checks whether port 3210 is already occupied by probing for a health
/// response. Returns `true` if an existing Edge server is already running
/// on the expected port.
fn is_edge_port_occupied(port: u16) -> bool {
    // Synchronous TCP check — fast and sufficient for localhost.
    use std::net::TcpStream;
    let addr = edge_bind_addr(port);
    TcpStream::connect_timeout(
        &addr
            .parse()
            .unwrap_or_else(|_| "127.0.0.1:3210".parse().unwrap()),
        std::time::Duration::from_millis(500),
    )
    .is_ok()
}

/// Test-only fixture smoke probe. Narrowed from
/// `#[cfg(any(test, debug_assertions))]` to `#[cfg(test)]` so the non-test
/// lib build does not carry an unused function. Called only by the
/// `observed_fixture_smoke_reads_health_app_data_logs_and_spawn_boundary`
/// integration test.
#[cfg(test)]
async fn observe_fixture_sidecar_smoke(
    app_data_dir: PathBuf,
    port: u16,
    expected_target_id: &str,
    expected_edge_device_id: &str,
    observed_target_id: Option<&str>,
    observed_edge_device_id: Option<&str>,
) -> Result<EdgeObservedSidecarSmoke, String> {
    let store_db_path = edge_store_db_path(app_data_dir.clone());
    let store_db = store_db_path.to_string_lossy().to_string();
    let addr = edge_bind_addr(port);
    let health_url = edge_health_url(port);
    let log_paths = edge_log_paths(app_data_dir.clone());

    let body = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| format!("Failed to build Local Edge fixture health client: {}", e))?
        .get(&health_url)
        .send()
        .await
        .map_err(|e| format!("Local Edge fixture health request failed: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Local Edge fixture health returned an error: {}", e))?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Local Edge fixture health JSON was invalid: {}", e))?;
    let data = body
        .get("data")
        .filter(|_| body.get("code").and_then(|v| v.as_str()) == Some("OK"))
        .unwrap_or(&body);

    Ok(EdgeObservedSidecarSmoke {
        mode: "fixture",
        sidecar_name: EDGE_SIDECAR_NAME,
        target_binding: observed_target_binding(
            expected_target_id,
            expected_edge_device_id,
            observed_target_id,
            observed_edge_device_id,
            true,
        ),
        app_data_dir,
        store_db_path,
        log_paths: log_paths.clone(),
        sidecar_args: edge_launch_args(&store_db, &addr, None),
        health_url,
        health_online: true,
        health_version: data
            .get("version")
            .and_then(|v| v.as_str())
            .map(String::from),
        edge_id: data
            .get("edgeId")
            .or_else(|| data.get("edge_id"))
            .and_then(|v| v.as_str())
            .map(String::from),
        preflight: edge_preflight(true, false, true, None),
        stdout_tail: read_edge_log_tail(&log_paths.stdout, 20),
        stderr_tail: read_edge_log_tail(&log_paths.stderr, 20),
        direct_cli_spawn: false,
    })
}

/// Test-only helper that builds an EdgeObservedTargetBinding for sidecar
/// smoke diagnostics. Narrowed from `#[cfg(any(test, debug_assertions))]`
/// to `#[cfg(test)]` so the non-test lib build does not carry an unused
/// function.
#[cfg(test)]
fn observed_target_binding(
    expected_target_id: &str,
    expected_edge_device_id: &str,
    observed_target_id: Option<&str>,
    observed_edge_device_id: Option<&str>,
    edge_online: bool,
) -> EdgeObservedTargetBinding {
    let status = if !edge_online {
        "offline"
    } else if observed_target_id == Some(expected_target_id)
        && observed_edge_device_id == Some(expected_edge_device_id)
    {
        "matched"
    } else {
        "mismatch"
    };

    EdgeObservedTargetBinding {
        expected_target_id: expected_target_id.to_string(),
        observed_target_id: observed_target_id.map(str::to_string),
        expected_edge_device_id: expected_edge_device_id.to_string(),
        observed_edge_device_id: observed_edge_device_id.map(str::to_string),
        status,
    }
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
        status: if blocker.is_some() {
            "blocked"
        } else {
            "ready"
        },
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

fn spawn_pipe_logger<T>(pipe: T, log_path: String, level: log::Level) -> tokio::task::JoinHandle<()>
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
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn edge_launch_args_keep_runtime_behind_local_edge() {
        let args = edge_launch_args(
            "fixtures/app-data/agenthub-edge.sqlite",
            "127.0.0.1:3210",
            None,
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
    fn edge_launch_args_includes_workspace_allowlist_when_provided() {
        let args = edge_launch_args(
            "fixtures/app-data/agenthub-edge.sqlite",
            "127.0.0.1:3210",
            Some("C:\\Users\\Test"),
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
                "--workspace-allowlist",
                "C:\\Users\\Test",
            ]
        );
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
        assert_eq!(readiness.store_backend, "sqlite");
        assert_eq!(
            readiness.store_readiness_manifest_schema,
            "agenthub-edge-sqlite-readiness-v1"
        );
        assert_eq!(readiness.expected_store_migration_version, 4);
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
        assert_eq!(readiness.store_backend, "sqlite");
        assert_eq!(readiness.store_db_policy, "<app-data>/agenthub-edge.sqlite");
        assert!(!readiness.preflight.sidecar_available);
        assert!(!readiness.preflight.fallback_executable_available);
        assert_eq!(readiness.preflight.status, "blocked");
        assert_eq!(
            readiness.preflight.blocker,
            Some(
                "Local Edge sidecar is not bundled and fallback executable is missing".to_string()
            )
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

        assert_eq!(
            path,
            PathBuf::from("fixtures/app-data/agenthub-edge.sqlite")
        );
    }

    #[test]
    fn observed_fixture_smoke_reads_health_app_data_logs_and_spawn_boundary() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("fixture health listener");
        let port = listener.local_addr().expect("fixture addr").port();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("fixture request");
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request);
            let body =
                r#"{"code":"OK","data":{"status":"ok","version":"v1","edgeId":"local-fixture"}}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}",
                body.len(),
                body
            )
            .expect("fixture response");
        });

        let app_data_dir = std::env::temp_dir().join(format!(
            "agenthub-observed-sidecar-smoke-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&app_data_dir);
        let log_paths = edge_log_paths(app_data_dir.clone());
        append_edge_log_line(&log_paths.stdout, "fixture sidecar ready");
        append_edge_log_line(&log_paths.stderr, "fixture sidecar stderr captured");

        let evidence = tauri::async_runtime::block_on(observe_fixture_sidecar_smoke(
            app_data_dir.clone(),
            port,
            "hub-target-local-1",
            "desktop-device-1",
            Some("hub-target-local-1"),
            Some("desktop-device-1"),
        ))
        .expect("observed fixture smoke evidence");
        server.join().expect("fixture server joined");

        assert_eq!(evidence.sidecar_name, "agenthub-edge");
        assert_eq!(evidence.mode, "fixture");
        assert_eq!(evidence.target_binding.status, "matched");
        assert_eq!(
            evidence.target_binding.expected_target_id,
            "hub-target-local-1"
        );
        assert_eq!(
            evidence.target_binding.observed_target_id.as_deref(),
            Some("hub-target-local-1")
        );
        assert_eq!(
            evidence.target_binding.expected_edge_device_id,
            "desktop-device-1"
        );
        assert_eq!(
            evidence.target_binding.observed_edge_device_id.as_deref(),
            Some("desktop-device-1")
        );
        assert_eq!(
            evidence.health_url,
            format!("http://127.0.0.1:{port}/v1/health")
        );
        assert!(evidence.health_online);
        assert_eq!(evidence.health_version.as_deref(), Some("v1"));
        assert_eq!(evidence.edge_id.as_deref(), Some("local-fixture"));
        assert_eq!(evidence.store_db_path, edge_store_db_path(app_data_dir));
        assert_eq!(evidence.log_paths.stdout, log_paths.stdout);
        assert!(evidence
            .stdout_tail
            .contains(&"fixture sidecar ready".to_string()));
        assert!(evidence
            .stderr_tail
            .contains(&"fixture sidecar stderr captured".to_string()));
        assert_eq!(evidence.preflight.status, "ready");
        assert!(!evidence.direct_cli_spawn);
        assert!(!evidence.sidecar_args.iter().any(|arg| {
            matches!(
                arg.as_str(),
                "codex" | "codex.exe" | "claude" | "claude.exe" | "opencode" | "opencode.exe"
            )
        }));

        let _ = std::fs::remove_dir_all(evidence.app_data_dir);
    }

    #[test]
    fn observed_target_binding_distinguishes_match_mismatch_and_offline() {
        let matched = observed_target_binding(
            "hub-target-local-1",
            "desktop-device-1",
            Some("hub-target-local-1"),
            Some("desktop-device-1"),
            true,
        );
        assert_eq!(matched.status, "matched");

        let mismatch = observed_target_binding(
            "hub-target-local-1",
            "desktop-device-1",
            Some("hub-target-other"),
            Some("desktop-device-1"),
            true,
        );
        assert_eq!(mismatch.status, "mismatch");

        let offline = observed_target_binding(
            "hub-target-local-1",
            "desktop-device-1",
            Some("hub-target-local-1"),
            Some("desktop-device-1"),
            false,
        );
        assert_eq!(offline.status, "offline");
    }
}

/// Test-only helper that reads the last N lines of an Edge log file. Narrowed
/// from `#[cfg(any(test, debug_assertions))]` to `#[cfg(test)]` so the
/// non-test lib build does not carry an unused function. Called only by the
/// test-only `observe_fixture_sidecar_smoke` probe.
#[cfg(test)]
fn read_edge_log_tail(path: &str, max_lines: usize) -> Vec<String> {
    if max_lines == 0 || path.starts_with("<app-data>") {
        return Vec::new();
    }

    let Ok(content) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut tail = std::collections::VecDeque::with_capacity(max_lines);
    for line in content.lines() {
        if tail.len() == max_lines {
            tail.pop_front();
        }
        tail.push_back(line.to_string());
    }
    tail.into_iter().collect()
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
