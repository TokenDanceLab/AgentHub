// Edge `/v1/runners` diagnostics poller.
// Product health/catalog SSOT is Runtime inventory + Hub Execution Targets.
// Keep this hook for local diagnostics/tests only — do not wire into product status UI.

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchRunners } from '@/api/edgeClient';
import type { Runner } from '@shared/types';
import { RUNNERS_POLL_MS } from '@/config';

/** Local Edge runner diagnostics only. Not product inventory SSOT. */
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
      return () => {
        mountedRef.current = false;
      };
    }

    let interval = setInterval(load, RUNNERS_POLL_MS);
    queueMicrotask(() => {
      void load();
    });

    const onVisibility = () => {
      if (document.hidden) {
        clearInterval(interval);
      } else {
        clearInterval(interval);
        queueMicrotask(() => {
          void load();
        });
        interval = setInterval(load, RUNNERS_POLL_MS);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [online, load]);

  return online ? runners : [];
}
