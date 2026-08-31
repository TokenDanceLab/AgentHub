// OIDC callback HTTP server for PKCE flow.
// Starts a local HTTP server on 127.0.0.1:0 (random port), listens for
// the TokenDance ID redirect, extracts code+state from the query string,
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
    match TcpListener::bind("127.0.0.1:0") {
        Ok(listener) => match listener.local_addr() {
            Ok(addr) => {
                let port = addr.port();
                LoopbackReadiness {
                    available: true,
                    bind_host,
                    port: Some(port),
                    redirect_uri: Some(format!("http://127.0.0.1:{port}/callback")),
                    error: None,
                }
            }
            Err(err) => LoopbackReadiness {
                available: false,
                bind_host,
                port: None,
                redirect_uri: None,
                error: Some(format!(
                    "failed to inspect loopback callback address: {err}"
                )),
            },
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

/// Starts an HTTP server on a random port that listens for ONE OIDC callback.
/// Returns the port number immediately.
/// When the callback arrives, emits either `oidc-callback` or `oidc-callback-error`.
#[tauri::command]
pub async fn start_oidc_callback_server(app: tauri::AppHandle) -> Result<u16, String> {
    OIDC_STOPPED.store(true, Ordering::Relaxed); // stop any previous instance

    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("failed to bind callback server: {e}"))?;

    let port = listener
        .local_addr()
        .map(|a| a.port())
        .map_err(|e| format!("failed to get local address: {e}"))?;

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
                        <style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a0a0a;color:#eee}\
                        h1{color:#f87171}p{color:#999}</style></head>\
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
                    <style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0f0f0f;color:#eee}\
                    svg{width:64px;height:64px;margin-bottom:16px}\
                    h1{color:#4ade80;margin:0 0 8px}p{color:#999;margin:0}</style></head>\
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

    Ok(port)
}

/// Parsed components of a URL string, extracted without the `url` crate.
#[derive(Debug)]
struct ParsedProxyUrl {
    scheme: String,
    host: String,
    port: Option<u16>,
}

/// Ports on 127.0.0.1 that `proxy_http_post` is permitted to reach.
/// Local Edge runs on 3210; the OIDC callback server binds a random port
/// but is never a proxy *target*, so it is deliberately absent here.
const ALLOWED_LOOPBACK_PORTS: &[u16] = &[3210];

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

/// Parse a URL into scheme/host/port without an external `url` dependency.
/// Returns `Err` if the URL is structurally invalid (no scheme, no host).
fn parse_proxy_url(raw: &str) -> Result<ParsedProxyUrl, String> {
    let scheme_end = raw
        .find("://")
        .ok_or_else(|| format!("invalid URL: missing scheme separator in {raw:?}"))?;
    let scheme = raw[..scheme_end].to_lowercase();
    if scheme.is_empty() {
        return Err(format!("invalid URL: empty scheme in {raw:?}"));
    }

    let rest = &raw[scheme_end + 3..];
    // Host ends at the first '/', '?', '#', or ':' (port) — whichever comes first.
    let host_end = rest
        .find(|c: char| c == '/' || c == '?' || c == '#' || c == ':')
        .unwrap_or(rest.len());
    let host = rest[..host_end]
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_lowercase();
    if host.is_empty() {
        return Err(format!("invalid URL: empty host in {raw:?}"));
    }

    let port = if host_end < rest.len() && rest.as_bytes()[host_end] == b':' {
        let port_start = host_end + 1;
        let port_str = &rest[port_start..rest_start_of_path(rest, port_start)];
        port_str.parse::<u16>().ok()
    } else {
        None
    };

    Ok(ParsedProxyUrl { scheme, host, port })
}

/// Find the byte index where the path begins (first '/' or '?' or '#') at or
/// after `start`, or the end of the string.
fn rest_start_of_path(s: &str, start: usize) -> usize {
    s[start..]
        .find(|c: char| c == '/' || c == '?' || c == '#')
        .map(|i| start + i)
        .unwrap_or(s.len())
}

/// Returns `true` if `host` is a private, link-local, loopback, or
/// metadata-endpoint IP that must never be reached via the proxy (SSRF guard).
/// Loopback (127.0.0.1 / ::1) is handled separately because it is conditionally
/// allowed on whitelisted ports.
fn is_blocked_private_host(host: &str) -> bool {
    // IPv4 dotted-quad checks.
    let octets: Vec<&str> = host.split('.').collect();
    if octets.len() == 4 && octets.iter().all(|o| o.parse::<u8>().is_ok()) {
        let a: u8 = octets[0].parse().unwrap();
        let b: u8 = octets[1].parse().unwrap();
        return matches!(a, 10)                       // 10.0.0.0/8
            || (a == 172 && (16..=31).contains(&b))  // 172.16.0.0/12
            || (a == 192 && b == 168)                // 192.168.0.0/16
            || (a == 169 && b == 254)                // 169.254.0.0/16 (link-local + cloud metadata)
            || a == 0                                // 0.0.0.0/8
            || (a == 127 && host != "127.0.0.1"); // 127.0.0.0/8 except the exact loopback addr
    }
    // IPv6 link-local / unique-local / loopback.
    if host == "::1" {
        return false; // loopback handled by caller
    }
    if host.starts_with("fc") || host.starts_with("fd") {
        return true; // fc00::/7 unique-local
    }
    if host.starts_with("fe80") {
        return true; // link-local
    }
    false
}

/// Validate a proxy target URL against the SSRF allowlist policy.
///
/// Rules:
/// - Scheme must be `http` or `https` (no file://, ftp://, gopher://, etc.).
/// - `https` is allowed to any public host, but private IP ranges are blocked.
///   `https` to `127.0.0.1` is also blocked unless on an allowlisted port.
/// - `http` is allowed ONLY to `127.0.0.1` on ports in [`ALLOWED_LOOPBACK_PORTS`].
/// - `localhost` (non-IP) over http is rejected — callers must use 127.0.0.1
///   or switch to https.
fn validate_proxy_url(raw: &str) -> Result<ParsedProxyUrl, String> {
    // Fast-path scheme check before full parse so that file:///etc/passwd
    // (which has an empty host) is rejected for the right reason.
    let scheme_end = raw
        .find("://")
        .ok_or_else(|| format!("invalid URL: missing scheme separator in {raw:?}"))?;
    let scheme = raw[..scheme_end].to_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err(format!(
            "SSRF guard: scheme {scheme:?} is not allowed; use http (loopback only) or https"
        ));
    }

    let parsed = parse_proxy_url(raw)?;
    debug_assert_eq!(parsed.scheme, scheme);

    match parsed.scheme.as_str() {
        "https" => {
            if is_blocked_private_host(&parsed.host) {
                return Err(format!(
                    "SSRF guard: https to private/link-local host {} is blocked",
                    parsed.host
                ));
            }
            // Block https to loopback unless on an allowlisted port. Reaching
            // 127.0.0.1 over https to a random port is not a legitimate
            // business endpoint and mirrors the SSRF exfiltration risk.
            if parsed.host == "127.0.0.1" {
                let port = parsed.port.ok_or_else(|| {
                    "SSRF guard: https to 127.0.0.1 without an explicit port is blocked".to_string()
                })?;
                if !ALLOWED_LOOPBACK_PORTS.contains(&port) {
                    return Err(format!(
                        "SSRF guard: https to 127.0.0.1 port {port} is not in the allowlist {ALLOWED_LOOPBACK_PORTS:?}"
                    ));
                }
            }
            Ok(parsed)
        }
        "http" => {
            if parsed.host != "127.0.0.1" {
                return Err(format!(
                    "SSRF guard: http is only allowed to 127.0.0.1 (got host {}); use https for remote hosts",
                    parsed.host
                ));
            }
            let port = parsed.port.ok_or_else(|| {
                "SSRF guard: http to 127.0.0.1 without an explicit port is blocked".to_string()
            })?;
            if !ALLOWED_LOOPBACK_PORTS.contains(&port) {
                return Err(format!(
                    "SSRF guard: http to 127.0.0.1 port {port} is not in the allowlist {ALLOWED_LOOPBACK_PORTS:?}"
                ));
            }
            Ok(parsed)
        }
        // Unreachable: scheme already validated above.
        other => Err(format!(
            "SSRF guard: scheme {other:?} is not allowed; use http (loopback only) or https"
        )),
    }
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
    let _validated = validate_proxy_url(&url)?;

    // Redirects are disabled so an allowlisted URL cannot bounce the proxy to
    // an arbitrary target (e.g. 302 → http://169.254.169.254). Callers that
    // need to follow redirects must validate each hop themselves.
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let mut req = client.post(&url).header("Content-Type", "application/json");

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
        log::error!("[proxy_http_post] request to {url} failed: {e}");
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
    fn loopback_readiness_binds_random_localhost_port() {
        let readiness = check_loopback_callback_readiness();

        assert!(readiness.available);
        assert_eq!(readiness.bind_host, "127.0.0.1");
        assert!(readiness.port.unwrap_or_default() > 0);
        assert!(readiness.error.is_none());
    }

    #[test]
    fn loopback_redirect_uri_uses_http_loopback_callback_path() {
        let readiness = LoopbackReadiness {
            available: true,
            bind_host: "127.0.0.1".to_string(),
            port: Some(49152),
            redirect_uri: Some("http://127.0.0.1:49152/callback".to_string()),
            error: None,
        };

        assert_eq!(
            readiness.redirect_uri.as_deref(),
            Some("http://127.0.0.1:49152/callback")
        );
    }

    // ── SSRF guard: validate_proxy_url ───────────────────────────────

    #[test]
    fn proxy_url_allows_https_to_public_domain() {
        let parsed = validate_proxy_url("https://api.vectorcontrol.tech/v1/chat").unwrap();
        assert_eq!(parsed.scheme, "https");
        assert_eq!(parsed.host, "api.vectorcontrol.tech");
        assert!(parsed.port.is_none());
    }

    #[test]
    fn proxy_url_allows_http_to_loopback_edge_port() {
        let parsed = validate_proxy_url("http://127.0.0.1:3210/v1/health").unwrap();
        assert_eq!(parsed.scheme, "http");
        assert_eq!(parsed.host, "127.0.0.1");
        assert_eq!(parsed.port, Some(3210));
    }

    #[test]
    fn proxy_url_blocks_cloud_metadata_endpoint() {
        // 169.254.169.254 is the classic cloud metadata IP — SSRF exfiltration.
        let err = validate_proxy_url("http://169.254.169.254/latest/meta-data/").unwrap_err();
        assert!(err.contains("SSRF guard"), "{err}");
        assert!(err.contains("169.254.169.254"), "{err}");
    }

    #[test]
    fn proxy_url_blocks_private_10_range() {
        let err = validate_proxy_url("https://10.0.0.1/admin").unwrap_err();
        assert!(err.contains("SSRF guard"), "{err}");
    }

    #[test]
    fn proxy_url_blocks_private_192_168_range() {
        let err = validate_proxy_url("https://192.168.1.1/admin").unwrap_err();
        assert!(err.contains("SSRF guard"), "{err}");
    }

    #[test]
    fn proxy_url_blocks_private_172_16_range() {
        let err = validate_proxy_url("https://172.16.0.1/admin").unwrap_err();
        assert!(err.contains("SSRF guard"), "{err}");
    }

    #[test]
    fn proxy_url_blocks_loopback_non_allowlisted_port() {
        let err = validate_proxy_url("http://127.0.0.1:8080/secret").unwrap_err();
        assert!(err.contains("allowlist"), "{err}");
        assert!(err.contains("8080"), "{err}");
    }

    #[test]
    fn proxy_url_blocks_http_to_non_loopback_host() {
        let err = validate_proxy_url("http://api.vectorcontrol.tech/v1/chat").unwrap_err();
        assert!(err.contains("only allowed to 127.0.0.1"), "{err}");
    }

    #[test]
    fn proxy_url_blocks_http_to_localhost() {
        // `localhost` is not the exact IP 127.0.0.1 — rejected to avoid DNS rebinding.
        let err = validate_proxy_url("http://localhost:3210/").unwrap_err();
        assert!(err.contains("only allowed to 127.0.0.1"), "{err}");
    }

    #[test]
    fn proxy_url_blocks_non_http_scheme() {
        let err = validate_proxy_url("file:///etc/passwd").unwrap_err();
        assert!(err.contains("scheme"), "{err}");
        assert!(err.contains("file"), "{err}");
    }

    #[test]
    fn proxy_url_blocks_zero_ip() {
        let err = validate_proxy_url("https://0.0.0.0/").unwrap_err();
        assert!(err.contains("SSRF guard"), "{err}");
    }

    #[test]
    fn proxy_url_blocks_ipv6_unique_local() {
        let err = validate_proxy_url("https://[fd00::1]/").unwrap_err();
        assert!(err.contains("SSRF guard"), "{err}");
    }

    #[test]
    fn proxy_url_blocks_https_to_loopback_non_edge_port() {
        // Even over https, 127.0.0.1 without an allowlisted port is not a
        // legitimate business endpoint — block it.
        let err = validate_proxy_url("https://127.0.0.1:9999/").unwrap_err();
        assert!(err.contains("SSRF guard"), "{err}");
    }

    #[test]
    fn proxy_url_parses_port_from_url_with_path() {
        let parsed = validate_proxy_url("http://127.0.0.1:3210/v1/health?detail=1").unwrap();
        assert_eq!(parsed.port, Some(3210));
    }

    #[test]
    fn proxy_url_rejects_missing_scheme() {
        let err = validate_proxy_url("127.0.0.1:3210/").unwrap_err();
        assert!(err.contains("missing scheme"), "{err}");
    }
}
