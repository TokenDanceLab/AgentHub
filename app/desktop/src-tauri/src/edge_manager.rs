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
    auto_restart: bool,
}

impl EdgeManager {
    pub fn new(edge_path: PathBuf, store_path: PathBuf) -> Self {
        Self {
            child: None,
            edge_path,
            store_path,
            port: 3210,
            auto_restart: true,
        }
    }

    pub async fn start(&mut self) -> Result<(), String> {
        if self.child.is_some() {
            return Err("Edge Server is already running".into());
        }

        let child = Command::new(&self.edge_path)
            .args([
                "--store-file",
                self.store_path.to_str().unwrap_or("agenthub_store.json"),
                "--port",
                &self.port.to_string(),
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

pub fn resolve_edge_path() -> PathBuf {
    // 1. Check EDGE_BINARY env var
    if let Ok(path) = std::env::var("EDGE_BINARY") {
        let p = PathBuf::from(&path);
        if p.exists() {
            return p;
        }
    }

    // 2. Check relative to the project root (dev mode)
    let dev_path = PathBuf::from("edge-server/agenthub-edge.exe");
    if dev_path.exists() {
        return dev_path;
    }

    // 3. Check current directory
    let cwd_path = PathBuf::from("agenthub-edge.exe");
    if cwd_path.exists() {
        return cwd_path;
    }

    // Default: return the dev path (will fail with clear error if missing)
    dev_path
}
