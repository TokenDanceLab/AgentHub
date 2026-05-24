import { useState, useEffect, useRef } from 'react';
import { fetchAgents } from '@/api/edgeClient';
import type { AgentInfo } from '@shared/types';

/** Polls Edge for agent list every 10s while online. Clears on disconnect. */
export function useAgents(online: boolean) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!online) {
      setAgents([]);
      return;
    }

    let active = true;
    const poll = async () => {
      try {
        const res = await fetchAgents();
        if (active && mountedRef.current) setAgents(res.items);
      } catch {
        /* Edge may not have /v1/agents yet */
      }
    };

    poll();
    const id = setInterval(poll, 10_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [online]);

  return agents;
}
