// Health polling hook. Periodically checks Edge availability.

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchHealth } from '@/api/edgeClient';
import type { HealthResponse } from '@shared/types';
import { HEALTH_POLL_MS } from '@/config';

export interface HealthState {
  online: boolean;
  health: HealthResponse | null;
  lastError: string | null;
  refetch: () => void;
}

export function useHealth(): HealthState {
  const [online, setOnline] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const poll = useCallback(async () => {
    try {
      const h = await fetchHealth();
      if (!mountedRef.current) return;
      setHealth(h);
      setOnline(true);
      setLastError(null);
    } catch (error) {
      if (!mountedRef.current) return;
      setOnline(false);
      setHealth(null);
      setLastError(error instanceof Error ? error.message : 'Local Edge health check failed');
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    let interval = setInterval(poll, HEALTH_POLL_MS);
    queueMicrotask(() => {
      void poll();
    });

    const onVisibility = () => {
      if (document.hidden) {
        clearInterval(interval);
      } else {
        clearInterval(interval);
        queueMicrotask(() => {
          void poll();
        });
        interval = setInterval(poll, HEALTH_POLL_MS);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [poll]);

  return { online, health, lastError, refetch: poll };
}
