// TanStack Query hook for agents — replaces useAgents() setInterval polling.
import { useQuery } from '@tanstack/react-query';
import { fetchAgents } from './edgeClient';
import { AgentInfoSchema, safeParse, listResponseSchema } from './schemas';
import type { AgentInfo, ListResponse } from '@shared/types';

export function useAgentList(enabled: boolean) {
  return useQuery<ListResponse<AgentInfo>>({
    queryKey: ['agents'],
    queryFn: async () => {
      const raw = await fetchAgents();
      return safeParse(listResponseSchema(AgentInfoSchema), raw, 'agents');
    },
    refetchInterval: 10_000,
    enabled,
    placeholderData: (prev) => prev,
  });
}
