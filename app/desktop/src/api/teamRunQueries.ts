import { useQueries, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createHubClient,
  type AgentTeam,
  type AgentTeamEvent,
  type AgentTeamRun,
  type AgentTeamMember,
  type HubListResponse,
  type TeamRunState,
} from './hubClient';
import { getAccessToken } from '@/hooks/useAuth';

const hubClient = createHubClient({ getToken: getAccessToken });

function listItems<T>(value: HubListResponse<T> | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value?.items ?? [];
}

export function useAgentTeams(enabled: boolean) {
  return useQuery<AgentTeam[]>({
    queryKey: ['hub', 'agent-teams'],
    queryFn: async () => listItems(await hubClient.listAgentTeams()),
    enabled,
    staleTime: 15_000,
    refetchInterval: enabled ? 30_000 : false,
    placeholderData: (prev) => prev,
  });
}

export function useTeamRuns(teamId: string | null | undefined, enabled: boolean) {
  return useQuery<AgentTeamRun[]>({
    queryKey: ['hub', 'agent-teams', teamId, 'runs'],
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
      queryKey: ['hub', 'agent-teams', teamId, 'runs'],
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
    queryKey: ['hub', 'agent-teams', teamId, 'runs', runId, 'state'],
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
    queryKey: ['hub', 'agent-teams', teamId, 'runs', runId, 'events'],
    queryFn: async () => listItems(await hubClient.listTeamEvents(teamId ?? '', runId ?? '')),
    enabled: enabled && Boolean(teamId) && Boolean(runId),
    staleTime: 10_000,
    refetchInterval: enabled && teamId && runId ? 15_000 : false,
    placeholderData: (prev) => prev,
  });
}

// ── AgentTeam CRUD mutations ──────────────────────────────────────

export function useCreateAgentTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      hubClient.createAgentTeam(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hub', 'agent-teams'] });
    },
  });
}

export function useUpdateAgentTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, data }: { teamId: string; data: { name?: string; description?: string } }) =>
      hubClient.updateAgentTeam(teamId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hub', 'agent-teams'] });
    },
  });
}

export function useDeleteAgentTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (teamId: string) => hubClient.deleteAgentTeam(teamId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hub', 'agent-teams'] });
    },
  });
}

export function useAddTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, data }: { teamId: string; data: { agent_profile_id: string; role?: string } }) =>
      hubClient.addTeamMember(teamId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hub', 'agent-teams'] });
    },
  });
}

export function useRemoveTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, memberId }: { teamId: string; memberId: string }) =>
      hubClient.removeTeamMember(teamId, memberId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hub', 'agent-teams'] });
    },
  });
}

// ── TeamRun interactive mutations ─────────────────────────────────

export function useStartTeamRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, data }: { teamId: string; data: { trigger_message: string } }) =>
      hubClient.startTeamRun(teamId, data),
    onSuccess: (_data, { teamId }) => {
      qc.invalidateQueries({ queryKey: ['hub', 'agent-teams', teamId, 'runs'] });
    },
  });
}

export function useDecideApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      teamId, runId, approvalId, data,
    }: {
      teamId: string; runId: string; approvalId: string;
      data: { decision: 'allow' | 'deny'; reason?: string };
    }) => hubClient.decideTeamApproval(teamId, runId, approvalId, data),
    onSuccess: (_data, { teamId, runId }) => {
      qc.invalidateQueries({ queryKey: ['hub', 'agent-teams', teamId, 'runs', runId, 'state'] });
    },
  });
}

export function useResolveConflict() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      teamId, runId, conflictId, data,
    }: {
      teamId: string; runId: string; conflictId: string;
      data: { resolution: string; selected_agent_task_id?: string; reason?: string };
    }) => hubClient.resolveTeamConflict(teamId, runId, conflictId, data),
    onSuccess: (_data, { teamId, runId }) => {
      qc.invalidateQueries({ queryKey: ['hub', 'agent-teams', teamId, 'runs', runId, 'state'] });
    },
  });
}

export function useCreateAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      teamId, runId, data,
    }: {
      teamId: string; runId: string;
      data: { from_member_id: string; to_member_id: string; task_prompt: string; type?: string; context?: string };
    }) => hubClient.createTeamAssignment(teamId, runId, data),
    onSuccess: (_data, { teamId, runId }) => {
      qc.invalidateQueries({ queryKey: ['hub', 'agent-teams', teamId, 'runs', runId, 'state'] });
    },
  });
}
