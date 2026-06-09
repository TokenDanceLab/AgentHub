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
      // Tier 1: Edge (primary backend)
      try {
        const settings = await edgeClient.fetchSettings();
        lsWrite(settings);
        return settings;
      } catch {
        // Edge unavailable
      }

      // Tier 2: Hub (secondary backend)
      try {
        const token = getAccessToken();
        if (token) {
          const hub = createHubClient({ getToken: getAccessToken });
          const settings = await hub.fetchSettings();
          lsWrite(settings);
          return settings;
        }
      } catch {
        // Hub unavailable
      }

      // Tier 3: localStorage (offline fallback)
      return lsRead();
    },

    async writeSettings(values: Record<string, string>): Promise<void> {
      // 1. Write to localStorage immediately (fast local read)
      lsWrite(values);

      // 2. Write to Edge (primary backend)
      try {
        await edgeClient.patchSettings(values);
      } catch {
        // Edge write failed — try Hub as fallback
      }

      // 3. Async Hub sync (fire-and-forget)
      try {
        const token = getAccessToken();
        if (token) {
          const hub = createHubClient({ getToken: getAccessToken });
          hub.patchSettings(values).catch(() => {});
        }
      } catch {
        // Hub client not available
      }
    },
  };
}
