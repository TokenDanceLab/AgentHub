/**
 * Web SettingsPort: reads/writes via Hub Server (primary),
 * with localStorage fallback for offline or unauthenticated use.
 */

import type { SettingsPort } from '@shared/platform/types';
import { createHubClient } from '@/api/hubClient';
import { getAccessToken } from '@/hooks/useAuth';

const LS_PREFIX = 'agenthub.settings.';

function lsRead(): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LS_PREFIX)) {
        result[key.slice(LS_PREFIX.length)] = localStorage.getItem(key) ?? '';
      }
    }
  } catch {
    // localStorage unavailable (SSR, sandbox)
  }
  return result;
}

function lsWrite(values: Record<string, string>): void {
  try {
    for (const [key, value] of Object.entries(values)) {
      localStorage.setItem(LS_PREFIX + key, value);
    }
  } catch {
    // ignore
  }
}

export function createWebSettingsAdapter(): SettingsPort {
  return {
    async readSettings(): Promise<Record<string, string>> {
      const token = getAccessToken();
      if (!token) {
        // Not authenticated — read from localStorage
        return lsRead();
      }
      try {
        const hub = createHubClient({ getToken: getAccessToken });
        const settings = await hub.fetchSettings();
        // Cache for offline fallback
        lsWrite(settings);
        return settings;
      } catch {
        return lsRead();
      }
    },

    async writeSettings(values: Record<string, string>): Promise<void> {
      // 1. Write to localStorage immediately
      lsWrite(values);

      // 2. Write to Hub if authenticated
      const token = getAccessToken();
      if (!token) return;

      try {
        const hub = createHubClient({ getToken: getAccessToken });
        await hub.patchSettings(values);
      } catch {
        // Hub write failed — localStorage is the source of truth
      }
    },
  };
}
