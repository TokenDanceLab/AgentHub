import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAccessToken } from '@/hooks/useAuth';
import { hubQueryKeys } from '@shared/stores/queryKeys';
import type { TokenUsagePageTeam } from '@agenthub/workbench';
import { createHubClient } from './hubClient';
import type { TeamApprovalDecisionRequest } from './hubClient';

export function useDecideTeamApproval(
  options: { getToken?: () => string | null; baseUrl?: string } = {},
) {
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
        options.baseUrl
          ? { baseUrl: options.baseUrl, getToken: () => token }
          : { getToken: () => token },
      );
      return client.decideTeamApproval(input.teamId, input.runId, input.approvalId, input.decision);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hubQueryKeys.agentTeams.root });
    },
  });
}

export function useTokenUsageBoard(
  enabled: boolean,
  opts?: { getToken?: () => string | null; baseUrl?: string },
) {
  return useQuery<TokenUsagePageTeam[]>({
    queryKey: hubQueryKeys.agentTeams.usageBoard,
    queryFn: async () => {
      const token = (opts?.getToken ?? getAccessToken)();
      if (!token) throw new Error('Hub session is required');
      const client = createHubClient(
        opts?.baseUrl
          ? { baseUrl: opts.baseUrl, getToken: () => token }
          : { getToken: () => token },
      );
      const teams = await client.listAgentTeams();
      return Promise.all(
        teams.map(async (team) => {
          const runs = await client.listTeamRuns(team.id);
          return {
            id: String(team.id),
            name: team.name ? String(team.name) : String(team.id),
            runs: runs.map((run) => ({
              id: String(run.id),
              status: String(run.status),
              ...(run.created_at ? { createdAt: String(run.created_at) } : {}),
              ...(run.trigger_message ? { triggerMessage: String(run.trigger_message) } : {}),
              ...(typeof run.token_usage_total === 'number'
                ? { tokenUsageTotal: run.token_usage_total }
                : {}),
            })),
          };
        }),
      );
    },
    enabled,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}
