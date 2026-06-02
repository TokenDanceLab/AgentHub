use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

#[derive(Debug, Clone, serde::Serialize)]
pub struct EdgeStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub port: u16,
}

pub struct EdgeManager {
    child: Option<Child>,
    edge_path: PathBuf,
    store_path: PathBuf,
    port: u16,
}

impl EdgeManager {
    pub fn new(edge_path: PathBuf, store_path: PathBuf) -> Self {
        Self {
            child: None,
            edge_path,
            store_path,
            port: 3210,
        }
    }

    pub async fn start(&mut self) -> Result<(), String> {
        if self.child.is_some() {
            return Err("Edge Server is already running".into());
        }

        let addr = format!("127.0.0.1:{}", self.port);
        let child = Command::new(&self.edge_path)
            .args([
                "--store-file",
                self.store_path.to_str().unwrap_or("agenthub_store.json"),
                "--addr",
                &addr,
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Failed to start Edge Server: {}", e))?;

        self.child = Some(child);
        Ok(())
    }

    pub async fn stop(&mut self) -> Result<(), String> {
        match self.child.as_mut() {
            Some(child) => {
                child
                    .kill()
                    .await
                    .map_err(|e| format!("Failed to stop Edge Server: {}", e))?;
                child
                    .wait()
                    .await
                    .map_err(|e| format!("Failed to wait for Edge Server exit: {}", e))?;
                self.child = None;
                Ok(())
            }
            None => Err("Edge Server is not running".into()),
        }
    }

    pub fn status(&self) -> EdgeStatus {
        EdgeStatus {
            running: self.child.is_some(),
            pid: self.child.as_ref().and_then(|c| c.id()),
            port: self.port,
        }
    }

    pub fn is_running(&self) -> bool {
        self.child.is_some()
    }
}

pub type SharedEdgeManager = Arc<Mutex<EdgeManager>>;

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
