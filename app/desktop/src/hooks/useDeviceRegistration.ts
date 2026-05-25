// Registers the Desktop device with the Hub server on startup.
// Persists a stable deviceId in localStorage so the Hub can
// route agent tasks to the same device across restarts.
// Non-critical: registration status is exposed so Settings can show Hub state.

import { useEffect, useRef, useState } from 'react';
import { APP_VERSION } from '@/config';
import type { HubClient } from '@/api/hubClient';
import { getOrCreateDeviceId } from '@/api/deviceId';

export type DeviceRegistrationStatus = 'idle' | 'registering' | 'registered' | 'error';

export interface DeviceRegistrationState {
  deviceId: string | null;
  status: DeviceRegistrationStatus;
  error: string | null;
}

export function useDeviceRegistration(
  hubClient: HubClient | null,
): DeviceRegistrationState {
  const registeredRef = useRef(false);
  const [state, setState] = useState<DeviceRegistrationState>({
    deviceId: null,
    status: 'idle',
    error: null,
  });

  useEffect(() => {
    if (!hubClient) {
      setState((prev) => ({ ...prev, status: 'idle', error: null }));
      return;
    }

    const deviceId = getOrCreateDeviceId();
    if (registeredRef.current) {
      setState({ deviceId, status: 'registered', error: null });
      return;
    }

    let cancelled = false;
    setState({ deviceId, status: 'registering', error: null });
    hubClient
      .registerDevice({
        device_id: deviceId,
        app_version: APP_VERSION,
      })
      .then(() => {
        if (cancelled) return;
        registeredRef.current = true;
        setState({ deviceId, status: 'registered', error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Hub device registration failed';
        setState({ deviceId, status: 'error', error: message });
        // Hub may be unreachable, retry on next mount.
      });

    return () => {
      cancelled = true;
    };
  }, [hubClient]);

  return state;
}
