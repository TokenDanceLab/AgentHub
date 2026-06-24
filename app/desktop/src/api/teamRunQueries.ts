import { useQueries, useQuery } from '@tanstack/react-query';
import {
  createHubClient,
  type AgentTeam,
  type AgentTeamEvent,
  type AgentTeamRun,
  type TeamRunState,
} from './hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import { hubQueryKeys } from '@shared/stores/queryKeys';

const hubClient = createHubClient({ getToken: getAccessToken });

type HubListResponse<T> = T[] | { items: T[] } | null | undefined;

function listItems<T>(value: HubListResponse<T> | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value?.items ?? [];
}

export function useAgentTeams(enabled: boolean) {
  return useQuery<AgentTeam[]>({
    queryKey: hubQueryKeys.agentTeams.root,
    queryFn: async () => listItems(await hubClient.listAgentTeams()),
    enabled,
    staleTime: 15_000,
    refetchInterval: enabled ? 30_000 : false,
    placeholderData: (prev) => prev,
  });
}

export function useTeamRuns(teamId: string | null | undefined, enabled: boolean) {
  return useQuery<AgentTeamRun[]>({
    queryKey: hubQueryKeys.agentTeams.runs(teamId ?? ''),
    queryFn: async () => listItems(await hubClient.listTeamRuns(teamId ?? '')),
    enabled: enabled && Boolean(teamId),
    staleTime: 10_000,
    refetchInterval: enabled && teamId ? 15_000 : false,
    placeholderData: (prev) => prev,
  });
}

export function useTeamRunsForTeams(teamIds: string[], enabled: boolean) {
  const queries = useQueries({
    queries: teamIds.map((teamId) => ({
      queryKey: hubQueryKeys.agentTeams.runs(teamId ?? ''),
      queryFn: async () => listItems(await hubClient.listTeamRuns(teamId)),
      enabled: enabled && Boolean(teamId),
      staleTime: 10_000,
      refetchInterval: enabled ? 15_000 : (false as const),
      placeholderData: (prev: AgentTeamRun[] | undefined) => prev,
    })),
  });

  return queries.map((query, index) => ({
    teamId: teamIds[index] ?? '',
    runs: query.data ?? [],
    isFetching: query.isFetching,
    error: query.error,
  }));
}

export function useTeamRunState(
  teamId: string | null | undefined,
  runId: string | null | undefined,
  enabled: boolean,
) {
  return useQuery<TeamRunState>({
    queryKey: hubQueryKeys.agentTeams.runState(teamId ?? '', runId ?? ''),
    queryFn: () => hubClient.getTeamRunState(teamId ?? '', runId ?? ''),
    enabled: enabled && Boolean(teamId) && Boolean(runId),
    staleTime: 5_000,
    refetchInterval: enabled && teamId && runId ? 8_000 : false,
    placeholderData: (prev) => prev,
  });
}

export function useTeamEvents(
  teamId: string | null | undefined,
  runId: string | null | undefined,
  enabled: boolean,
) {
  return useQuery<AgentTeamEvent[]>({
    queryKey: hubQueryKeys.agentTeams.runEvents(teamId ?? '', runId ?? ''),
    queryFn: async () => listItems(await hubClient.listTeamEvents(teamId ?? '', runId ?? '')),
    enabled: enabled && Boolean(teamId) && Boolean(runId),
    staleTime: 10_000,
    refetchInterval: enabled && teamId && runId ? 15_000 : false,
    placeholderData: (prev) => prev,
  });
}
