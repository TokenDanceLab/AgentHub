pub use crate::host::fs::{seed_workspace_file_access_from_store, WorkspaceFileAccessState};
pub use crate::host::window::{build_tray, spawn_health_check};

/// Allowed webview origins for custom command invocation.
/// In production, Tauri serves the frontend from `tauri://localhost` (or
/// `https://tauri.localhost` on Windows WebView2). In dev mode the Vite dev
/// server serves from `http://127.0.0.1:5173` or `http://localhost:5173`.
const ALLOWED_COMMAND_ORIGINS: &[&str] = &[
    "tauri://localhost",
    "https://tauri.localhost",
    "https://tauri.localhost/",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
];

/// Validate that a custom command is being invoked from a trusted webview
/// origin. Tauri v2 custom `#[tauri::command]` functions are not gated by
/// capabilities — any webview with an invoke handle can call them. This guard
/// prevents a compromised or injected script from calling privileged commands
/// if the webview origin is unexpected.
///
/// Call this at the entry of security-sensitive commands by adding a
/// `window: tauri::WebviewWindow` parameter.
pub fn validate_command_origin(window: &tauri::WebviewWindow) -> Result<(), String> {
    let origin = window.url().map(|url| url.to_string()).unwrap_or_default();
    let origin_str = origin.as_str();

    // Exact match against the allowlist.
    if ALLOWED_COMMAND_ORIGINS
        .iter()
        .any(|allowed| *allowed == origin_str)
    {
        return Ok(());
    }

    // Also accept the origin without a trailing path (e.g. "tauri://localhost/"
    // with a path component). Compare the "scheme://host" prefix.
    let prefix = if let Some(scheme_end) = origin_str.find("://") {
        let after = &origin_str[scheme_end + 3..];
        let host_end = after.find('/').unwrap_or(after.len());
        &origin_str[..scheme_end + 3 + host_end]
    } else {
        origin_str
    };
    if ALLOWED_COMMAND_ORIGINS
        .iter()
        .any(|allowed| *allowed == prefix)
    {
        return Ok(());
    }

    log::warn!("[security] command invoked from untrusted origin: {origin_str}");
    Err(format!(
        "command rejected: untrusted webview origin {origin_str:?}"
    ))
}
