/**
 * Settings service: a minimal external store that reads/writes user settings
 * through a platform-specific SettingsPort adapter.
 *
 * Usage:
 *   const svc = createSettingsService(platform.settings, defaults);
 *   svc.init();                              // async load from backend
 *   const snapshot = svc.readAll();          // synchronous read (memory cache)
 *   svc.write('theme', 'dark');              // write to backend + update cache
 *   const unsub = svc.subscribe(listener);   // react to changes
 */

import { deserializeSettings, serializeSettings } from './settingsTypes';
import type { SettingsPort } from '@shared/platform/types';

// Re-export for convenience
export type { SettingsPort };

export type SettingsServiceErrorKind = 'init' | 'write';

// ── Service ─────────────────────────────────────────────────────────────────

export interface SettingsService {
  /** Load settings from the backend (call once on mount; safe to re-call for retry). */
  init(): Promise<void>;
  /** Read the current in-memory snapshot. */
  readAll(): Record<string, unknown>;
  /** Write a single setting key. Updates memory immediately, persists async. */
  write(key: string, value: unknown): void;
  /** Write multiple settings at once. */
  writeBatch(values: Record<string, unknown>): void;
  /** Subscribe to changes. Returns unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Clear the last load/write error notice without mutating values. */
  clearError(): void;
  /** Whether the initial load has completed (success or failure). */
  readonly initialized: boolean;
  /** Whether an init request is currently in flight. */
  readonly loading: boolean;
  /** Last load/write error message, or null when healthy. */
  readonly error: string | null;
  /** Whether the last error came from init or write. */
  readonly errorKind: SettingsServiceErrorKind | null;
}

function settingsErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
}

export function createSettingsService(
  port: SettingsPort,
  defaults: Record<string, unknown>,
): SettingsService {
  let snapshot: Record<string, unknown> = { ...defaults };
  let ready = false;
  let loading = false;
  let error: string | null = null;
  let errorKind: SettingsServiceErrorKind | null = null;
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const fn of listeners) fn();
  }

  function setError(kind: SettingsServiceErrorKind, err: unknown, fallback: string): void {
    error = settingsErrorMessage(err, fallback);
    errorKind = kind;
  }

  function clearErrorState(): void {
    error = null;
    errorKind = null;
  }

  return {
    get initialized(): boolean {
      return ready;
    },

    get loading(): boolean {
      return loading;
    },

    get error(): string | null {
      return error;
    },

    get errorKind(): SettingsServiceErrorKind | null {
      return errorKind;
    },

    clearError(): void {
      if (error === null && errorKind === null) return;
      clearErrorState();
      emit();
    },

    async init(): Promise<void> {
      loading = true;
      clearErrorState();
      emit();

      try {
        const raw = await port.readSettings();
        const remote = deserializeSettings(raw);
        // Remote values override defaults; defaults fill in missing keys.
        snapshot = { ...defaults, ...remote };
        ready = true;
        loading = false;
        clearErrorState();
        emit();
      } catch (err) {
        // Backend unreachable — keep defaults, still mark as initialized
        // so the UI can render RecoveryPanel instead of hanging.
        console.error('settingsService.init failed:', err);
        ready = true;
        loading = false;
        setError('init', err, '设置加载失败');
        emit();
      }
    },

    readAll(): Record<string, unknown> {
      return snapshot;
    },

    write(key: string, value: unknown): void {
      const prev = snapshot[key];
      snapshot = { ...snapshot, [key]: value };
      emit();

      // Persist async — fire and forget
      const patch: Record<string, string> = {};
      const serialized = serializeSettings({ [key]: value });
      Object.assign(patch, serialized);

      port.writeSettings(patch).then(() => {
        if (errorKind === 'write') {
          clearErrorState();
          emit();
        }
      }).catch((err) => {
        // Roll back on failure
        console.error('settingsService.write failed for key:', key, err);
        snapshot = { ...snapshot, [key]: prev };
        setError('write', err, '设置保存失败');
        emit();
      });
    },

    writeBatch(values: Record<string, unknown>): void {
      const prev = { ...snapshot };
      snapshot = { ...snapshot, ...values };
      emit();

      const patch = serializeSettings(values);
      port.writeSettings(patch).then(() => {
        if (errorKind === 'write') {
          clearErrorState();
          emit();
        }
      }).catch((err) => {
        console.error('settingsService.writeBatch failed:', err);
        snapshot = prev;
        setError('write', err, '设置保存失败');
        emit();
      });
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
