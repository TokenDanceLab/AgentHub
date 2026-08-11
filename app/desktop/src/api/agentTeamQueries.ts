import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAccessToken } from '@/hooks/useAuth';
import { hubQueryKeys } from '@shared/stores/queryKeys';
import { createHubClient } from './hubClient';
import type {
  AddAgentTeamMemberRequest,
  CoordinatorRouteDecision,
  CreateAgentTeamRequest,
  StartAgentTeamRunRequest,
  TeamApprovalDecisionRequest,
  TeamConflictResolutionRequest,
  UpdateAgentTeamRequest,
} from './hubClient';

export function useCreateAgentTeam(options: { getToken?: () => string | null; baseUrl?: string } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateAgentTeamRequest) => {
      const token = (options.getToken ?? getAccessToken)();
      if (!token) throw new Error('Hub session is required');
      const client = createHubClient(
        options.baseUrl ? { baseUrl: options.baseUrl, getToken: () => token } : { getToken: () => token },
      );
      return client.createAgentTeam(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hubQueryKeys.agentTeams.root });
    },
  });
}

export function useAddAgentTeamMember(options: { getToken?: () => string | null; baseUrl?: string } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { teamId: string; member: AddAgentTeamMemberRequest }) => {
      const token = (options.getToken ?? getAccessToken)();
      if (!token) throw new Error('Hub session is required');
      const client = createHubClient(
        options.baseUrl ? { baseUrl: options.baseUrl, getToken: () => token } : { getToken: () => token },
      );
      return client.addAgentTeamMember(input.teamId, input.member);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hubQueryKeys.agentTeams.root });
    },
  });
}

export function useStartTeamRun(options: { getToken?: () => string | null; baseUrl?: string } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { teamId: string; run: StartAgentTeamRunRequest }) => {
      const token = (options.getToken ?? getAccessToken)();
      if (!token) throw new Error('Hub session is required');
      const client = createHubClient(
        options.baseUrl ? { baseUrl: options.baseUrl, getToken: () => token } : { getToken: () => token },
      );
      return client.startTeamRun(input.teamId, input.run);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hubQueryKeys.agentTeams.root });
    },
  });
}

export function useDecideTeamApproval(options: { getToken?: () => string | null; baseUrl?: string } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      teamId: string;
      runId: string;
      approvalId: string;
      decision: TeamApprovalDecisionRequest;
    }) => {
      const token = (options.getToken ?? getAccessToken)();
      if (!token) throw new Error('Hub session is required');
      const client = createHubClient(
        options.baseUrl ? { baseUrl: options.baseUrl, getToken: () => token } : { getToken: () => token },
      );
      return client.decideTeamApproval(input.teamId, input.runId, input.approvalId, input.decision);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hubQueryKeys.agentTeams.root });
    },
  });
}

export function useResolveTeamConflict(options: { getToken?: () => string | null; baseUrl?: string } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      teamId: string;
      runId: string;
      conflictId: string;
      resolution: TeamConflictResolutionRequest;
    }) => {
      const token = (options.getToken ?? getAccessToken)();
      if (!token) throw new Error('Hub session is required');
      const client = createHubClient(
        options.baseUrl ? { baseUrl: options.baseUrl, getToken: () => token } : { getToken: () => token },
      );
      return client.resolveTeamConflict(input.teamId, input.runId, input.conflictId, input.resolution);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hubQueryKeys.agentTeams.root });
    },
  });
}

// ── Update / Delete team ──────────────────────────────────────────

export function useUpdateAgentTeam(options: { getToken?: () => string | null; baseUrl?: string } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { teamId: string; data: UpdateAgentTeamRequest }) => {
      const token = (options.getToken ?? getAccessToken)();
      if (!token) throw new Error('Hub session is required');
      const client = createHubClient(
        options.baseUrl ? { baseUrl: options.baseUrl, getToken: () => token } : { getToken: () => token },
      );
      return client.updateAgentTeam(input.teamId, input.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hubQueryKeys.agentTeams.root });
    },
  });
}

export function useDeleteAgentTeam(options: { getToken?: () => string | null; baseUrl?: string } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (teamId: string) => {
      const token = (options.getToken ?? getAccessToken)();
      if (!token) throw new Error('Hub session is required');
      const client = createHubClient(
        options.baseUrl ? { baseUrl: options.baseUrl, getToken: () => token } : { getToken: () => token },
      );
      return client.deleteAgentTeam(teamId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hubQueryKeys.agentTeams.root });
    },
  });
}

// ── Remove team member ────────────────────────────────────────────

export function useRemoveAgentTeamMember(options: { getToken?: () => string | null; baseUrl?: string } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { teamId: string; memberId: string }) => {
      const token = (options.getToken ?? getAccessToken)();
      if (!token) throw new Error('Hub session is required');
      const client = createHubClient(
        options.baseUrl ? { baseUrl: options.baseUrl, getToken: () => token } : { getToken: () => token },
      );
      return client.removeAgentTeamMember(input.teamId, input.memberId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hubQueryKeys.agentTeams.root });
    },
  });
}

// ── Route decisions ───────────────────────────────────────────────

export function usePostTeamRouteDecision(options: { getToken?: () => string | null; baseUrl?: string } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { teamId: string; runId: string; decision: CoordinatorRouteDecision }) => {
      const token = (options.getToken ?? getAccessToken)();
      if (!token) throw new Error('Hub session is required');
      const client = createHubClient(
        options.baseUrl ? { baseUrl: options.baseUrl, getToken: () => token } : { getToken: () => token },
      );
      return client.postTeamRouteDecision(input.teamId, input.runId, input.decision);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hubQueryKeys.agentTeams.root });
    },
  });
}

// ── Individual queries (on-demand fetching) ───────────────────────

export function useAgentTeamDetail(
  teamId: string | undefined,
  opts?: { enabled?: boolean; getToken?: () => string | null; baseUrl?: string },
) {
  return useQuery({
    queryKey: hubQueryKeys.agentTeams.detail(teamId ?? ''),
    queryFn: async () => {
      const token = (opts?.getToken ?? getAccessToken)();
      if (!token) throw new Error('Hub session is required');
      if (!teamId) throw new Error('Agent team id is required');
      const client = createHubClient(
        opts?.baseUrl ? { baseUrl: opts.baseUrl, getToken: () => token } : { getToken: () => token },
      );
      return client.getAgentTeam(teamId);
    },
    enabled: opts?.enabled ?? !!teamId,
  });
}

export function useTeamRuns(
  teamId: string | undefined,
  opts?: { enabled?: boolean; getToken?: () => string | null; baseUrl?: string },
) {
  return useQuery({
    queryKey: hubQueryKeys.agentTeams.runs(teamId ?? ''),
    queryFn: async () => {
      const token = (opts?.getToken ?? getAccessToken)();
      if (!token) throw new Error('Hub session is required');
      if (!teamId) throw new Error('Agent team id is required');
      const client = createHubClient(
        opts?.baseUrl ? { baseUrl: opts.baseUrl, getToken: () => token } : { getToken: () => token },
      );
      return client.listTeamRuns(teamId);
    },
    enabled: opts?.enabled ?? !!teamId,
  });
}

export function useTeamRun(
  teamId: string | undefined,
  runId: string | undefined,
  opts?: { enabled?: boolean; getToken?: () => string | null; baseUrl?: string },
) {
  return useQuery({
    queryKey: hubQueryKeys.agentTeams.runDetail(teamId ?? '', runId ?? ''),
    queryFn: async () => {
      const token = (opts?.getToken ?? getAccessToken)();
      if (!token) throw new Error('Hub session is required');
      if (!teamId || !runId) throw new Error('Agent team id and run id are required');
      const client = createHubClient(
        opts?.baseUrl ? { baseUrl: opts.baseUrl, getToken: () => token } : { getToken: () => token },
      );
      return client.getTeamRun(teamId, runId);
    },
    enabled: opts?.enabled ?? (!!teamId && !!runId),
  });
}

export function useTeamRunState(
  teamId: string | undefined,
  runId: string | undefined,
  opts?: { enabled?: boolean; getToken?: () => string | null; baseUrl?: string },
) {
  return useQuery({
    queryKey: hubQueryKeys.agentTeams.runState(teamId ?? '', runId ?? ''),
    queryFn: async () => {
      const token = (opts?.getToken ?? getAccessToken)();
      if (!token) throw new Error('Hub session is required');
      if (!teamId || !runId) throw new Error('Agent team id and run id are required');
      const client = createHubClient(
        opts?.baseUrl ? { baseUrl: opts.baseUrl, getToken: () => token } : { getToken: () => token },
      );
      return client.getTeamRunState(teamId, runId);
    },
    enabled: opts?.enabled ?? (!!teamId && !!runId),
  });
}

export function useTeamEvents(
  teamId: string | undefined,
  runId: string | undefined,
  opts?: { enabled?: boolean; getToken?: () => string | null; baseUrl?: string },
) {
  return useQuery({
    queryKey: hubQueryKeys.agentTeams.runEvents(teamId ?? '', runId ?? ''),
    queryFn: async () => {
      const token = (opts?.getToken ?? getAccessToken)();
      if (!token) throw new Error('Hub session is required');
      if (!teamId || !runId) throw new Error('Agent team id and run id are required');
      const client = createHubClient(
        opts?.baseUrl ? { baseUrl: opts.baseUrl, getToken: () => token } : { getToken: () => token },
      );
      return client.listTeamEvents(teamId, runId);
    },
    enabled: opts?.enabled ?? (!!teamId && !!runId),
  });
}

export function useTeamTasks(
  teamId: string | undefined,
  runId: string | undefined,
  opts?: { enabled?: boolean; getToken?: () => string | null; baseUrl?: string },
) {
  return useQuery({
    queryKey: hubQueryKeys.agentTeams.runTasks(teamId ?? '', runId ?? ''),
    queryFn: async () => {
      const token = (opts?.getToken ?? getAccessToken)();
      if (!token) throw new Error('Hub session is required');
      if (!teamId || !runId) throw new Error('Agent team id and run id are required');
      const client = createHubClient(
        opts?.baseUrl ? { baseUrl: opts.baseUrl, getToken: () => token } : { getToken: () => token },
      );
      return client.listTeamTasks(teamId, runId);
    },
    enabled: opts?.enabled ?? (!!teamId && !!runId),
  });
}
