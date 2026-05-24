// Registers the Desktop device with the Hub server on startup.
// Persists a stable deviceId in localStorage so the Hub can
// route agent tasks to the same device across restarts.
// Non-critical — errors are silently ignored.

import { useEffect, useRef } from 'react';
import { APP_VERSION } from '@/config';
import type { HubClient } from '@/api/hubClient';
import { getOrCreateDeviceId } from '@/api/deviceId';

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
