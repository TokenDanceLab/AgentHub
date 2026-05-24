use crate::edge_manager::SharedEdgeManager;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::time;

#[derive(Debug, Clone, serde::Serialize)]
pub struct EdgeHealthPayload {
    pub online: bool,
    pub version: Option<String>,
    pub edge_id: Option<String>,
}

pub fn spawn_health_check(app: AppHandle, edge: SharedEdgeManager) {
    tauri::async_runtime::spawn(async move {
        let mut was_online = false;
        loop {
            time::sleep(Duration::from_secs(5)).await;

            let (running, port) = {
                let mgr = edge.lock().await;
                (mgr.is_running(), mgr.status().port)
            };

            let health = if running {
                check_http_health(port).await
            } else {
                EdgeHealthPayload {
                    online: false,
                    version: None,
                    edge_id: None,
                }
            };

            if health.online != was_online {
                was_online = health.online;
                let _ = app.emit("edge-health", &health);
            }

            // Always emit periodically to keep UI in sync
            let _ = app.emit("edge-health", &health);
        }
    });
}

async fn check_http_health(port: u16) -> EdgeHealthPayload {
    let url = format!("http://127.0.0.1:{}/v1/health", port);
    match reqwest::get(&url).await {
        Ok(resp) if resp.status().is_success() => {
            if let Ok(body) = resp.json::<serde_json::Value>().await {
                EdgeHealthPayload {
                    online: true,
                    version: body
                        .get("version")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    edge_id: body
                        .get("edgeId")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                }
            } else {
                EdgeHealthPayload {
                    online: true,
                    version: None,
                    edge_id: None,
                }
            }
        }
        _ => EdgeHealthPayload {
            online: false,
            version: None,
            edge_id: None,
        },
    }
}
