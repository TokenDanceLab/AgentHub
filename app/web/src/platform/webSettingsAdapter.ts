/**
 * Web SettingsPort: reads/writes via Hub Server (primary),
 * with localStorage fallback when Hub is unavailable.
 *
 * Three-tier fallback pattern (web variant):
 *   1. Hub API (primary backend) - /client/settings
 *   2. localStorage (offline fallback)
 *
 * Note: Desktop has an additional Edge tier, but web connects
 * directly through Hub only.
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
    // localStorage unavailable (SSR, sandbox, private browsing)
  }
  return result;
}

function lsWrite(values: Record<string, string>): void {
  try {
    for (const [key, value] of Object.entries(values)) {
      localStorage.setItem(LS_PREFIX + key, value);
    }
  } catch {
    // ignore write failures (quota exceeded, private browsing, etc.)
  }
}

export function createWebSettingsAdapter(): SettingsPort {
  return {
    async readSettings(): Promise<Record<string, string>> {
      // Tier 1: Hub API (primary backend)
      try {
        const token = getAccessToken();
        if (token) {
          const hub = createHubClient({ getToken: getAccessToken });
          const settings = await hub.fetchSettings();
          // Persist to localStorage as cache for offline access
          lsWrite(settings);
          return settings;
        }
      } catch {
        // Hub unavailable or not authenticated
      }

      // Tier 2: localStorage (offline fallback)
      return lsRead();
    },

    async writeSettings(values: Record<string, string>): Promise<void> {
      // 1. Write to localStorage immediately (fast local read)
      lsWrite(values);

      // 2. Write to Hub API (primary backend, fire-and-forget)
      try {
        const token = getAccessToken();
        if (token) {
          const hub = createHubClient({ getToken: getAccessToken });
          await hub.patchSettings(values);
        }
      } catch {
        // Hub write failed - localStorage still has the values
        // Next successful read will sync from Hub
      }
    },
  };
}
