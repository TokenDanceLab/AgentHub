// OIDC callback HTTP server for PKCE flow.
// Starts a local HTTP server on 127.0.0.1:0 (random port), listens for
// the TokenDance ID redirect, extracts code+state from the query string,
// returns a success HTML page, and emits a Tauri event with the result.
//
// This is necessary because the frontend (browser webview) cannot create
// TCP servers directly — the Rust backend handles it.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;

static OIDC_STOPPED: AtomicBool = AtomicBool::new(false);

const CALLBACK_TIMEOUT_SECS: u64 = 300; // 5 minutes

/// Starts an HTTP server on a random port that listens for ONE OIDC callback.
/// Returns the port number immediately.
/// When the callback arrives, emits either `oidc-callback` or `oidc-callback-error`.
#[tauri::command]
pub async fn start_oidc_callback_server(app: tauri::AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("failed to bind callback server: {e}"))?;

    let port = listener
        .local_addr()
        .map(|a| a.port())
        .map_err(|e| format!("failed to get local address: {e}"))?;

    OIDC_STOPPED.store(false, Ordering::Relaxed);

    // Spawn background thread to accept connections
    std::thread::spawn(move || {
        listener
            .set_nonblocking(true)
            .expect("set_nonblocking on callback listener");

        let start = std::time::Instant::now();

        loop {
            if OIDC_STOPPED.load(Ordering::Relaxed) {
                return;
            }

            match listener.accept() {
                Ok((mut stream, _addr)) => {
                    if OIDC_STOPPED.load(Ordering::Relaxed) {
                        return;
                    }

                    // Read only the first line (request line)
                    let mut reader = BufReader::new(stream.try_clone().unwrap_or_else(|_| {
                        // If we can't clone, create a dummy — won't happen in practice
                        std::net::TcpStream::connect("127.0.0.1:1").unwrap()
                    }));

                    let mut request_line = String::new();
                    if reader.read_line(&mut request_line).is_err() {
                        let _ = stream.write_all(
                            b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        );
                        continue;
                    }

                    // Parse: GET /callback?code=xxx&state=yyy HTTP/1.1
                    let parts: Vec<&str> = request_line.split_whitespace().collect();
                    if parts.len() < 2 {
                        let body = "Bad Request";
                        let resp = format!(
                            "HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(), body
                        );
                        let _ = stream.write_all(resp.as_bytes());
                        continue;
                    }

                    let path_and_query = parts[1];
                    let query = path_and_query.find('?').map(|i| &path_and_query[i + 1..]);

                    let query = match query {
                        Some(q) => q,
                        None => {
                            // Serve a simple status page — no query params means someone is just checking
                            let body = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>AgentHub Callback</title></head><body><p>Waiting for OIDC callback...</p></body></html>";
                            let resp = format!(
                                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                                body.len(), body
                            );
                            let _ = stream.write_all(resp.as_bytes());
                            continue;
                        }
                    };

                    // Parse query parameters manually (no url crate dependency)
                    let mut code = String::new();
                    let mut state = String::new();
                    let mut error_val = String::new();

                    for pair in query.split('&') {
                        let mut kv = pair.splitn(2, '=');
                        let key = kv.next().unwrap_or("");
                        let val = kv.next().unwrap_or("");
                        let decoded_val = url_decode(val);

                        match key {
                            "code" => code = decoded_val,
                            "state" => state = decoded_val,
                            "error" => error_val = decoded_val,
                            _ => {}
                        }
                    }

                    // Check for OAuth error response
                    if !error_val.is_empty() {
                        let error_desc = query
                            .split('&')
                            .find(|p| p.starts_with("error_description="))
                            .map(|p| url_decode(&p["error_description=".len()..]))
                            .unwrap_or_default();

                        let body = format!(
                            "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>AgentHub Login Failed</title>\
                            <style>body{{font-family:-apple-system,system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a0a0a;color:#eee}}\
                            h1{{color:#f87171}}p{{color:#999}}code{{background:#2a1a1a;padding:2px 8px;border-radius:4px}}</style></head>\
                            <body><div style=\"text-align:center\"><h1>Login Failed</h1>\
                            <p><code>{error}</code>{desc}</p>\
                            <p>You may close this window and return to AgentHub Desktop.</p></div></body></html>",
                            error = escape_html(&error_val),
                            desc = if error_desc.is_empty() { String::new() } else { format!(": {}", escape_html(&error_desc)) }
                        );
                        let resp = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(), body
                        );
                        let _ = stream.write_all(resp.as_bytes());

                        let _ = app.emit(
                            "oidc-callback-error",
                            serde_json::json!({
                                "error": error_val,
                                "description": error_desc,
                            }),
                        );
                        OIDC_STOPPED.store(true, Ordering::Relaxed);
                        return;
                    }

                    if code.is_empty() || state.is_empty() {
                        let body = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>AgentHub Error</title>\
                        <style>body{{font-family:-apple-system,system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a0a0a;color:#eee}}\
                        h1{{color:#f87171}}p{{color:#999}}</style></head>\
                        <body><div style=\"text-align:center\"><h1>Invalid Callback</h1>\
                        <p>The callback URL is missing required parameters. Please try logging in again.</p></div></body></html>";
                        let resp = format!(
                            "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(), body
                        );
                        let _ = stream.write_all(resp.as_bytes());

                        let _ = app.emit(
                            "oidc-callback-error",
                            serde_json::json!({
                                "error": "invalid_callback",
                                "description": "Missing code or state in callback URL",
                            }),
                        );
                        OIDC_STOPPED.store(true, Ordering::Relaxed);
                        return;
                    }

                    // Success — return a nice HTML page
                    let body = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>AgentHub Login</title>\
                    <style>body{{font-family:-apple-system,system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0f0f0f;color:#eee}}\
                    svg{{width:64px;height:64px;margin-bottom:16px}}\
                    h1{{color:#4ade80;margin:0 0 8px}}p{{color:#999;margin:0}}</style></head>\
                    <body><div style=\"text-align:center\">\
                    <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#4ade80\" stroke-width=\"2\"><path d=\"M22 11.08V12a10 10 0 1 1-5.93-9.14\"/><polyline points=\"22 4 12 14.01 9 11.01\"/></svg>\
                    <h1>Login Successful</h1>\
                    <p>You may close this window and return to AgentHub Desktop.</p></div></body></html>";
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(), body
                    );
                    let _ = stream.write_all(resp.as_bytes());

                    let _ = app.emit(
                        "oidc-callback",
                        serde_json::json!({
                            "code": code,
                            "state": state,
                        }),
                    );
                    OIDC_STOPPED.store(true, Ordering::Relaxed);
                    return;
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if start.elapsed() > std::time::Duration::from_secs(CALLBACK_TIMEOUT_SECS) {
                        let _ = app.emit(
                            "oidc-callback-error",
                            serde_json::json!({
                                "error": "timeout",
                                "description": "Login timed out after 5 minutes",
                            }),
                        );
                        return;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(200));
                }
                Err(_) => {
                    let _ = app.emit(
                        "oidc-callback-error",
                        serde_json::json!({
                            "error": "server_error",
                            "description": "Callback server encountered an error",
                        }),
                    );
                    return;
                }
            }
        }
    });

    Ok(port)
}

/// Stop the OIDC callback server (for cancellation).
#[tauri::command]
pub async fn stop_oidc_callback_server() -> Result<(), String> {
    OIDC_STOPPED.store(true, Ordering::Relaxed);
    Ok(())
}

fn url_decode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                if let (Some(h1), Some(h2)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                    result.push((h1 << 4 | h2) as char);
                    i += 3;
                    continue;
                }
            }
            b'+' => {
                result.push(' ');
                i += 1;
                continue;
            }
            _ => {}
        }
        result.push(bytes[i] as char);
        i += 1;
    }
    result
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
