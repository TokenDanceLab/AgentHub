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
    queueMicrotask(() => {
      void poll();
    });
    const id = setInterval(poll, HEALTH_POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [poll]);

  return { online, health, lastError, refetch: poll };
}
