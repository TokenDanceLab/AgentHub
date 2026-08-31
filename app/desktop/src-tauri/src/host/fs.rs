use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
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
    pub(crate) allowed_roots: RwLock<Vec<PathBuf>>,
}

impl WorkspaceFileAccessState {
    pub fn allowed_roots(&self) -> Result<Vec<PathBuf>, String> {
        let roots = self
            .allowed_roots
            .read()
            .map_err(|_| "Workspace file access state is unavailable".to_string())?;
        if roots.is_empty() {
            return Err("No allowed workspace directories configured".to_string());
        }
        Ok(roots.clone())
    }

    pub fn replace_roots(&self, roots: Vec<PathBuf>) -> Result<(), String> {
        let mut guard = self
            .allowed_roots
            .write()
            .map_err(|_| "Workspace file access state is unavailable".to_string())?;
        *guard = roots;
        Ok(())
    }

    pub fn add_root(&self, root: PathBuf) -> Result<(), String> {
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

/// Test-only helper that applies the authorized workspace-root sync path.
/// Narrowed to `#[cfg(test)]` so the non-test lib build does not carry an
/// unused private function; production store sync uses
/// `replace_workspace_roots_from_trusted_store` instead. The two security
/// tests below exercise the "renderer store sync must not grant unknown
/// roots" boundary, which is why this helper is retained.
#[cfg(test)]
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

// ── Types ──

#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileEntry>>,
}

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

#[derive(Debug, Clone, Deserialize)]
pub struct AllowlistEntry {
    pub path: String,
    pub globs: Vec<String>,
    #[serde(rename = "trustLevel")]
    #[allow(dead_code)]
    pub trust_level: String,
}

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
/// Create a new directory at the given path. Creates parents as needed.
/// Rename/move a file or directory from old_path to new_path.
/// Copy a file. Directories are copied recursively.
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
// ── Git Integration ──

/// Run `git status --porcelain -b` in the given directory and return
/// structured data about the branch and changed files.
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

fn parse_branch_line(line: &str) -> (Option<String>, u32, u32) {
    if !line.starts_with("## ") {
        return (None, 0, 0);
    }

    let rest = &line[3..];

    if rest == "(no branch)" || rest.starts_with("(initial)") {
        return (None, 0, 0);
    }

    let mut ahead: u32 = 0;
    let mut behind: u32 = 0;

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
    let path_part = line[3..].trim();

    if (index_status == 'R' || index_status == 'C') && path_part.contains(" -> ") {
        let parts: Vec<&str> = path_part.split(" -> ").collect();
        return Some(GitFileStatus {
            path: parts.get(1)?.to_string(),
            index_status,
            worktree_status,
            original_path: Some(parts.first()?.to_string()),
        });
    }

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

// ── Allowlist Validation ──

/// Validate whether a file path is covered by any entry in the allowlist.
/// Returns true if the path is allowed by at least one entry.
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
            if pi + 1 < plen && pattern[pi + 1] == b'*' {
                if pi + 2 < plen && pattern[pi + 2] == b'/' {
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
                return true;
            }

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

// ── Workspace Store Persistence ──

fn workspace_store_path(app_handle: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
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

// ── Workspace Content Search ──

/// Search file contents in a workspace directory using ripgrep (`rg`).
/// Falls back to system `grep` when `rg` is not available.
/// Results are grouped by file, sorted by match count descending.
// ── Internal Helpers ──

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

        let negate = pat.starts_with('!');
        if negate {
            pat = pat[1..].to_string();
        }

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
            if pi + 1 < plen && pattern[pi + 1] == b'*' {
                if pi + 2 < plen && pattern[pi + 2] == b'/' {
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
                return true;
            }

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
