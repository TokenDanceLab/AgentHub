// Health hook. Reports browser Hub runtime availability.
// Stub data — no real HTTP health endpoint exists for Web yet.

import { useState, useEffect } from 'react';
import type { HealthResponse } from '@shared/types';
import { useHubStore } from '@/stores/hubStore';

export interface HealthState {
  online: boolean;
  health: HealthResponse | null;
}

export function useHealth(): HealthState {
  const [online, setOnline] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const hubAuthenticated = useHubStore((s) => s.authenticated);

  useEffect(() => {
    if (!hubAuthenticated) {
      setOnline(false);
      setHealth(null);
      return;
    }
    setHealth({
      status: 'hub-only',
      version: 'web-preview',
      edgeId: 'web-hub-only',
      checks: {
        executor: { status: 'stubbed' },
        runners: { status: 'stubbed', total: 0, available: 0, items: [] },
      },
    });
    setOnline(true);
  }, [hubAuthenticated]);

  return { online, health };
}
