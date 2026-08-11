use crate::edge_manager::{schedule_edge_restart, SharedEdgeManager};
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
            }

            // Reset the restart counter when the server is confirmed healthy
            // so that a transient crash does not permanently consume the budget.
            if health.online {
                edge.lock().await.reset_restart_count();
            }

            // Zombie detection: child handle exists (is_running=true) but the
            // health probe is offline. This means the sidecar/process is hung
            // or was killed externally without a Terminated event. Clear the
            // stale child handle and schedule an auto-restart.
            if running && !health.online {
                log::warn!("[edge-health] zombie detected: child present but health offline — scheduling restart");
                let mut mgr = edge.lock().await;
                mgr.clear_child();
                drop(mgr);
                schedule_edge_restart(app.clone());
            }

            // Always emit periodically to keep UI in sync
            let _ = app.emit("edge-health", &health);
        }
    });
}

async fn check_http_health(port: u16) -> EdgeHealthPayload {
    let url = format!("http://127.0.0.1:{}/v1/health", port);
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(client) => client,
        Err(_) => {
            return EdgeHealthPayload {
                online: false,
                version: None,
                edge_id: None,
            };
        }
    };
    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => {
            if let Ok(body) = resp.json::<serde_json::Value>().await {
                parse_edge_health_payload(body)
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

fn parse_edge_health_payload(body: serde_json::Value) -> EdgeHealthPayload {
    let data = body
        .get("data")
        .filter(|_| body.get("code").and_then(|v| v.as_str()) == Some("OK"))
        .unwrap_or(&body);

    EdgeHealthPayload {
        online: true,
        version: data
            .get("version")
            .and_then(|v| v.as_str())
            .map(String::from),
        edge_id: data
            .get("edgeId")
            .or_else(|| data.get("edge_id"))
            .and_then(|v| v.as_str())
            .map(String::from),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_health_payload_accepts_legacy_raw_health() {
        let payload = parse_edge_health_payload(json!({
            "status": "ok",
            "version": "v1",
            "edgeId": "local"
        }));

        assert!(payload.online);
        assert_eq!(payload.version.as_deref(), Some("v1"));
        assert_eq!(payload.edge_id.as_deref(), Some("local"));
    }

    #[test]
    fn parse_health_payload_accepts_unified_edge_envelope() {
        let payload = parse_edge_health_payload(json!({
            "code": "OK",
            "data": {
                "status": "ok",
                "version": "v1",
                "edgeId": "local"
            }
        }));

        assert!(payload.online);
        assert_eq!(payload.version.as_deref(), Some("v1"));
        assert_eq!(payload.edge_id.as_deref(), Some("local"));
    }
}
