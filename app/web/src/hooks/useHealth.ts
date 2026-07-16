// Health hook. Reports browser Hub runtime availability.
// Stub data — no real HTTP health endpoint exists for Web yet.
// Product health SSOT for Web is Hub Execution Target inventory, not Edge runners.

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
        // Connectivity/runtime stubs only. Do not invent runner inventory for product UI.
        executor: { status: 'stubbed' },
        adapters: { status: 'hub-execution-target' },
      },
    });
    setOnline(true);
  }, [hubAuthenticated]);

  return { online, health };
}
