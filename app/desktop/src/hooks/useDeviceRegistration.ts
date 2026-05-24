// Registers the Desktop device with the Hub server on startup.
// Persists a stable deviceId in localStorage so the Hub can
// route agent tasks to the same device across restarts.
// Non-critical — errors are silently ignored.

import { useEffect, useRef } from 'react';
import { APP_VERSION } from '@/config';
import type { HubClient } from '@/api/hubClient';

const DEVICE_ID_KEY = 'agenthub_device_id';

function getOrCreateDeviceId(): string {
  if (typeof localStorage === 'undefined') {
    return crypto.randomUUID();
  }
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

export function useDeviceRegistration(
  hubClient: HubClient | null,
): void {
  const registeredRef = useRef(false);

  useEffect(() => {
    if (!hubClient || registeredRef.current) return;

    const deviceId = getOrCreateDeviceId();

    hubClient
      .registerDevice({
        device_id: deviceId,
        app_version: APP_VERSION,
      })
      .then(() => {
        registeredRef.current = true;
      })
      .catch(() => {
        // Non-critical — Hub may be unreachable, retry on next mount
      });
  }, [hubClient]);
}
