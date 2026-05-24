// Runners polling hook. Only fetches when Edge is online.

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchRunners } from '@/api/edgeClient';
import type { Runner } from '@shared/types';
import { RUNNERS_POLL_MS } from '@/config';

export function useRunners(online: boolean): Runner[] {
  const [runners, setRunners] = useState<Runner[]>([]);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    if (!online) return;
    try {
      const res = await fetchRunners();
      if (!mountedRef.current) return;
      setRunners(res.items ?? []);
    } catch {
      // Edge may not have runners ready yet.
    }
  }, [online]);

  useEffect(() => {
    mountedRef.current = true;
    if (!online) {
      setRunners([]);
      return () => {
        mountedRef.current = false;
      };
    }

    load();
    const id = setInterval(load, RUNNERS_POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [online, load]);

  return runners;
}
