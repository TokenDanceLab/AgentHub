import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAccessToken } from '@/hooks/useAuth';
import { useHubStore } from '@/stores/hubStore';
import { createHubClient } from './hubClient';
import type {
  AgentTeam,
  AgentTeamDetail,
  AgentTeamEvent,
  AgentTeamRun,
  AgentTeamTask,
  AddAgentTeamMemberRequest,
  CreateAgentTeamRequest,
  CustomAgent,
  StartAgentTeamRunRequest,
  TeamApprovalDecisionRequest,
  TeamConflictResolutionRequest,
  TeamRunState,
} from './hubClient';

export interface UseHubAgentTeamsOptions {
  enabled: boolean;
  getToken?: () => string | null;
  baseUrl?: string;
  selectedTeamId?: string;
  selectedRunId?: string;
}

export interface AgentTeamRunBundle {
  team: AgentTeamDetail;
  runs: AgentTeamRun[];
  latestRun?: AgentTeamRun;
}

export interface AgentTeamOverview {
  teams: AgentTeamDetail[];
  bundles: AgentTeamRunBundle[];
  customAgents: CustomAgent[];
  selectedTeam?: AgentTeamDetail;
  selectedRun?: AgentTeamRun;
  state?: TeamRunState;
  tasks: AgentTeamTask[];
  events: AgentTeamEvent[];
}

const emptyAgentTeamOverview: AgentTeamOverview = {
  teams: [],
  bundles: [],
  customAgents: [],
  tasks: [],
  events: [],
};

function timestampOf(value?: string) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function newestRun(runs: AgentTeamRun[]) {
  return [...runs].sort((a, b) => (
    timestampOf(b.updated_at ?? b.created_at) - timestampOf(a.updated_at ?? a.created_at)
  ))[0];
}

function detailFallback(team: AgentTeam): AgentTeamDetail {
  return { ...team, members: [] };
}

export async function fetchAgentTeamOverview(
  preferHub: boolean,
  getToken: () => string | null = getAccessToken,
  baseUrl?: string,
  selectedTeamId?: string,
  selectedRunId?: string,
): Promise<AgentTeamOverview> {
  const token = getToken();
  if (!preferHub || !token) return emptyAgentTeamOverview;

  const client = createHubClient(
    baseUrl ? { baseUrl, getToken: () => token } : { getToken: () => token },
  );

  const [teams, customAgents] = await Promise.all([
    client.listAgentTeams(),
    client.listCustomAgents().catch(() => [] as CustomAgent[]),
  ]);
  if (teams.length === 0) return { ...emptyAgentTeamOverview, customAgents };

  const details = await Promise.all(
    teams.map(async (team) => {
      try {
        return await client.getAgentTeam(team.id);
      } catch {
        return detailFallback(team);
      }
    }),
  );

  const bundles = await Promise.all(
    details.map(async (team) => {
      try {
        const runs = await client.listTeamRuns(team.id);
        const latestRun = newestRun(runs);
        return latestRun ? { team, runs, latestRun } : { team, runs };
      } catch {
        return { team, runs: [] };
      }
    }),
  );

  const selectedBundle =
    bundles.find((bundle) => selectedTeamId && bundle.team.id === selectedTeamId) ??
    bundles.find((bundle) => selectedRunId && bundle.runs.some((run) => run.id === selectedRunId)) ??
    bundles.find((bundle) => bundle.latestRun) ??
    bundles[0];
  const selectedTeam = selectedBundle?.team;
  const selectedRun =
    selectedBundle?.runs.find((run) => selectedRunId && run.id === selectedRunId) ??
    selectedBundle?.latestRun;

  if (!selectedTeam || !selectedRun) {
    return {
      teams: details,
      bundles,
      customAgents,
      ...(selectedTeam ? { selectedTeam } : {}),
      tasks: [],
      events: [],
    };
  }

  const [state, tasks, events] = await Promise.all([
    client.getTeamRunState(selectedTeam.id, selectedRun.id).catch(() => undefined),
    client.listTeamTasks(selectedTeam.id, selectedRun.id).catch(() => [] as AgentTeamTask[]),
    client.listTeamEvents(selectedTeam.id, selectedRun.id).catch(() => [] as AgentTeamEvent[]),
  ]);

  return {
    teams: details,
    bundles,
    customAgents,
    selectedTeam,
    selectedRun,
    ...(state ? { state } : {}),
    tasks,
    events,
  };
}

export function useHubAgentTeams(enabledOrOptions: boolean | UseHubAgentTeamsOptions) {
  const hubAuthenticated = useHubStore((s) => s.authenticated);
  const options = typeof enabledOrOptions === 'boolean'
    ? { enabled: enabledOrOptions, preferHub: hubAuthenticated, getToken: getAccessToken }
    : {
        enabled: enabledOrOptions.enabled,
        preferHub: enabledOrOptions.enabled,
        getToken: enabledOrOptions.getToken ?? getAccessToken,
        ...(enabledOrOptions.baseUrl ? { baseUrl: enabledOrOptions.baseUrl } : {}),
        ...(enabledOrOptions.selectedTeamId ? { selectedTeamId: enabledOrOptions.selectedTeamId } : {}),
        ...(enabledOrOptions.selectedRunId ? { selectedRunId: enabledOrOptions.selectedRunId } : {}),
      };

  return useQuery<AgentTeamOverview>({
    queryKey: [
      'agent-teams',
      options.preferHub ? 'hub' : 'signed-out',
      options.baseUrl ?? 'default',
      options.selectedTeamId ?? 'auto-team',
      options.selectedRunId ?? 'auto-run',
    ],
    queryFn: () => fetchAgentTeamOverview(
      options.preferHub,
      options.getToken,
      options.baseUrl,
      options.selectedTeamId,
      options.selectedRunId,
    ),
    enabled: options.enabled,
    refetchInterval: options.preferHub ? 10_000 : false,
    placeholderData: (prev) => prev,
  });
}

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
      queryClient.invalidateQueries({ queryKey: ['agent-teams'] });
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
      queryClient.invalidateQueries({ queryKey: ['agent-teams'] });
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
      queryClient.invalidateQueries({ queryKey: ['agent-teams'] });
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
      queryClient.invalidateQueries({ queryKey: ['agent-teams'] });
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
      queryClient.invalidateQueries({ queryKey: ['agent-teams'] });
    },
  });
}
