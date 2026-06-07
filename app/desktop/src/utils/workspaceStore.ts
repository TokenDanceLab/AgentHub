export interface WorkspaceEntry {
  name: string;
  path: string;
  lastOpenedAt: number;
  branch?: string;
}

const STORAGE_KEY = 'agenthub.workspaces.recent';
const WORK_DIR_STORAGE_KEY = 'agenthub.prompt.workDir';
const MAX_ENTRIES = 10;

function compactRecord<T>(value: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function normalizePath(value: string): string {
  return (value ?? '').trim().replace(/^["']|["']$/g, '').trim();
}

function samePath(a: string, b: string): boolean {
  return normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase();
}

function pathBasename(value: string): string {
  return value.split(/[\\/]+/).filter(Boolean).pop() ?? value;
}

export function readRecentWorkspaces(): WorkspaceEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is WorkspaceEntry =>
          item != null &&
          typeof item === 'object' &&
          typeof (item as WorkspaceEntry).path === 'string' &&
          (item as WorkspaceEntry).path.trim().length > 0,
      )
      .map((item) => compactRecord<WorkspaceEntry>({
        name: item.name || pathBasename(item.path),
        path: normalizePath(item.path),
        lastOpenedAt: typeof item.lastOpenedAt === 'number' ? item.lastOpenedAt : Date.now(),
        branch: typeof item.branch === 'string' ? item.branch : undefined,
      }))
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function writeRecentWorkspaces(entries: WorkspaceEntry[]): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(entries.slice(0, MAX_ENTRIES)),
    );
  } catch {
    // Ignore persistence failures.
  }
}

export function addRecentWorkspace(entry: Pick<WorkspaceEntry, 'path'> & Partial<Omit<WorkspaceEntry, 'path'>>): WorkspaceEntry[] {
  const normalized = normalizePath(entry.path);
  if (!normalized) return readRecentWorkspaces();

  const existing = readRecentWorkspaces();
  const filtered = existing.filter((item) => !samePath(item.path, normalized));

  const newEntry: WorkspaceEntry = compactRecord<WorkspaceEntry>({
    name: entry.name || pathBasename(normalized),
    path: normalized,
    lastOpenedAt: Date.now(),
    branch: entry.branch,
  });

  const next = [newEntry, ...filtered].slice(0, MAX_ENTRIES);
  writeRecentWorkspaces(next);
  return next;
}

export function removeRecentWorkspace(targetPath: string): WorkspaceEntry[] {
  const existing = readRecentWorkspaces();
  const next = existing.filter((item) => !samePath(item.path, targetPath));
  writeRecentWorkspaces(next);
  return next;
}

export function clearRecentWorkspaces(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

export function updateWorkspaceBranch(workspacePath: string, branch: string | null): void {
  const normalized = normalizePath(workspacePath);
  if (!normalized || !branch) return;
  const existing = readRecentWorkspaces();
  const updated = existing.map((item) =>
    samePath(item.path, normalized) ? { ...item, branch } : item,
  );
  writeRecentWorkspaces(updated);
}

export function getSavedWorkDir(): string {
  try {
    return normalizePath(window.localStorage.getItem(WORK_DIR_STORAGE_KEY) ?? '');
  } catch {
    return '';
  }
}

export function setSavedWorkDir(workDir: string): void {
  try {
    window.localStorage.setItem(WORK_DIR_STORAGE_KEY, normalizePath(workDir));
  } catch {
    // Ignore.
  }
}

export function getSelectedWorkspace(): WorkspaceEntry | null {
  const savedPath = getSavedWorkDir();
  if (!savedPath) return null;
  const recents = readRecentWorkspaces();
  const found = recents.find((item) => samePath(item.path, savedPath));
  if (found) return found;
  return {
    name: pathBasename(savedPath),
    path: savedPath,
    lastOpenedAt: Date.now(),
  };
}

export function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  if (diff < 604800_000) return `${Math.floor(diff / 86400_000)}d ago`;
  const d = new Date(timestamp);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Migrate old recentWorkDirs (string[]) to WorkspaceEntry[] if needed. */
export function migrateLegacyRecentWorkDirs(): void {
  try {
    const legacyKey = 'agenthub.prompt.recentWorkDirs';
    const raw = window.localStorage.getItem(legacyKey);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const paths: string[] = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    if (paths.length === 0) return;
    const existing = readRecentWorkspaces();
    const existingPaths = new Set(existing.map((e) => e.path.toLowerCase()));
    const migrated = paths
      .map(normalizePath)
      .filter((p) => p && !existingPaths.has(p.toLowerCase()))
      .map((path) => ({
        name: pathBasename(path),
        path,
        lastOpenedAt: Date.now() - 3600_000 * paths.indexOf(path),
      }));
    if (migrated.length > 0) {
      writeRecentWorkspaces([...existing, ...migrated].slice(0, MAX_ENTRIES));
    }
    window.localStorage.removeItem(legacyKey);
  } catch {
    // Ignore.
  }
}

// ── Workspace-level settings ──

export interface WorkspaceSettings {
  defaultModel?: string;
  permissionMode?: string;
  customInstructions?: string;
}

const WORKSPACE_SETTINGS_PREFIX = 'agenthub.workspace.settings.';

function workspaceSettingsKey(workspacePath: string): string {
  // Normalize path to a stable key: lowercase, replace separators
  const normalized = workspacePath.trim().replace(/^["']|["']$/g, '').trim().toLowerCase();
  return `${WORKSPACE_SETTINGS_PREFIX}${normalized}`;
}

export function readWorkspaceSettings(workspacePath: string): WorkspaceSettings {
  try {
    const key = workspaceSettingsKey(workspacePath);
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== 'object') return {};
    const obj = parsed as Record<string, unknown>;
    return compactRecord<WorkspaceSettings>({
      defaultModel: typeof obj.defaultModel === 'string' ? obj.defaultModel : undefined,
      permissionMode: typeof obj.permissionMode === 'string' ? obj.permissionMode : undefined,
      customInstructions: typeof obj.customInstructions === 'string' ? obj.customInstructions : undefined,
    });
  } catch {
    return {};
  }
}

export function writeWorkspaceSettings(workspacePath: string, settings: WorkspaceSettings): void {
  try {
    const key = workspaceSettingsKey(workspacePath);
    const cleaned: Record<string, string> = {};
    if (settings.defaultModel?.trim()) cleaned.defaultModel = settings.defaultModel.trim();
    if (settings.permissionMode?.trim()) cleaned.permissionMode = settings.permissionMode.trim();
    if (settings.customInstructions?.trim()) cleaned.customInstructions = settings.customInstructions.trim();
    if (Object.keys(cleaned).length > 0) {
      window.localStorage.setItem(key, JSON.stringify(cleaned));
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore persistence failures.
  }
}

export function clearWorkspaceSettings(workspacePath: string): void {
  try {
    window.localStorage.removeItem(workspaceSettingsKey(workspacePath));
  } catch {
    // Ignore.
  }
}

// ── Rust backend sync ──

interface RustWorkspaceStoreEntry {
  name: string;
  path: string;
  last_opened_at: number;
  branch?: string;
  settings?: {
    default_model?: string;
    permission_mode?: string;
    custom_instructions?: string;
  };
}

interface RustWorkspaceStoreData {
  workspaces: RustWorkspaceStoreEntry[];
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

/**
 * Sync the local workspace list and settings to the Rust backend JSON file.
 * Called after any mutation to workspace data.
 */
export async function syncWorkspacesToBackend(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const workspaces = readRecentWorkspaces();
    const entries: RustWorkspaceStoreEntry[] = workspaces.map((ws) => {
      const settings = readWorkspaceSettings(ws.path);
      const rustSettings = (settings.defaultModel || settings.permissionMode || settings.customInstructions)
        ? compactRecord<NonNullable<RustWorkspaceStoreEntry['settings']>>({
            default_model: settings.defaultModel,
            permission_mode: settings.permissionMode,
            custom_instructions: settings.customInstructions,
          })
        : undefined;
      return compactRecord<RustWorkspaceStoreEntry>({
        name: ws.name,
        path: ws.path,
        last_opened_at: ws.lastOpenedAt,
        branch: ws.branch,
        settings: rustSettings,
      });
    });
    await invoke('write_workspace_store', { data: { workspaces: entries } });
  } catch {
    // Ignore sync failures; local storage is the source of truth.
  }
}

/**
 * Restore workspace data from the Rust backend JSON file.
 * Merges backend entries that are not already in localStorage.
 */
export async function restoreWorkspacesFromBackend(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const data: RustWorkspaceStoreData = await invoke('read_workspace_store');
    if (!data?.workspaces?.length) return;

    const existing = readRecentWorkspaces();
    const existingPaths = new Set(existing.map((e) => e.path.toLowerCase()));

    for (const entry of data.workspaces) {
      if (!entry.path || existingPaths.has(entry.path.toLowerCase())) continue;
      const ws: WorkspaceEntry = compactRecord<WorkspaceEntry>({
        name: entry.name || pathBasename(entry.path),
        path: normalizePath(entry.path),
        lastOpenedAt: entry.last_opened_at || Date.now(),
        branch: entry.branch,
      });
      existing.push(ws);
      if (entry.settings) {
        writeWorkspaceSettings(entry.path, compactRecord<WorkspaceSettings>({
          defaultModel: entry.settings.default_model,
          permissionMode: entry.settings.permission_mode,
          customInstructions: entry.settings.custom_instructions,
        }));
      }
    }
    if (existing.length > 0) {
      writeRecentWorkspaces(existing.slice(0, MAX_ENTRIES));
    }
  } catch {
    // Ignore restore failures.
  }
}
