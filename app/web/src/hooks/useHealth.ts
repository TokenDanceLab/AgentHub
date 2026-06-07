// Health polling hook. Reports browser Hub runtime availability.

import { useState, useEffect, useCallback, useRef } from 'react';
import type { HealthResponse } from '@shared/types';
import { HEALTH_POLL_MS } from '@/config';
import { useHubStore } from '@/stores/hubStore';

export interface HealthState {
  online: boolean;
  health: HealthResponse | null;
}

export function useHealth(): HealthState {
  const [online, setOnline] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const mountedRef = useRef(true);
  const hubAuthenticated = useHubStore((s) => s.authenticated);

  const poll = useCallback(async () => {
    if (!hubAuthenticated) {
      if (mountedRef.current) {
        setOnline(false);
        setHealth(null);
      }
      return;
    }
    try {
      if (!mountedRef.current) return;
      setHealth({
        status: 'hub-only',
        version: 'web-preview',
        edgeId: 'web-hub-only',
        checks: {
          executor: { status: 'stubbed', message: 'Web connects through Hub.' },
          runners: { status: 'stubbed', message: 'Runtime readiness is reported by Hub Agent Profiles and registered execution targets.', total: 0, available: 0, items: [] },
        },
      });
      setOnline(true);
    } catch {
      if (!mountedRef.current) return;
      setOnline(false);
      setHealth(null);
    }
  }, [hubAuthenticated]);

  useEffect(() => {
    mountedRef.current = true;
    poll();
    const id = setInterval(poll, HEALTH_POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [poll]);

  return { online, health };
}
