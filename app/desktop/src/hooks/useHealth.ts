// Health polling hook. Periodically checks Edge availability.

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchHealth } from '@/api/edgeClient';
import type { HealthResponse } from '@shared/types';
import { HEALTH_POLL_MS } from '@/config';

interface HealthState {
  online: boolean;
  health: HealthResponse | null;
  lastError: string | null;
  refetch: () => void;
}

interface UseHealthOptions {
  enabled?: boolean;
}

export function useHealth(options: UseHealthOptions = {}): HealthState {
  const enabled = options.enabled ?? true;
  const [online, setOnline] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const poll = useCallback(async () => {
    if (!enabled) return;
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
  }, [enabled]);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) {
      // State reset for the disabled branch happens via the render-time
      // adjustment below; the effect only manages polling lifecycle.
      return () => {
        mountedRef.current = false;
      };
    }

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
  }, [poll, enabled]);

  // Adjust state during render when the enabled flag flips (sanctioned
  // "adjusting state when a prop changes" pattern) so a stale online/health
  // result cannot linger after polling is disabled.
  const [prevEnabled, setPrevEnabled] = useState(enabled);
  if (prevEnabled !== enabled) {
    setPrevEnabled(enabled);
    if (!enabled) {
      setOnline(false);
      setHealth(null);
      setLastError(null);
    }
  }

  return { online, health, lastError, refetch: poll };
}
