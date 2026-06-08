use crate::edge_manager::{EdgeHostReadiness, EdgeStatus, SharedEdgeManager};
use crate::oidc_server::{check_loopback_callback_readiness, LoopbackReadiness};
use crate::secure_store::{check_credential_store_readiness, CredentialStoreReadiness};
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Default)]
pub struct WorkspaceFileAccessState {
    allowed_roots: RwLock<Vec<PathBuf>>,
}

impl WorkspaceFileAccessState {
    fn allowed_roots(&self) -> Result<Vec<PathBuf>, String> {
        let roots = self
            .allowed_roots
            .read()
            .map_err(|_| "Workspace file access state is unavailable".to_string())?;
        if roots.is_empty() {
            return Err("No allowed workspace directories configured".to_string());
        }
        Ok(roots.clone())
    }

    fn replace_roots(&self, roots: Vec<PathBuf>) -> Result<(), String> {
        let mut guard = self
            .allowed_roots
            .write()
            .map_err(|_| "Workspace file access state is unavailable".to_string())?;
        *guard = roots;
        Ok(())
    }

    fn add_root(&self, root: PathBuf) -> Result<(), String> {
        let mut guard = self
            .allowed_roots
            .write()
            .map_err(|_| "Workspace file access state is unavailable".to_string())?;
        if !guard.iter().any(|existing| existing == &root) {
            guard.push(root);
        }
        Ok(())
    }
}

/// Validate that a path is within an allowed directory.
/// Returns the canonicalized path on success.
fn validate_path(path: &Path, allowlist: &[PathBuf]) -> Result<PathBuf, String> {
    if allowlist.is_empty() {
        return Err("No allowed workspace directories configured".to_string());
    }

    let canonical = resolve_for_boundary(path)
        .map_err(|e| format!("Cannot resolve path '{}': {}", path.display(), e))?;

    let allowed = allowlist.iter().any(|dir| {
        let dir_canonical = dir.canonicalize().unwrap_or_else(|_| dir.clone());
        canonical.starts_with(&dir_canonical)
    });

    if allowed {
        Ok(canonical)
    } else {
        Err(format!(
            "Path '{}' is outside allowed directories",
            path.display()
        ))
    }
}

fn resolve_for_boundary(path: &Path) -> std::io::Result<PathBuf> {
    if path.exists() {
        return path.canonicalize();
    }

    let mut missing: Vec<OsString> = Vec::new();
    let mut ancestor = path;
    while !ancestor.exists() {
        let name = ancestor.file_name().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "path has no existing ancestor",
            )
        })?;
        missing.push(name.to_os_string());
        ancestor = ancestor.parent().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "path has no existing ancestor",
            )
        })?;
    }

    let mut canonical = ancestor.canonicalize()?;
    for component in missing.iter().rev() {
        canonical.push(component);
    }
    Ok(canonical)
}

fn validate_state_path(path: &Path, access: &WorkspaceFileAccessState) -> Result<PathBuf, String> {
    validate_path(path, &access.allowed_roots()?)
}

fn workspace_roots_from_store_data(data: &WorkspaceStoreData) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for entry in &data.workspaces {
        let path = PathBuf::from(entry.path.trim());
        if !path.is_absolute() || !path.is_dir() {
            continue;
        }
        let canonical = path.canonicalize().unwrap_or(path);
        if !roots.iter().any(|root| root == &canonical) {
            roots.push(canonical);
        }
    }
    roots
}

fn replace_workspace_roots_from_store(
    access: &WorkspaceFileAccessState,
    data: &WorkspaceStoreData,
) -> Result<(), String> {
    let roots = authorized_workspace_roots_from_store_data(access, data)?;
    access.replace_roots(roots)
}

fn replace_workspace_roots_from_trusted_store(
    access: &WorkspaceFileAccessState,
    data: &WorkspaceStoreData,
) -> Result<(), String> {
    access.replace_roots(workspace_roots_from_store_data(data))
}

fn authorized_workspace_roots_from_store_data(
    access: &WorkspaceFileAccessState,
    data: &WorkspaceStoreData,
) -> Result<Vec<PathBuf>, String> {
    let roots = workspace_roots_from_store_data(data);
    if roots.is_empty() {
        return Ok(Vec::new());
    }
    let allowed = access.allowed_roots().map_err(|_| {
        "Workspace store sync contains workspace roots that are not authorized by the host; use the native workspace picker before syncing"
            .to_string()
    })?;
    let mut authorized = Vec::new();
    for root in roots {
        let canonical = validate_path(&root, &allowed).map_err(|_| {
            format!(
                "Workspace root '{}' is not authorized by the host; use the native workspace picker before syncing",
                root.display()
            )
        })?;
        if !authorized.iter().any(|existing| existing == &canonical) {
            authorized.push(canonical);
        }
    }
    Ok(authorized)
}

fn authorize_workspace_root_from_host_path(
    path: impl AsRef<Path>,
    access: &WorkspaceFileAccessState,
) -> Result<PathBuf, String> {
    let path = path.as_ref();
    if !path.is_absolute() {
        return Err(format!(
            "Workspace root '{}' must be an absolute path",
            path.display()
        ));
    }
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Cannot resolve workspace root '{}': {}", path.display(), e))?;
    if !canonical.is_dir() {
        return Err(format!(
            "Workspace root '{}' is not a directory",
            canonical.display()
        ));
    }
    access.add_root(canonical.clone())?;
    Ok(canonical)
}

fn workspace_store_entry_for_authorized_root(path: PathBuf) -> WorkspaceStoreEntry {
    WorkspaceStoreEntry {
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| path.display().to_string()),
        path: path.to_string_lossy().to_string(),
        last_opened_at: current_unix_millis(),
        branch: None,
        settings: None,
    }
}

fn upsert_workspace_store_entry(
    mut data: WorkspaceStoreData,
    entry: WorkspaceStoreEntry,
) -> WorkspaceStoreData {
    let entry_path = entry.path.to_lowercase();
    data.workspaces
        .retain(|existing| existing.path.to_lowercase() != entry_path);
    data.workspaces.insert(0, entry);
    data.workspaces.truncate(10);
    data
}

fn current_unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().try_into().unwrap_or(u64::MAX))
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileEntry>>,
}

#[tauri::command]
pub async fn get_edge_status(state: State<'_, SharedEdgeManager>) -> Result<EdgeStatus, String> {
    let mgr = state.lock().await;
    Ok(mgr.status())
}

#[tauri::command]
pub async fn get_edge_host_readiness(
    app: tauri::AppHandle,
    state: State<'_, SharedEdgeManager>,
) -> Result<EdgeHostReadiness, String> {
    let mgr = state.lock().await;
    Ok(mgr.host_readiness_for_app(&app))
}

#[tauri::command]
pub async fn get_edge_auth_token(state: State<'_, SharedEdgeManager>) -> Result<String, String> {
    let mgr = state.lock().await;
    mgr.local_auth_token().map(str::to_string)
}

#[derive(Debug, Clone, Serialize)]
pub struct PackagedLoginRealE2EGate {
    pub status: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PackagedLoginReadiness {
    pub loopback: LoopbackReadiness,
    pub credential_store: CredentialStoreReadiness,
    pub real_e2e: PackagedLoginRealE2EGate,
}

#[tauri::command]
pub async fn get_packaged_login_readiness() -> Result<PackagedLoginReadiness, String> {
    Ok(PackagedLoginReadiness {
        loopback: check_loopback_callback_readiness(),
        credential_store: check_credential_store_readiness(),
        real_e2e: PackagedLoginRealE2EGate {
            status: "proposal_only".to_string(),
            reason: "Real packaged login E2E requires an explicit TokenDance ID/browser gate."
                .to_string(),
        },
    })
}

#[tauri::command]
pub async fn start_edge(
    app: tauri::AppHandle,
    state: State<'_, SharedEdgeManager>,
) -> Result<EdgeStatus, String> {
    let mut mgr = state.lock().await;
    mgr.start(&app).await?;
    Ok(mgr.status())
}

#[tauri::command]
pub async fn stop_edge(state: State<'_, SharedEdgeManager>) -> Result<EdgeStatus, String> {
    let mut mgr = state.lock().await;
    mgr.stop().await?;
    Ok(mgr.status())
}

#[cfg(test)]
fn edge_host_readiness_snapshot(mgr: &crate::edge_manager::EdgeManager) -> EdgeHostReadiness {
    mgr.host_readiness()
}

// ── File Explorer Commands ──

/// Walk a directory and return a tree of FileEntry nodes.
/// Respects .gitignore patterns when a .gitignore file exists at the root.
#[tauri::command]
pub async fn read_dir_tree(
    dir: String,
    access: State<'_, WorkspaceFileAccessState>,
) -> Result<Vec<FileEntry>, String> {
    let root = Path::new(&dir);
    let root = validate_state_path(root, &access)?;
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", dir));
    }
    let roots = access.allowed_roots()?;
    let gitignore_patterns = load_gitignore(&root);
    walk_dir(&root, &root, &gitignore_patterns, &roots)
}

/// Create a new file at the given path. Parent directories must exist.
/// If content is None, an empty file is created.
#[tauri::command]
pub async fn create_file(
    path: String,
    content: Option<String>,
    _allowed_dirs: Option<Vec<String>>,
    access: State<'_, WorkspaceFileAccessState>,
) -> Result<(), String> {
    let p = Path::new(&path);
    let p = validate_state_path(p, &access)?;
    if p.exists() {
        return Err(format!("File already exists: {}", path));
    }
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent dirs: {}", e))?;
    }
    let data = content.unwrap_or_default();
    fs::write(&p, data).map_err(|e| format!("Failed to write file: {}", e))
}

/// Create a new directory at the given path. Creates parents as needed.
#[tauri::command]
pub async fn create_folder(
    path: String,
    _allowed_dirs: Option<Vec<String>>,
    access: State<'_, WorkspaceFileAccessState>,
) -> Result<(), String> {
    let p = Path::new(&path);
    let p = validate_state_path(p, &access)?;
    if p.exists() {
        return Err(format!("Path already exists: {}", path));
    }
    fs::create_dir_all(&p).map_err(|e| format!("Failed to create folder: {}", e))
}

/// Rename/move a file or directory from old_path to new_path.
#[tauri::command]
pub async fn rename_entry(
    old_path: String,
    new_path: String,
    _allowed_dirs: Option<Vec<String>>,
    access: State<'_, WorkspaceFileAccessState>,
) -> Result<(), String> {
    let src = Path::new(&old_path);
    let dst = Path::new(&new_path);
    let src = validate_state_path(src, &access)?;
    let dst = validate_state_path(dst, &access)?;
    if !src.exists() {
        return Err(format!("Source does not exist: {}", old_path));
    }
    if dst.exists() {
        return Err(format!("Destination already exists: {}", new_path));
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent dirs: {}", e))?;
    }
    fs::rename(&src, &dst).map_err(|e| format!("Failed to rename: {}", e))
}

/// Copy a file. Directories are copied recursively.
#[tauri::command]
pub async fn copy_entry(
    src_path: String,
    dst_path: String,
    _allowed_dirs: Option<Vec<String>>,
    access: State<'_, WorkspaceFileAccessState>,
) -> Result<(), String> {
    let src = Path::new(&src_path);
    let dst = Path::new(&dst_path);
    let roots = access.allowed_roots()?;
    let src = validate_path(src, &roots)?;
    let dst = validate_path(dst, &roots)?;
    if !src.exists() {
        return Err(format!("Source does not exist: {}", src_path));
    }
    if dst.exists() {
        return Err(format!("Destination already exists: {}", dst_path));
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent dirs: {}", e))?;
    }
    if src.is_dir() {
        copy_dir_recursive(&src, &dst, &roots)
            .map_err(|e| format!("Failed to copy directory: {}", e))
    } else {
        fs::copy(&src, &dst).map_err(|e| format!("Failed to copy file: {}", e))?;
        Ok(())
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path, allowlist: &[PathBuf]) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let src_path = entry.path();
        if file_type.is_symlink() {
            return Err(std::io::Error::other(format!(
                "Refusing to copy symbolic link: {}",
                src_path.display()
            )));
        }
        validate_path(&src_path, allowlist).map_err(std::io::Error::other)?;
        let dst_path = dst.join(entry.file_name());
        if file_type.is_dir() {
            validate_path(&dst_path, allowlist).map_err(std::io::Error::other)?;
            copy_dir_recursive(&src_path, &dst_path, allowlist)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

/// Delete a file or directory. Directories are removed recursively.
#[tauri::command]
pub async fn delete_entry(
    path: String,
    _allowed_dirs: Option<Vec<String>>,
    access: State<'_, WorkspaceFileAccessState>,
) -> Result<(), String> {
    let p = Path::new(&path);
    let p = validate_state_path(p, &access)?;
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    if p.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| format!("Failed to delete directory: {}", e))
    } else {
        fs::remove_file(&p).map_err(|e| format!("Failed to delete file: {}", e))
    }
}

/// Read the full contents of a file as a UTF-8 string.
#[tauri::command]
pub async fn read_file(
    path: String,
    _allowed_dirs: Option<Vec<String>>,
    access: State<'_, WorkspaceFileAccessState>,
) -> Result<String, String> {
    let p = Path::new(&path);
    let p = validate_state_path(p, &access)?;
    if !p.exists() {
        return Err(format!("File does not exist: {}", path));
    }
    if p.is_dir() {
        return Err(format!("Path is a directory, not a file: {}", path));
    }
    fs::read_to_string(&p).map_err(|e| format!("Failed to read file: {}", e))
}

/// Write content to a file, creating it if it does not exist or overwriting if it does.
/// Parent directories are created as needed.
#[tauri::command]
pub async fn write_file(
    path: String,
    content: String,
    _allowed_dirs: Option<Vec<String>>,
    access: State<'_, WorkspaceFileAccessState>,
) -> Result<(), String> {
    let p = Path::new(&path);
    let p = validate_state_path(p, &access)?;
    if p.is_dir() {
        return Err(format!("Path is a directory: {}", path));
    }
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent dirs: {}", e))?;
    }
    fs::write(&p, &content).map_err(|e| format!("Failed to write file: {}", e))
}

// ── Git Integration ──

#[derive(Debug, Clone, Serialize)]
pub struct GitStatus {
    pub branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<GitFileStatus>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GitFileStatus {
    /// File path relative to repo root
    pub path: String,
    /// Index status: M=modified, A=added, D=deleted, R=renamed, C=copied, ' '=unchanged, ?=untracked, !=ignored
    pub index_status: char,
    /// Working tree status: same codes as index_status
    pub worktree_status: char,
    /// Original path for renames/copies
    pub original_path: Option<String>,
}

/// Run `git status --porcelain -b` in the given directory and return
/// structured data about the branch and changed files.
#[tauri::command]
pub async fn git_status(
    dir: String,
    access: State<'_, WorkspaceFileAccessState>,
) -> Result<GitStatus, String> {
    let work_dir = Path::new(&dir);
    let work_dir = validate_state_path(work_dir, &access)?;

    // Run git status --porcelain -b
    let output = Command::new("git")
        .args(["status", "--porcelain", "-b"])
        .current_dir(&work_dir)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git status failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = stdout.lines().collect();

    // Parse branch line: "## branch...origin/branch [ahead N] [behind M]"
    let (branch, ahead, behind) =
        parse_branch_line(lines.first().copied().unwrap_or("## (no branch)"));

    // Parse file lines
    let files: Vec<GitFileStatus> = lines
        .iter()
        .skip(1) // skip branch line
        .filter_map(|line| parse_porcelain_line(line))
        .collect();

    Ok(GitStatus {
        branch,
        ahead,
        behind,
        files,
    })
}

// ── Allowlist Validation ──

/// A single entry in the workspace allowlist.
#[derive(Debug, Clone, Deserialize)]
pub struct AllowlistEntry {
    pub path: String,
    pub globs: Vec<String>,
    #[serde(rename = "trustLevel")]
    #[allow(dead_code)]
    pub trust_level: String,
}

/// Validate whether a file path is covered by any entry in the allowlist.
/// Returns true if the path is allowed by at least one entry.
#[tauri::command]
pub fn validate_allowlist(path: String, allowlist: Vec<AllowlistEntry>) -> bool {
    let target = Path::new(&path);

    // Normalize to absolute path for comparison
    let target_abs = match std::fs::canonicalize(target) {
        Ok(p) => p,
        Err(_) => {
            // If the file doesn't exist yet, try to resolve the parent
            if let Some(parent) = target.parent() {
                match std::fs::canonicalize(parent) {
                    Ok(parent_abs) => parent_abs.join(target.file_name().unwrap_or_default()),
                    Err(_) => return false,
                }
            } else {
                return false;
            }
        }
    };

    for entry in &allowlist {
        let entry_base = Path::new(&entry.path);
        let entry_abs = match std::fs::canonicalize(entry_base) {
            Ok(p) => p,
            Err(_) => continue, // skip unresolvable paths
        };

        // Check if the target is within the allowed directory
        if !target_abs.starts_with(&entry_abs) {
            continue;
        }

        // Get the relative path from the allowed directory
        let rel = match target_abs.strip_prefix(&entry_abs) {
            Ok(r) => r,
            Err(_) => continue,
        };

        let rel_str = rel.to_string_lossy().replace('\\', "/");

        // If no globs specified, allow everything under this directory
        if entry.globs.is_empty() {
            return true;
        }

        // Check each glob pattern
        for glob in &entry.globs {
            let pattern = glob.trim();
            if pattern.is_empty() || pattern == "**/*" || pattern == "**" {
                return true;
            }
            // Relative path matching: the glob is relative to the entry directory
            if glob_match(rel_str.as_str(), pattern) {
                return true;
            }
        }
    }

    false
}

/// Simple glob matching for allowlist validation.
/// Supports *, ?, **, and character classes.
fn glob_match(path: &str, pattern: &str) -> bool {
    let path_bytes = path.as_bytes();
    let pattern_bytes = pattern.as_bytes();
    glob_match_impl(path_bytes, pattern_bytes, 0, 0)
}

fn glob_match_impl(path: &[u8], pattern: &[u8], pi: usize, si: usize) -> bool {
    let plen = pattern.len();
    let slen = path.len();

    let mut pi = pi;
    let mut si = si;

    let mut star_pi = plen;
    let mut match_si = 0;

    while si < slen {
        if pi < plen && pattern[pi] == b'*' {
            // Check for ** (double star) - matches across path separators
            if pi + 1 < plen && pattern[pi + 1] == b'*' {
                // ** matches everything including slashes
                if pi + 2 < plen && pattern[pi + 2] == b'/' {
                    // **/ pattern - match remaining path at any depth
                    let remaining = &pattern[pi + 3..];
                    for k in si..=slen {
                        if k == slen || path[k] == b'/' {
                            if remaining.is_empty() || glob_match_impl(path, remaining, 0, k) {
                                return true;
                            }
                        }
                    }
                    return false;
                }
                // Just ** matches everything
                return true;
            }

            // Single * matches within path segment (up to next /)
            star_pi = pi;
            match_si = si;
            pi += 1;
        } else if pi < plen && (pattern[pi] == b'?' || pattern[pi] == path[si]) {
            pi += 1;
            si += 1;
        } else if star_pi != plen {
            pi = star_pi + 1;
            match_si += 1;
            si = match_si;
        } else {
            return false;
        }
    }

    while pi < plen && pattern[pi] == b'*' {
        pi += 1;
    }

    pi == plen
}

fn parse_branch_line(line: &str) -> (Option<String>, u32, u32) {
    // Format: "## branch_name...remote/branch [ahead N] [behind M]"
    if !line.starts_with("## ") {
        return (None, 0, 0);
    }

    let rest = &line[3..]; // strip "## "

    // Handle detached HEAD or initial state
    if rest == "(no branch)" || rest.starts_with("(initial)") {
        return (None, 0, 0);
    }

    let mut ahead: u32 = 0;
    let mut behind: u32 = 0;

    // Extract branch name (before "..." or end of string before [ahead/behind])
    let branch_part = rest.split(' ').next().unwrap_or(rest);
    let branch = if branch_part.contains("...") {
        Some(
            branch_part
                .split("...")
                .next()
                .unwrap_or(branch_part)
                .to_string(),
        )
    } else {
        Some(branch_part.to_string())
    };

    // Parse ahead/behind indicators
    if let Some(ahead_start) = rest.find("[ahead ") {
        let ahead_part = &rest[ahead_start + 7..];
        if let Some(end) = ahead_part.find(']') {
            ahead = ahead_part[..end].parse::<u32>().unwrap_or(0);
        }
    }
    if let Some(behind_start) = rest.find("[behind ") {
        let behind_part = &rest[behind_start + 8..];
        if let Some(end) = behind_part.find(']') {
            behind = behind_part[..end].parse::<u32>().unwrap_or(0);
        }
    }

    (branch, ahead, behind)
}

fn parse_porcelain_line(line: &str) -> Option<GitFileStatus> {
    if line.len() < 3 {
        return None;
    }

    let chars: Vec<char> = line.chars().collect();
    let index_status = chars[0];
    let worktree_status = chars[1];
    // After the two status chars there's a space, then the path
    let path_part = line[3..].trim();

    // Handle rename/copy: "R  old -> new" or "C  old -> new"
    if (index_status == 'R' || index_status == 'C') && path_part.contains(" -> ") {
        let parts: Vec<&str> = path_part.split(" -> ").collect();
        return Some(GitFileStatus {
            path: parts.get(1)?.to_string(),
            index_status,
            worktree_status,
            original_path: Some(parts.first()?.to_string()),
        });
    }

    // In porcelain v1, paths with spaces are quoted within double quotes
    let path = if path_part.starts_with('"') && path_part.ends_with('"') {
        path_part[1..path_part.len() - 1]
            .replace("\\\\", "\\")
            .replace("\\\"", "\"")
    } else {
        path_part.to_string()
    };

    Some(GitFileStatus {
        path,
        index_status,
        worktree_status,
        original_path: None,
    })
}

/// Run `git diff` (unstaged changes) in the given directory and return
/// the raw unified diff output.
#[tauri::command]
pub async fn git_diff_unstaged(
    dir: String,
    access: State<'_, WorkspaceFileAccessState>,
) -> Result<String, String> {
    run_git_diff(&dir, &["diff"], &access)
}

/// Run `git diff --cached` (staged changes) in the given directory and return
/// the raw unified diff output.
#[tauri::command]
pub async fn git_diff_staged(
    dir: String,
    access: State<'_, WorkspaceFileAccessState>,
) -> Result<String, String> {
    run_git_diff(&dir, &["diff", "--cached"], &access)
}

/// Run `git diff` for a specific file (unstaged) and return
/// the raw unified diff output.
#[tauri::command]
pub async fn git_diff_file(
    dir: String,
    file_path: String,
    access: State<'_, WorkspaceFileAccessState>,
) -> Result<String, String> {
    let work_dir = validate_state_path(Path::new(&dir), &access)?;
    let target = work_dir.join(&file_path);
    validate_state_path(&target, &access)?;
    run_git_diff_path(&work_dir, &["diff", "--", &file_path])
}

fn run_git_diff(
    dir: &str,
    args: &[&str],
    access: &WorkspaceFileAccessState,
) -> Result<String, String> {
    let work_dir = validate_state_path(Path::new(dir), access)?;
    run_git_diff_path(&work_dir, args)
}

fn run_git_diff_path(work_dir: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(work_dir)
        .output()
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git diff failed: {}", stderr.trim()));
    }

    String::from_utf8(output.stdout).map_err(|e| format!("Invalid UTF-8 in diff output: {}", e))
}

fn load_gitignore(root: &Path) -> Vec<String> {
    let gitignore_path = root.join(".gitignore");
    match fs::read_to_string(&gitignore_path) {
        Ok(content) => content
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .collect(),
        Err(_) => Vec::new(),
    }
}

fn is_ignored(entry_path: &Path, root: &Path, patterns: &[String]) -> bool {
    let rel = match entry_path.strip_prefix(root) {
        Ok(r) => r,
        Err(_) => return false,
    };
    let rel_str = rel.to_string_lossy().replace('\\', "/");
    let is_dir = entry_path.is_dir();

    for pattern in patterns {
        let mut pat = pattern.clone();

        // Negation
        let negate = pat.starts_with('!');
        if negate {
            pat = pat[1..].to_string();
        }

        // Trim trailing slash for dir patterns
        let match_dir_only = pat.ends_with('/');
        if match_dir_only {
            pat = pat[..pat.len() - 1].to_string();
        }

        let matched = gitignore_match(&rel_str, &pat, is_dir);

        if matched && !negate && !match_dir_only {
            return true;
        }
        if matched && !negate && match_dir_only && is_dir {
            return true;
        }
    }

    // Also ignore common VCS/metadata dirs
    let name = entry_path.file_name().unwrap_or_default().to_string_lossy();
    if is_dir {
        match name.as_ref() {
            ".git" | "node_modules" | ".svn" | ".hg" => return true,
            _ => {}
        }
    }

    false
}

fn gitignore_match(rel_path: &str, pattern: &str, _is_dir: bool) -> bool {
    // Simple glob matching: handle **, *, ?
    let pattern_bytes = pattern.as_bytes();
    let path_bytes = rel_path.as_bytes();
    gitignore_match_impl(path_bytes, pattern_bytes, 0, 0)
}

fn gitignore_match_impl(path: &[u8], pattern: &[u8], pi: usize, si: usize) -> bool {
    let plen = pattern.len();
    let slen = path.len();

    let mut pi = pi;
    let mut si = si;

    let mut star_pi = plen;
    let mut match_si = 0;

    while si < slen {
        if pi < plen && pattern[pi] == b'*' {
            // Check for ** (double star)
            if pi + 1 < plen && pattern[pi + 1] == b'*' {
                // ** matches everything including slashes
                if pi + 2 < plen && pattern[pi + 2] == b'/' {
                    // **/ pattern
                    let remaining = &pattern[pi + 3..];
                    for k in si..=slen {
                        let candidate = &path[k..];
                        if candidate.is_empty() || candidate[0] == b'/' {
                            if remaining.is_empty() || gitignore_match_impl(path, remaining, 0, k) {
                                return true;
                            }
                        }
                    }
                    return false;
                }
                // Just ** — match everything
                return true;
            }

            // Single * — match within path segment
            star_pi = pi;
            match_si = si;
            pi += 1;
        } else if pi < plen && (pattern[pi] == b'?' || pattern[pi] == path[si]) {
            pi += 1;
            si += 1;
        } else if star_pi != plen {
            pi = star_pi + 1;
            match_si += 1;
            si = match_si;
        } else {
            return false;
        }
    }

    while pi < plen && pattern[pi] == b'*' {
        pi += 1;
    }

    pi == plen
}

fn walk_dir(
    current: &Path,
    root: &Path,
    gitignore_patterns: &[String],
    allowlist: &[PathBuf],
) -> Result<Vec<FileEntry>, String> {
    let mut entries: Vec<FileEntry> = Vec::new();

    let dir_iter = match fs::read_dir(current) {
        Ok(it) => it,
        Err(e) => {
            return Err(format!(
                "Failed to read directory {}: {}",
                current.display(),
                e
            ))
        }
    };

    for entry_result in dir_iter {
        let entry = match entry_result {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };

        if is_ignored(&path, root, gitignore_patterns) {
            continue;
        }

        if validate_path(&path, allowlist).is_err() {
            continue;
        }

        let is_dir = file_type.is_dir();
        let children = if is_dir {
            match walk_dir(&path, root, gitignore_patterns, allowlist) {
                Ok(children) => Some(children),
                Err(_) => Some(Vec::new()),
            }
        } else {
            None
        };

        entries.push(FileEntry {
            name,
            path: path.to_string_lossy().to_string(),
            is_dir,
            children,
        });
    }

    // Sort: directories first, then alphabetical
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edge_manager::EdgeManager;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be after UNIX_EPOCH")
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("agenthub-desktop-file-boundary-{name}-{nonce}"));
            fs::create_dir_all(&path).expect("test directory should be created");
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn edge_host_readiness_command_snapshot_is_sidecar_only() {
        let manager = EdgeManager::new(
            PathBuf::from("edge-server/agenthub-edge"),
            PathBuf::from("agenthub-edge.sqlite"),
        )
        .expect("test token generation should succeed");

        let readiness = edge_host_readiness_snapshot(&manager);

        assert_eq!(readiness.sidecar_name, "agenthub-edge");
        assert_eq!(readiness.target_id, "local-edge");
        assert_eq!(readiness.route, "local-edge-api");
        assert_eq!(readiness.bind_addr, "127.0.0.1:3210");
        assert_eq!(readiness.health_url, "http://127.0.0.1:3210/v1/health");
        assert_eq!(readiness.log_paths.stdout, "<app-data>/edge-logs/local-edge.stdout.log");
        assert!(readiness.preflight.auth_token_ready);
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
        assert!(!readiness.running);
        assert!(!readiness.direct_cli_spawn);
    }

    #[test]
    fn validate_path_rejects_empty_allowlist() {
        let dir = TestDir::new("empty-allowlist");
        let file = dir.path.join("notes.txt");

        let err = validate_path(&file, &[]).expect_err("empty allowlist must fail closed");

        assert!(err.contains("No allowed workspace directories"));
    }

    #[test]
    fn validate_path_allows_nonexistent_child_inside_allowed_workspace() {
        let dir = TestDir::new("inside");
        let file = dir.path.join("nested").join("deeper").join("notes.txt");

        let resolved = validate_path(&file, &[dir.path.clone()])
            .expect("child under allowed workspace should pass");

        assert!(resolved.starts_with(dir.path.canonicalize().unwrap()));
    }

    #[test]
    fn validate_path_rejects_path_outside_allowed_workspace() {
        let allowed = TestDir::new("allowed");
        let outside = TestDir::new("outside");
        let file = outside.path.join("secret.txt");
        fs::write(&file, "outside").expect("outside file should be created");

        let err =
            validate_path(&file, &[allowed.path.clone()]).expect_err("outside path must be denied");

        assert!(err.contains("outside allowed directories"));
    }

    #[cfg(unix)]
    #[test]
    fn validate_path_rejects_symlink_that_escapes_workspace() {
        let allowed = TestDir::new("symlink-allowed");
        let outside = TestDir::new("symlink-outside");
        let outside_file = outside.path.join("secret.txt");
        fs::write(&outside_file, "outside").expect("outside file should be created");
        let link = allowed.path.join("linked-secret.txt");
        std::os::unix::fs::symlink(&outside_file, &link).expect("symlink should be created");

        let err = validate_path(&link, &[allowed.path.clone()])
            .expect_err("symlink target outside workspace must be denied");

        assert!(err.contains("outside allowed directories"));
    }

    #[cfg(windows)]
    #[test]
    fn validate_path_rejects_symlink_that_escapes_workspace() {
        let allowed = TestDir::new("symlink-allowed");
        let outside = TestDir::new("symlink-outside");
        let outside_file = outside.path.join("secret.txt");
        fs::write(&outside_file, "outside").expect("outside file should be created");
        let link = allowed.path.join("linked-secret.txt");
        if std::os::windows::fs::symlink_file(&outside_file, &link).is_err() {
            return;
        }

        let err = validate_path(&link, &[allowed.path.clone()])
            .expect_err("symlink target outside workspace must be denied");

        assert!(err.contains("outside allowed directories"));
    }

    #[test]
    fn workspace_file_access_state_rejects_unseeded_paths() {
        let dir = TestDir::new("unseeded-state");
        let access = WorkspaceFileAccessState::default();

        let err = validate_state_path(&dir.path, &access)
            .expect_err("unseeded workspace file access state must fail closed");

        assert!(err.contains("No allowed workspace directories"));
    }

    #[test]
    fn workspace_store_sync_cannot_grant_unknown_existing_directory() {
        let dir = TestDir::new("store-sync-unknown");
        let access = WorkspaceFileAccessState::default();
        let data = WorkspaceStoreData {
            workspaces: vec![WorkspaceStoreEntry {
                name: "unknown".to_string(),
                path: dir.path.to_string_lossy().to_string(),
                last_opened_at: 1,
                branch: None,
                settings: None,
            }],
        };

        let err = replace_workspace_roots_from_store(&access, &data)
            .expect_err("renderer workspace-store sync must not grant unknown roots");

        assert!(err.contains("not authorized"));
        assert!(validate_state_path(&dir.path, &access).is_err());
    }

    #[test]
    fn workspace_store_sync_round_trips_already_authorized_workspace() {
        let dir = TestDir::new("store-sync-authorized");
        let access = WorkspaceFileAccessState::default();
        let canonical = dir.path.canonicalize().unwrap();
        access
            .replace_roots(vec![canonical.clone()])
            .expect("test root should be seeded");
        let data = WorkspaceStoreData {
            workspaces: vec![WorkspaceStoreEntry {
                name: "authorized".to_string(),
                path: dir.path.to_string_lossy().to_string(),
                last_opened_at: 1,
                branch: Some("main".to_string()),
                settings: None,
            }],
        };

        replace_workspace_roots_from_store(&access, &data)
            .expect("already-authorized workspace should persist and remain allowed");

        let resolved = validate_state_path(&dir.path, &access)
            .expect("authorized workspace should still be allowed");
        assert_eq!(resolved, canonical);
    }

    #[test]
    fn host_authorized_workspace_root_can_seed_file_access() {
        let dir = TestDir::new("host-authorized-root");
        let access = WorkspaceFileAccessState::default();

        let canonical = authorize_workspace_root_from_host_path(&dir.path, &access)
            .expect("host-selected directory should be authorized");

        assert_eq!(canonical, dir.path.canonicalize().unwrap());
        let file = dir.path.join("notes.txt");
        fs::write(&file, "inside").expect("workspace file should be written");
        let resolved =
            validate_state_path(&file, &access).expect("file under host-selected root should pass");
        assert_eq!(resolved, file.canonicalize().unwrap());
    }

    #[test]
    fn host_authorized_workspace_root_rejects_relative_paths() {
        let access = WorkspaceFileAccessState::default();

        let err = authorize_workspace_root_from_host_path("relative/workspace", &access)
            .expect_err("relative host path should not be authorized");

        assert!(err.contains("must be an absolute path"));
        assert!(access.allowed_roots().is_err());
    }

    #[test]
    fn workspace_store_upsert_keeps_latest_authorized_root_first() {
        let data = WorkspaceStoreData {
            workspaces: vec![
                WorkspaceStoreEntry {
                    name: "old".to_string(),
                    path: "C:/repo".to_string(),
                    last_opened_at: 1,
                    branch: Some("old-branch".to_string()),
                    settings: None,
                },
                WorkspaceStoreEntry {
                    name: "other".to_string(),
                    path: "C:/other".to_string(),
                    last_opened_at: 2,
                    branch: None,
                    settings: None,
                },
            ],
        };
        let entry = WorkspaceStoreEntry {
            name: "repo".to_string(),
            path: "c:/repo".to_string(),
            last_opened_at: 3,
            branch: None,
            settings: None,
        };

        let updated = upsert_workspace_store_entry(data, entry);

        assert_eq!(updated.workspaces.len(), 2);
        assert_eq!(updated.workspaces[0].name, "repo");
        assert_eq!(updated.workspaces[0].path, "c:/repo");
        assert_eq!(updated.workspaces[1].name, "other");
    }

    #[test]
    fn workspace_store_roots_keep_only_existing_absolute_directories() {
        let dir = TestDir::new("store-roots");
        let data = WorkspaceStoreData {
            workspaces: vec![
                WorkspaceStoreEntry {
                    name: "valid".to_string(),
                    path: dir.path.to_string_lossy().to_string(),
                    last_opened_at: 1,
                    branch: None,
                    settings: None,
                },
                WorkspaceStoreEntry {
                    name: "relative".to_string(),
                    path: "relative/path".to_string(),
                    last_opened_at: 2,
                    branch: None,
                    settings: None,
                },
                WorkspaceStoreEntry {
                    name: "missing".to_string(),
                    path: dir.path.join("missing").to_string_lossy().to_string(),
                    last_opened_at: 3,
                    branch: None,
                    settings: None,
                },
            ],
        };

        let roots = workspace_roots_from_store_data(&data);

        assert_eq!(roots, vec![dir.path.canonicalize().unwrap()]);
    }

    #[cfg(unix)]
    #[test]
    fn copy_dir_recursive_rejects_nested_symlink() {
        let allowed = TestDir::new("copy-symlink-allowed");
        let outside = TestDir::new("copy-symlink-outside");
        let src = allowed.path.join("src");
        let dst = allowed.path.join("dst");
        fs::create_dir_all(&src).expect("source directory should be created");
        let outside_file = outside.path.join("secret.txt");
        fs::write(&outside_file, "outside").expect("outside file should be created");
        std::os::unix::fs::symlink(&outside_file, src.join("linked-secret.txt"))
            .expect("symlink should be created");

        let err = copy_dir_recursive(&src, &dst, &[allowed.path.clone()])
            .expect_err("copy should reject nested symlink");

        assert!(err.to_string().contains("Refusing to copy symbolic link"));
    }

    #[cfg(windows)]
    #[test]
    fn copy_dir_recursive_rejects_nested_symlink() {
        let allowed = TestDir::new("copy-symlink-allowed");
        let outside = TestDir::new("copy-symlink-outside");
        let src = allowed.path.join("src");
        let dst = allowed.path.join("dst");
        fs::create_dir_all(&src).expect("source directory should be created");
        let outside_file = outside.path.join("secret.txt");
        fs::write(&outside_file, "outside").expect("outside file should be created");
        if std::os::windows::fs::symlink_file(&outside_file, src.join("linked-secret.txt")).is_err()
        {
            return;
        }

        let err = copy_dir_recursive(&src, &dst, &[allowed.path.clone()])
            .expect_err("copy should reject nested symlink");

        assert!(err.to_string().contains("Refusing to copy symbolic link"));
    }
}

// ── Workspace settings persistence (JSON file in app data dir) ──

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkspaceSettingsData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_instructions: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkspaceStoreData {
    pub workspaces: Vec<WorkspaceStoreEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceStoreEntry {
    pub name: String,
    pub path: String,
    pub last_opened_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<WorkspaceSettingsData>,
}

fn workspace_store_path(app_handle: &tauri::AppHandle) -> std::path::PathBuf {
    use tauri::Manager;
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    data_dir.join("workspace-store.json")
}

pub fn seed_workspace_file_access_from_store(
    app: &tauri::AppHandle,
    access: &WorkspaceFileAccessState,
) -> Result<(), String> {
    let path = workspace_store_path(app);
    if !path.exists() {
        access.replace_roots(Vec::new())?;
        return Ok(());
    }
    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read workspace store: {}", e))?;
    let data: WorkspaceStoreData = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse workspace store: {}", e))?;
    replace_workspace_roots_from_trusted_store(access, &data)
}

#[tauri::command]
pub async fn read_workspace_store(
    app: tauri::AppHandle,
    access: State<'_, WorkspaceFileAccessState>,
) -> Result<WorkspaceStoreData, String> {
    let path = workspace_store_path(&app);
    if !path.exists() {
        access.replace_roots(Vec::new())?;
        return Ok(WorkspaceStoreData::default());
    }
    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read workspace store: {}", e))?;
    let data: WorkspaceStoreData = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse workspace store: {}", e))?;
    replace_workspace_roots_from_trusted_store(&access, &data)?;
    Ok(data)
}

#[tauri::command]
pub async fn write_workspace_store(
    app: tauri::AppHandle,
    data: WorkspaceStoreData,
    access: State<'_, WorkspaceFileAccessState>,
) -> Result<(), String> {
    let roots = authorized_workspace_roots_from_store_data(&access, &data)?;
    let path = workspace_store_path(&app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create app data dir: {}", e))?;
    }
    let content = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Failed to serialize workspace store: {}", e))?;
    fs::write(&path, &content).map_err(|e| format!("Failed to write workspace store: {}", e))?;
    access.replace_roots(roots)
}

#[tauri::command]
pub async fn choose_workspace_root(
    app: tauri::AppHandle,
    access: State<'_, WorkspaceFileAccessState>,
) -> Result<Option<WorkspaceStoreEntry>, String> {
    let selected = app
        .dialog()
        .file()
        .set_title("Choose workspace folder")
        .blocking_pick_folder();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|e| format!("Failed to resolve selected workspace folder: {}", e))?;
    let canonical = authorize_workspace_root_from_host_path(path, &access)?;
    let entry = workspace_store_entry_for_authorized_root(canonical);
    let store_path = workspace_store_path(&app);
    let existing = if store_path.exists() {
        let content = fs::read_to_string(&store_path)
            .map_err(|e| format!("Failed to read workspace store: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse workspace store: {}", e))?
    } else {
        WorkspaceStoreData::default()
    };
    let next = upsert_workspace_store_entry(existing, entry.clone());
    if let Some(parent) = store_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create app data dir: {}", e))?;
    }
    let content = serde_json::to_string_pretty(&next)
        .map_err(|e| format!("Failed to serialize workspace store: {}", e))?;
    fs::write(&store_path, &content)
        .map_err(|e| format!("Failed to write workspace store: {}", e))?;
    Ok(Some(entry))
}

// ── Workspace Content Search ──

#[derive(Debug, Clone, Serialize)]
pub struct FileGrepMatch {
    /// Relative file path from the workspace root.
    pub file_path: String,
    /// Just the file name component.
    pub file_name: String,
    /// Total number of matching lines in this file.
    pub match_count: u32,
    /// Line number of the first match.
    pub first_match_line: u32,
    /// Content of the first matching line (trimmed).
    pub first_match_preview: String,
}

/// Search file contents in a workspace directory using ripgrep (`rg`).
/// Falls back to system `grep` when `rg` is not available.
/// Results are grouped by file, sorted by match count descending.
#[tauri::command]
pub async fn search_workspace_content(
    dir: String,
    query: String,
    access: State<'_, WorkspaceFileAccessState>,
) -> Result<Vec<FileGrepMatch>, String> {
    let work_dir = Path::new(&dir);
    let work_dir = validate_state_path(work_dir, &access)?;
    if !work_dir.is_dir() {
        return Err(format!("Not a directory: {}", dir));
    }

    // Try ripgrep first (faster, respects .gitignore), then fall back to system grep.
    let output = Command::new("rg")
        .args([
            "-n",
            "-i",
            "--no-heading",
            "--color",
            "never",
            "-e",
            &query,
            ".",
        ])
        .current_dir(&work_dir)
        .output();

    let output = match output {
        Ok(o) if o.status.success() => o,
        _ => {
            // Fallback: system grep
            Command::new("grep")
                .args(["-rn", "-i", "--color=never", "-e", &query, "."])
                .current_dir(&work_dir)
                .output()
                .map_err(|e| format!("Neither rg nor grep is available: {}", e))?
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Group matches by file.
    use std::collections::BTreeMap;
    let mut file_matches: BTreeMap<String, Vec<(u32, String)>> = BTreeMap::new();

    for line in stdout.lines() {
        if line.is_empty() {
            continue;
        }
        // rg format:  file:line:text
        // grep -rn format:  file:line:text
        // For both, find the first ':' as file/path separator.
        let colon1 = match line.find(':') {
            Some(pos) => pos,
            None => continue,
        };
        let file_path = line[..colon1].to_string();
        let rest = &line[colon1 + 1..];

        let colon2 = match rest.find(':') {
            Some(pos) => pos,
            None => continue,
        };
        let line_num: u32 = rest[..colon2].parse().unwrap_or(0);
        let text = rest[colon2 + 1..].trim().to_string();

        file_matches
            .entry(file_path)
            .or_insert_with(Vec::new)
            .push((line_num, text));
    }

    let mut results: Vec<FileGrepMatch> = file_matches
        .into_iter()
        .map(|(file_path, matches)| {
            let match_count = matches.len() as u32;
            let first = matches.first().cloned().unwrap_or((0, String::new()));
            let file_name = file_path
                .rsplit(['/', '\\'])
                .next()
                .unwrap_or(&file_path)
                .to_string();

            FileGrepMatch {
                file_path,
                file_name,
                match_count,
                first_match_line: first.0,
                first_match_preview: first.1,
            }
        })
        .collect();

    // Sort by match count descending, then by file path.
    results.sort_by(|a, b| {
        b.match_count
            .cmp(&a.match_count)
            .then_with(|| a.file_path.cmp(&b.file_path))
    });

    Ok(results)
}
