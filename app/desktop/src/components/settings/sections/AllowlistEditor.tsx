import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, X, Check, FolderOpen, FileText, Terminal, Search, ShieldCheck, ShieldX } from 'lucide-react';
import styles from '../primitives/primitives.module.css';
import { STORAGE_PREFIX } from '../utils';
import type { ExecutionTargetTrustLevel } from '@/api/hubClient';
import { validateAllowlistPath, type TauriAllowlistEntry } from '@/api/allowlistValidation';

// ── Allowlist data types ──

export interface AllowlistEntryToolPermissions {
  read_file: boolean;
  write_file: boolean;
  execute_command: boolean;
}

export interface AllowlistEntry {
  id: string;
  path: string;
  globs: string[];
  trustLevel: ExecutionTargetTrustLevel;
  permissions: AllowlistEntryToolPermissions;
}

// ── Persistence ──

const ALLOWLIST_STORAGE_KEY = 'workspaceAllowlist';

export function readAllowlist(): AllowlistEntry[] {
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}${ALLOWLIST_STORAGE_KEY}`);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as AllowlistEntry[];
  } catch {
    return [];
  }
}

export function writeAllowlist(entries: AllowlistEntry[]): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${ALLOWLIST_STORAGE_KEY}`, JSON.stringify(entries));
  } catch {
    // localStorage unavailable
  }
}

// ── Helpers ──

let nextId = Date.now();
function generateId(): string {
  nextId += 1;
  return `allowlist-${nextId}`;
}

/**
 * Export allowlist entries to the flat string array format used by
 * execution target `workspace_allowlist` (just the directory paths).
 */
export function exportAllowlistPaths(entries: AllowlistEntry[]): string[] {
  return entries
    .filter((e) => e.path.trim().length > 0)
    .map((e) => e.path.trim());
}

/**
 * Merge a flat string array of allowlist paths (from execution target)
 * into AllowlistEntry objects, preserving existing entries that match.
 */
export function mergeAllowlistFromTarget(
  existing: AllowlistEntry[],
  targetPaths: string[],
): AllowlistEntry[] {
  const existingPaths = new Set(existing.map((e) => e.path.trim().toLowerCase()));
  const merged = [...existing];
  for (const p of targetPaths) {
    const trimmed = p.trim();
    if (!trimmed || existingPaths.has(trimmed.toLowerCase())) continue;
    merged.push({
      id: generateId(),
      path: trimmed,
      globs: ['**/*'],
      trustLevel: 'local' as ExecutionTargetTrustLevel,
      permissions: { read_file: true, write_file: false, execute_command: false },
    });
    existingPaths.add(trimmed.toLowerCase());
  }
  return merged;
}

const TRUST_LEVELS: ExecutionTargetTrustLevel[] = ['local', 'remote', 'cloud', 'relay'];

const TOOL_LABELS: Record<keyof AllowlistEntryToolPermissions, string> = {
  read_file: 'Read File',
  write_file: 'Write File',
  execute_command: 'Execute Cmd',
};

const TOOL_ICONS: Record<keyof AllowlistEntryToolPermissions, React.ReactNode> = {
  read_file: <FileText size={13} />,
  write_file: <FileText size={13} />,
  execute_command: <Terminal size={13} />,
};

// ── Component ──

interface AllowlistEditorProps {
  entries: AllowlistEntry[];
  onEntriesChange: (entries: AllowlistEntry[]) => void;
}

export {};

export default function AllowlistEditor({ entries, onEntriesChange }: AllowlistEditorProps) {
  const { t } = useTranslation();

  // ── Test path state ──
  const [testPath, setTestPath] = useState('');
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const [testChecking, setTestChecking] = useState(false);

  const runValidation = useCallback(async () => {
    const path = testPath.trim();
    if (!path) return;
    setTestChecking(true);
    try {
      const tauriEntries: TauriAllowlistEntry[] = entries.map((e) => ({
        path: e.path,
        globs: e.globs,
        trustLevel: e.trustLevel,
      }));
      const result = await validateAllowlistPath(path, tauriEntries);
      setTestResult(result);
    } catch {
      setTestResult(null);
    } finally {
      setTestChecking(false);
    }
  }, [testPath, entries]);

  const handleTestPathKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        void runValidation();
      }
    },
    [runValidation],
  );

  const addEntry = useCallback(() => {
    const newEntry: AllowlistEntry = {
      id: generateId(),
      path: '',
      globs: ['**/*'],
      trustLevel: 'local',
      permissions: {
        read_file: true,
        write_file: false,
        execute_command: false,
      },
    };
    const updated = [...entries, newEntry];
    onEntriesChange(updated);
    writeAllowlist(updated);
  }, [entries, onEntriesChange]);

  const removeEntry = useCallback(
    (id: string) => {
      const updated = entries.filter((e) => e.id !== id);
      onEntriesChange(updated);
      writeAllowlist(updated);
    },
    [entries, onEntriesChange],
  );

  const updateEntry = useCallback(
    (id: string, patch: Partial<AllowlistEntry>) => {
      const updated = entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
      onEntriesChange(updated);
      writeAllowlist(updated);
    },
    [entries, onEntriesChange],
  );

  const updatePermission = useCallback(
    (id: string, perm: keyof AllowlistEntryToolPermissions, value: boolean) => {
      const updated = entries.map((e) =>
        e.id === id ? { ...e, permissions: { ...e.permissions, [perm]: value } } : e,
      );
      onEntriesChange(updated);
      writeAllowlist(updated);
    },
    [entries, onEntriesChange],
  );

  const addGlob = useCallback(
    (id: string) => {
      const entry = entries.find((e) => e.id === id);
      if (!entry) return;
      updateEntry(id, { globs: [...entry.globs, '**/*'] });
    },
    [entries, updateEntry],
  );

  const removeGlob = useCallback(
    (id: string, index: number) => {
      const entry = entries.find((e) => e.id === id);
      if (!entry) return;
      const globs = entry.globs.filter((_, i) => i !== index);
      updateEntry(id, { globs: globs.length > 0 ? globs : ['**/*'] });
    },
    [entries, updateEntry],
  );

  const updateGlob = useCallback(
    (id: string, index: number, value: string) => {
      const entry = entries.find((e) => e.id === id);
      if (!entry) return;
      const globs = [...entry.globs];
      globs[index] = value;
      updateEntry(id, { globs });
    },
    [entries, updateEntry],
  );

  return (
    <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className={styles.taskSectionHeader}>
        <strong>{t('settings.allowlistTitle', 'Workspace Allowlist')}</strong>
        <span>{t('settings.allowlistDesc', 'Pre-approved directories, file patterns, and tool permissions.')}</span>
      </div>

      {entries.length === 0 && (
        <div className={styles.emptyBlock} style={{ minHeight: 100 }}>
          <strong>{t('settings.allowlistEmpty', 'No allowlist entries')}</strong>
          <span>{t('settings.allowlistEmptyDesc', 'Add directories to pre-approve file access for agents.')}</span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {entries.map((entry) => (
          <AllowlistEntryRow
            key={entry.id}
            entry={entry}
            onUpdate={(patch) => updateEntry(entry.id, patch)}
            onRemove={() => removeEntry(entry.id)}
            onPermissionChange={(perm, value) => updatePermission(entry.id, perm, value)}
            onAddGlob={() => addGlob(entry.id)}
            onRemoveGlob={(index) => removeGlob(entry.id, index)}
            onGlobChange={(index, value) => updateGlob(entry.id, index, value)}
          />
        ))}
      </div>

      {/* Test Path Validation */}
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Search size={14} style={{ color: 'var(--settings-muted)', flexShrink: 0 }} />
          <span style={{ color: 'var(--settings-muted)', fontSize: 12, fontWeight: 700 }}>
            {t('settings.allowlistTestPath', 'Test Path')}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            className={styles.textInput}
            value={testPath}
            onChange={(e) => {
              setTestPath(e.target.value);
              if (testResult !== null) setTestResult(null);
            }}
            onKeyDown={handleTestPathKeyDown}
            placeholder={t('settings.allowlistTestPathPlaceholder', '/absolute/path/to/file.ts')}
            style={{ flex: 1, minWidth: 0 }}
          />
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => { void runValidation(); }}
            disabled={testChecking || !testPath.trim()}
            style={{ minWidth: 'auto', padding: '0 14px', height: 34 }}
          >
            <Search size={14} />
          </button>
        </div>
        {testResult !== null && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              background: testResult
                ? 'rgba(34, 197, 94, 0.12)'
                : 'rgba(239, 68, 68, 0.12)',
              color: testResult ? '#22c55e' : '#ef4444',
            }}
          >
            {testResult ? (
              <>
                <ShieldCheck size={15} />
                <span>{t('settings.allowlistTestPathAllowed', 'Allowed')}</span>
                <span style={{ fontWeight: 400, opacity: 0.7, fontSize: 12 }}>
                  {t('settings.allowlistTestPathDesc', 'Path passes allowlist rules.')}
                </span>
              </>
            ) : (
              <>
                <ShieldX size={15} />
                <span>{t('settings.allowlistTestPathDenied', 'Denied')}</span>
                <span style={{ fontWeight: 400, opacity: 0.7, fontSize: 12 }}>
                  {t('settings.allowlistTestPathDesc', 'No matching allowlist rule found.')}
                </span>
              </>
            )}
          </div>
        )}
        {testResult === null && testPath.trim() === '' && (
          <span style={{ fontSize: 12, color: 'var(--settings-muted)' }}>
            {t('settings.allowlistTestPathEmpty', 'Enter a file path and click the check button to validate against the allowlist.')}
          </span>
        )}
      </div>

      <button type="button" className={styles.secondaryBtn} onClick={addEntry} style={{ alignSelf: 'flex-start' }}>
        <Plus size={15} />
        {t('settings.allowlistAdd', 'Add Directory')}
      </button>
    </div>
  );
}

// ── Row component ──

function AllowlistEntryRow({
  entry,
  onUpdate,
  onRemove,
  onPermissionChange,
  onAddGlob,
  onRemoveGlob,
  onGlobChange,
}: {
  entry: AllowlistEntry;
  onUpdate: (patch: Partial<AllowlistEntry>) => void;
  onRemove: () => void;
  onPermissionChange: (perm: keyof AllowlistEntryToolPermissions, value: boolean) => void;
  onAddGlob: () => void;
  onRemoveGlob: (index: number) => void;
  onGlobChange: (index: number, value: string) => void;
}) {
  const { t } = useTranslation();
  const [pathDraft, setPathDraft] = useState(entry.path);

  const handlePathCommit = useCallback(() => {
    const trimmed = pathDraft.trim();
    onUpdate({ path: trimmed });
  }, [pathDraft, onUpdate]);

  const handlePathKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handlePathCommit();
      }
    },
    [handlePathCommit],
  );

  const isValid = entry.path.trim().length > 0;

  return (
    <div
      className={styles.settingRow}
      style={{
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 14,
        padding: '16px 18px',
        minHeight: 'auto',
      }}
    >
      {/* Header: path + remove */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <FolderOpen size={17} style={{ flexShrink: 0, color: 'var(--settings-muted)' }} />
        <div style={{ display: 'flex', flex: 1, minWidth: 0, gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            className={styles.textInput}
            value={pathDraft}
            onChange={(e) => setPathDraft(e.target.value)}
            onBlur={handlePathCommit}
            onKeyDown={handlePathKeyDown}
            placeholder={t('settings.allowlistPathPlaceholder', '/absolute/path/to/directory')}
            style={{ flex: 1, minWidth: 0 }}
          />
          {isValid && (
            <span
              className={styles.statusPill}
              style={{
                minWidth: 'auto',
                background: 'rgba(34, 197, 94, 0.14)',
                color: '#69c967',
              }}
            >
              <Check size={12} />
            </span>
          )}
        </div>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={onRemove}
          style={{ minWidth: 'auto', padding: '0 8px', height: 30 }}
          title={t('settings.allowlistRemove', 'Remove')}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Trust level */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ color: 'var(--settings-muted)', fontSize: 12, fontWeight: 700, minWidth: 72 }}>
          {t('settings.allowlistTrustLevel', 'Trust Level')}
        </span>
        <select
          className={styles.select}
          value={entry.trustLevel}
          onChange={(e) => onUpdate({ trustLevel: e.target.value as ExecutionTargetTrustLevel })}
          style={{ minWidth: 140, height: 32 }}
        >
          {TRUST_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* Glob patterns */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ color: 'var(--settings-muted)', fontSize: 12, fontWeight: 700 }}>
            {t('settings.allowlistFilePatterns', 'File Patterns (glob)')}
          </span>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={onAddGlob}
            style={{ minWidth: 'auto', padding: '0 8px', height: 28, fontSize: 12 }}
          >
            <Plus size={13} />
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {entry.globs.map((glob, index) => (
            <div
              key={`${entry.id}-glob-${index}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 6px 3px 10px',
                border: '1px solid var(--settings-chip-border)',
                borderRadius: 7,
                background: 'var(--settings-chip-bg)',
              }}
            >
              <input
                type="text"
                className={styles.textInput}
                value={glob}
                onChange={(e) => onGlobChange(index, e.target.value)}
                style={{
                  minHeight: 'auto',
                  height: 24,
                  padding: '2px 4px',
                  fontSize: 12,
                  border: '1px solid transparent',
                  background: 'transparent',
                  width: entry.globs.length === 1 ? 180 : 140,
                }}
              />
              <button
                type="button"
                onClick={() => onRemoveGlob(index)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 20,
                  height: 20,
                  border: 0,
                  borderRadius: 4,
                  background: 'transparent',
                  color: 'var(--settings-muted)',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
                title={t('settings.allowlistRemovePattern', 'Remove pattern')}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Tool permissions matrix */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ color: 'var(--settings-muted)', fontSize: 12, fontWeight: 700 }}>
          {t('settings.allowlistToolPermissions', 'Tool Permissions')}
        </span>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {(Object.keys(TOOL_LABELS) as Array<keyof AllowlistEntryToolPermissions>).map((perm) => (
            <label
              key={perm}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                cursor: 'pointer',
                color: 'var(--foreground)',
                fontSize: 13,
                fontWeight: 600,
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                checked={entry.permissions[perm]}
                onChange={(e) => onPermissionChange(perm, e.target.checked)}
                style={{ accentColor: 'var(--settings-accent)' }}
              />
              {TOOL_ICONS[perm]}
              <span>{TOOL_LABELS[perm]}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
