// OIDC callback HTTP server for PKCE flow.
// Starts a local HTTP server on the fixed registered loopback port, listens
// for the TokenDance Account redirect, extracts code+state+iss,
// returns a success HTML page, and emits a Tauri event with the result.
//
// This is necessary because the frontend (browser webview) cannot create
// TCP servers directly — the Rust backend handles it.

use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

static OIDC_STOPPED: AtomicBool = AtomicBool::new(false);

const CALLBACK_TIMEOUT_SECS: u64 = 300;
const OIDC_CALLBACK_PORT: u16 = 53682;
const OIDC_CALLBACK_BIND: &str = "127.0.0.1:53682";

#[derive(Debug, Clone, Serialize)]
pub struct LoopbackReadiness {
    pub available: bool,
    pub bind_host: String,
    pub port: Option<u16>,
    pub redirect_uri: Option<String>,
    pub error: Option<String>,
}

pub fn check_loopback_callback_readiness() -> LoopbackReadiness {
    let bind_host = "127.0.0.1".to_string();
    match TcpListener::bind(OIDC_CALLBACK_BIND) {
        Ok(_listener) => LoopbackReadiness {
            available: true,
            bind_host,
            port: Some(OIDC_CALLBACK_PORT),
            redirect_uri: Some(format!("http://127.0.0.1:{OIDC_CALLBACK_PORT}/callback")),
            error: None,
        },
        Err(err) => LoopbackReadiness {
            available: false,
            bind_host,
            port: None,
            redirect_uri: None,
            error: Some(format!("failed to bind loopback callback listener: {err}")),
        },
    }
}

/// Starts an HTTP server on the fixed registered port that listens for ONE OIDC callback.
/// Returns the port number immediately.
/// When the callback arrives, emits either `oidc-callback` or `oidc-callback-error`.
#[tauri::command]
pub async fn start_oidc_callback_server(app: tauri::AppHandle) -> Result<u16, String> {
    OIDC_STOPPED.store(true, Ordering::Relaxed); // stop any previous instance

    let listener = TcpListener::bind(OIDC_CALLBACK_BIND)
        .map_err(|e| format!("failed to bind callback server: {e}"))?;

    // Reset for new instance
    OIDC_STOPPED.store(false, Ordering::Relaxed);

    // Spawn background thread to accept connections
    std::thread::spawn(move || {
        if let Err(e) = listener.set_nonblocking(true) {
            log::error!(
                "set_nonblocking on callback listener failed: {e}. Falling back to blocking mode."
            );
        }

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
                    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));

                    let reader_stream = match stream.try_clone() {
                        Ok(stream) => stream,
                        Err(_) => {
                            let _ = stream.write_all(
                                b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                            );
                            continue;
                        }
                    };
                    let mut reader = BufReader::new(reader_stream);

                    let mut request_line = String::new();
                    if reader.read_line(&mut request_line).is_err() {
                        let _ = stream.write_all(
                            b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        );
                        continue;
                    }

                    // Parse: GET /callback?code=xxx&state=yyy HTTP/1.1
                    let parts: Vec<&str> = request_line.split_whitespace().collect();
                    if parts.len() < 2 || parts[0] != "GET" {
                        let body = "Bad Request";
                        let resp = format!(
                            "HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(), body
                        );
                        let _ = stream.write_all(resp.as_bytes());
                        continue;
                    }

                    let mut host_header = String::new();
                    for _ in 0..32 {
                        let mut header_line = String::new();
                        if reader.read_line(&mut header_line).is_err() {
                            break;
                        }
                        if header_line == "\r\n" || header_line == "\n" || header_line.is_empty() {
                            break;
                        }
                        if let Some((name, value)) = header_line.split_once(':') {
                            if name.eq_ignore_ascii_case("host") {
                                host_header = value.trim().to_string();
                            }
                        }
                    }
                    if host_header != OIDC_CALLBACK_BIND {
                        let body = "Invalid Host";
                        let resp = format!(
                            "HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(),
                            body
                        );
                        let _ = stream.write_all(resp.as_bytes());
                        continue;
                    }

                    let path_and_query = parts[1];
                    let request_path = path_and_query.split('?').next().unwrap_or("");
                    if request_path != "/callback" {
                        let body = "Not Found";
                        let resp = format!(
                            "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(), body
                        );
                        let _ = stream.write_all(resp.as_bytes());
                        continue;
                    }
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
                    let mut issuer = String::new();
                    let mut error_val = String::new();

                    for pair in query.split('&') {
                        let mut kv = pair.splitn(2, '=');
                        let key = kv.next().unwrap_or("");
                        let val = kv.next().unwrap_or("");
                        let decoded_val = url_decode(val);

                        match key {
                            "code" => code = decoded_val,
                            "state" => state = decoded_val,
                            "iss" => issuer = decoded_val,
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

                    if code.is_empty() || state.is_empty() || issuer.is_empty() {
                        let body = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>AgentHub Error</title>\
                        <style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a0a0a;color:#eee}\
                        h1{color:#f87171}p{color:#999}</style></head>\
                        <body><div style=\"text-align:center\"><h1>Invalid Callback</h1>\
                        <p>The callback URL is missing code, state, or issuer. Please try logging in again.</p></div></body></html>";
                        let resp = format!(
                            "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(), body
                        );
                        let _ = stream.write_all(resp.as_bytes());

                        let _ = app.emit(
                            "oidc-callback-error",
                            serde_json::json!({
                                "error": "invalid_callback",
                                "description": "Missing code, state, or issuer in callback URL",
                            }),
                        );
                        OIDC_STOPPED.store(true, Ordering::Relaxed);
                        return;
                    }

                    // Callback received — the renderer still has to validate state,
                    // exchange the code and establish the Hub session.
                    let body = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>AgentHub Login</title>\
                    <style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0f0f0f;color:#eee}\
                    svg{width:64px;height:64px;margin-bottom:16px}\
                    h1{color:#4ade80;margin:0 0 8px}p{color:#999;margin:0}</style></head>\
                    <body><div style=\"text-align:center\">\
                    <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#4ade80\" stroke-width=\"2\"><path d=\"M22 11.08V12a10 10 0 1 1-5.93-9.14\"/><polyline points=\"22 4 12 14.01 9 11.01\"/></svg>\
                    <h1>Callback Received</h1>\
                    <p>AgentHub is verifying the sign-in. You may close this window and return to the app.</p></div></body></html>";
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
                            "iss": issuer,
                        }),
                    );

                    // Bring the window to the foreground after successful callback.
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                        #[cfg(target_os = "windows")]
                        {
                            bring_window_to_front(&window);
                        }
                    }

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

    Ok(OIDC_CALLBACK_PORT)
}

/// Hub origins the proxy may reach. This command forwards Hub authorization
/// headers, so it is deliberately not a general-purpose web proxy.
const ALLOWED_HUB_PROXY_ORIGINS: &[&str] = &[
    "http://127.0.0.1:8080",
    "http://localhost:8080",
    "https://hub-app.tokendancelab.com",
];

/// HTTP request headers the proxy will forward. Anything else is dropped to
/// prevent header injection / SSRF enrichment by a compromised webview.
const ALLOWED_REQUEST_HEADERS: &[&str] = &[
    "authorization",
    "content-type",
    "accept",
    "accept-language",
    "user-agent",
    "x-request-id",
    "x-trace-id",
    "x-correlation-id",
];

fn normalized_http_origin(raw: &str) -> Result<String, String> {
    let parsed = reqwest::Url::parse(raw)
        .map_err(|_| "invalid URL: expected an absolute HTTP(S) URL".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("SSRF guard: only HTTP(S) Hub origins are allowed".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("SSRF guard: URL credentials are not allowed".to_string());
    }
    if parsed.fragment().is_some() {
        return Err("SSRF guard: URL fragments are not allowed".to_string());
    }
    let origin = parsed.origin().ascii_serialization();
    if origin == "null" {
        return Err("SSRF guard: URL must have a network origin".to_string());
    }
    Ok(origin)
}

fn allowed_hub_proxy_origin(origin: &str) -> bool {
    if ALLOWED_HUB_PROXY_ORIGINS.contains(&origin) {
        return true;
    }
    std::env::var("AGENTHUB_DESKTOP_HUB_ORIGIN")
        .ok()
        .and_then(|raw| normalized_http_origin(raw.trim()).ok())
        .is_some_and(|configured| configured == origin)
}

/// Validate a proxy target URL against the exact Hub-origin allowlist.
fn validate_proxy_url(raw: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(raw)
        .map_err(|_| "invalid URL: expected an absolute HTTP(S) Hub URL".to_string())?;
    let origin = normalized_http_origin(raw)?;
    if !allowed_hub_proxy_origin(&origin) {
        return Err(format!(
            "SSRF guard: Hub proxy target origin {origin} is not allowlisted"
        ));
    }
    Ok(parsed)
}

/// Proxy an HTTP POST request through the Rust backend.
/// This is needed because WebView2 `fetch()` does not respect `HTTP_PROXY`/`HTTPS_PROXY`
/// environment variables (it uses Windows system proxy instead). The Rust `reqwest` client
/// respects env vars, so requests that need a proxy must go through this command.
///
/// **SSRF guard**: the `url` is validated against an allowlist before any network
/// request is made. See [`validate_proxy_url`] for the policy. Request headers are
/// filtered through [`ALLOWED_REQUEST_HEADERS`] to prevent header injection.
#[tauri::command]
pub async fn proxy_http_post(
    window: tauri::WebviewWindow,
    url: String,
    body: String,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<ProxyHttpResponse, String> {
    // Origin guard: reject invokes from non-trusted webview origins.
    crate::commands::validate_command_origin(&window)?;
    // Validate the URL before touching the network. This is the core SSRF
    // mitigation: an arbitrary webview must not be able to POST to internal
    // services, cloud metadata endpoints, or non-loopback private hosts.
    let validated = validate_proxy_url(&url)?;
    let target_origin = validated.origin().ascii_serialization();

    // Redirects are disabled so an allowlisted URL cannot bounce the proxy to
    // an arbitrary target (e.g. 302 → http://169.254.169.254). Callers that
    // need to follow redirects must validate each hop themselves.
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let mut req = client
        .post(validated)
        .header("Content-Type", "application/json");

    if let Some(hdrs) = headers {
        for (k, v) in hdrs {
            let lower = k.to_lowercase();
            if ALLOWED_REQUEST_HEADERS.iter().any(|h| *h == lower) {
                req = req.header(&k, &v);
            } else {
                log::warn!("[proxy_http_post] dropping non-allowlisted header {k:?}");
            }
        }
    }

    req = req.body(body);

    let resp = req.send().await.map_err(|e| {
        log::error!("[proxy_http_post] request to {target_origin} failed: {e}");
        format!("request failed: {e}")
    })?;

    let status = resp.status().as_u16();
    if resp.status().is_redirection() {
        let location = resp
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("<none>");
        return Err(format!(
            "redirect refused by SSRF guard (status {status}, location {location}); re-validate the target URL"
        ));
    }
    let resp_headers: std::collections::HashMap<String, String> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("failed to read response body: {e}"))?;

    Ok(ProxyHttpResponse {
        status,
        body: text,
        headers: resp_headers,
    })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProxyHttpResponse {
    pub status: u16,
    pub body: String,
    pub headers: std::collections::HashMap<String, String>,
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

/// Bring the window to the foreground using raw Win32 FFI.
/// This avoids type-version conflicts between `windows-sys` and Tauri's internal `raw-window-handle`.
#[cfg(target_os = "windows")]
fn bring_window_to_front(window: &tauri::WebviewWindow) {
    use std::ffi::c_void;

    type HWND = *mut c_void;

    extern "system" {
        fn SetForegroundWindow(hWnd: HWND) -> i32;
        fn BringWindowToTop(hWnd: HWND) -> i32;
    }

    if let Ok(hwnd) = window.hwnd() {
        // raw-window-handle 0.6+: HWND wraps *mut c_void as first field
        let raw: HWND = unsafe { std::ptr::addr_of!(hwnd.0).read() };
        if !raw.is_null() {
            unsafe {
                let _ = SetForegroundWindow(raw);
                let _ = BringWindowToTop(raw);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_readiness_binds_registered_localhost_port() {
        let readiness = check_loopback_callback_readiness();

        assert!(readiness.available);
        assert_eq!(readiness.bind_host, "127.0.0.1");
        assert_eq!(readiness.port, Some(OIDC_CALLBACK_PORT));
        assert_eq!(
            readiness.redirect_uri.as_deref(),
            Some("http://127.0.0.1:53682/callback")
        );
        assert!(readiness.error.is_none());
    }

    #[test]
    fn loopback_redirect_uri_uses_http_loopback_callback_path() {
        let readiness = LoopbackReadiness {
            available: true,
            bind_host: "127.0.0.1".to_string(),
            port: Some(OIDC_CALLBACK_PORT),
            redirect_uri: Some(format!("http://127.0.0.1:{OIDC_CALLBACK_PORT}/callback")),
            error: None,
        };

        assert_eq!(
            readiness.redirect_uri.as_deref(),
            Some("http://127.0.0.1:53682/callback")
        );
    }

    // ── SSRF guard: validate_proxy_url ───────────────────────────────

    #[test]
    fn proxy_url_allows_canonical_hub_origin() {
        let parsed =
            validate_proxy_url("https://hub-app.tokendancelab.com/client/auth/me").unwrap();
        assert_eq!(
            parsed.origin().ascii_serialization(),
            "https://hub-app.tokendancelab.com"
        );
        assert_eq!(parsed.path(), "/client/auth/me");
    }

    #[test]
    fn proxy_url_allows_loopback_hub() {
        let parsed = validate_proxy_url("http://127.0.0.1:8080/client/auth/me").unwrap();
        assert_eq!(
            parsed.origin().ascii_serialization(),
            "http://127.0.0.1:8080"
        );
    }

    #[test]
    fn proxy_url_blocks_arbitrary_public_https() {
        let err = validate_proxy_url("https://collector.example/upload").unwrap_err();
        assert!(err.contains("not allowlisted"), "{err}");
    }

    #[test]
    fn proxy_url_blocks_old_hub_host() {
        let err = validate_proxy_url("https://api.vectorcontrol.tech/v1/chat").unwrap_err();
        assert!(err.contains("not allowlisted"), "{err}");
    }

    #[test]
    fn proxy_url_blocks_userinfo_private_target() {
        let err = validate_proxy_url("https://foo@10.0.0.1/admin").unwrap_err();
        assert!(err.contains("credentials"), "{err}");
    }

    #[test]
    fn proxy_url_blocks_local_edge_port() {
        let err = validate_proxy_url("http://127.0.0.1:3210/v1/health").unwrap_err();
        assert!(err.contains("not allowlisted"), "{err}");
    }

    #[test]
    fn proxy_url_blocks_cloud_metadata_endpoint() {
        let err = validate_proxy_url("http://169.254.169.254/latest/meta-data/").unwrap_err();
        assert!(err.contains("not allowlisted"), "{err}");
    }

    #[test]
    fn proxy_url_blocks_private_dns_style_hosts() {
        for target in [
            "https://10.0.0.1/admin",
            "https://192.168.1.1/admin",
            "https://172.16.0.1/admin",
            "https://[fd00::1]/admin",
        ] {
            let err = validate_proxy_url(target).unwrap_err();
            assert!(err.contains("not allowlisted"), "{target}: {err}");
        }
    }

    #[test]
    fn proxy_url_blocks_zero_ip() {
        let err = validate_proxy_url("https://0.0.0.0/").unwrap_err();
        assert!(err.contains("not allowlisted"), "{err}");
    }

    #[test]
    fn proxy_url_blocks_non_http_scheme() {
        let err = validate_proxy_url("file:///etc/passwd").unwrap_err();
        assert!(err.contains("HTTP(S)"), "{err}");
    }

    #[test]
    fn proxy_url_blocks_fragments() {
        let err =
            validate_proxy_url("https://hub-app.tokendancelab.com/client#fragment").unwrap_err();
        assert!(err.contains("fragments"), "{err}");
    }

    #[test]
    fn proxy_url_rejects_missing_scheme() {
        let err = validate_proxy_url("127.0.0.1:8080/").unwrap_err();
        assert!(err.contains("invalid URL"), "{err}");
    }
}
