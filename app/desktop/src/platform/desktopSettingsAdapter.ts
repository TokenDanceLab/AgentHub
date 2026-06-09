/**
 * Desktop SettingsPort: reads/writes via Edge Server (primary),
 * with localStorage fallback and async Hub sync.
 */

import type { SettingsPort } from '@shared/platform/types';
import * as edgeClient from '@/api/edgeClient';
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

export function createDesktopSettingsAdapter(): SettingsPort {
  return {
    async readSettings(): Promise<Record<string, string>> {
      try {
        const settings = await edgeClient.fetchSettings();
        // Cache to localStorage for offline fallback
        lsWrite(settings);
        return settings;
      } catch {
        // Edge unavailable — fall back to localStorage
        return lsRead();
      }
    },

    async writeSettings(values: Record<string, string>): Promise<void> {
      // 1. Write to localStorage immediately (fast local read)
      lsWrite(values);

      // 2. Write to Edge (primary backend)
      try {
        await edgeClient.patchSettings(values);
      } catch {
        // Edge write failed — localStorage is the source of truth for now
      }

      // 3. Async Hub sync (fire-and-forget, no await)
      try {
        const hub = createHubClient({ getToken: getAccessToken });
        hub.patchSettings(values).catch(() => {
          // Hub sync failure is non-critical
        });
      } catch {
        // Hub client not available
      }
    },
  };
}
