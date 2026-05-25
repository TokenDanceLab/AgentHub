import { useQuery } from '@tanstack/react-query';
import { fetchAgents } from './edgeClient';
import type { AgentInfo, ListResponse } from '@shared/types';

export function useAgentList(enabled: boolean) {
  return useQuery<ListResponse<AgentInfo>>({
    queryKey: ['agents'],
    queryFn: fetchAgents,
    refetchInterval: 10_000,
    enabled,
    placeholderData: (prev) => prev,
  });
}
