import { useEffect, useState } from 'react';
import type { HealthResponse } from '@shared/types';
import type { EdgeClient } from '@/api/edgeClient';
import { edgeClient } from '@/api/edgeClient';
import { HEALTH_POLL_MS } from '@/config';

export interface HealthState {
  online: boolean;
  health: HealthResponse | null;
}

export function useHealth(client: EdgeClient = edgeClient): HealthState {
  const [state, setState] = useState<HealthState>({ online: false, health: null });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const health = await client.fetchHealth();
        if (!cancelled) setState({ online: true, health });
      } catch {
        if (!cancelled) setState({ online: false, health: null });
      }
    }

    check();
    const timer = setInterval(check, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [client]);

  return state;
}
