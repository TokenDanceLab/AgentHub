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
import type { SettingsPort } from '../platform/types';

// Re-export for convenience
export type { SettingsPort };

// ── Service ─────────────────────────────────────────────────────────────────

export interface SettingsService {
  /** Load settings from the backend (call once on mount). */
  init(): Promise<void>;
  /** Read the current in-memory snapshot. */
  readAll(): Record<string, unknown>;
  /** Write a single setting key. Updates memory immediately, persists async. */
  write(key: string, value: unknown): void;
  /** Write multiple settings at once. */
  writeBatch(values: Record<string, unknown>): void;
  /** Subscribe to changes. Returns unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Whether the initial load has completed. */
  readonly initialized: boolean;
}

export function createSettingsService(
  port: SettingsPort,
  defaults: Record<string, unknown>,
): SettingsService {
  let snapshot: Record<string, unknown> = { ...defaults };
  let ready = false;
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const fn of listeners) fn();
  }

  return {
    get initialized(): boolean {
      return ready;
    },

    async init(): Promise<void> {
      try {
        const raw = await port.readSettings();
        const remote = deserializeSettings(raw);
        // Remote values override defaults; defaults fill in missing keys.
        snapshot = { ...defaults, ...remote };
        ready = true;
        emit();
      } catch {
        // Backend unreachable — keep defaults, still mark as initialized
        // so the UI doesn't hang. A retry can be triggered later.
        ready = true;
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

      port.writeSettings(patch).catch(() => {
        // Roll back on failure
        snapshot = { ...snapshot, [key]: prev };
        emit();
      });
    },

    writeBatch(values: Record<string, unknown>): void {
      const prev = { ...snapshot };
      snapshot = { ...snapshot, ...values };
      emit();

      const patch = serializeSettings(values);
      port.writeSettings(patch).catch(() => {
        snapshot = prev;
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
