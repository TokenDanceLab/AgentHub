import { useEffect, useState } from 'react';
import type { Runner } from '@shared/types';
import type { EdgeClient } from '@/api/edgeClient';
import { edgeClient } from '@/api/edgeClient';
import { RUNNERS_POLL_MS } from '@/config';

export function useRunners(online: boolean, client: EdgeClient = edgeClient): Runner[] {
  const [runners, setRunners] = useState<Runner[]>([]);

  useEffect(() => {
    let cancelled = false;

    if (!online) {
      setRunners([]);
      return;
    }

    async function load() {
      try {
        const result = await client.fetchRunners();
        if (!cancelled) setRunners(result.items);
      } catch {
        if (!cancelled) setRunners([]);
      }
    }

    load();
    const timer = setInterval(load, RUNNERS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [client, online]);

  return runners;
}
