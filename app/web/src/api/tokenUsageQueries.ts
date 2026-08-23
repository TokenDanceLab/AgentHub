import { useQuery } from '@tanstack/react-query';
import { hubQueryKeys } from '@shared/stores/queryKeys';
import type { TokenUsagePageTeam } from '@agenthub/workbench';
import { createHubClient } from './hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import { useHubStore } from '@/stores/hubStore';

/* ═══════════════════════════════════════════════════════════════════════
   Token usage board queries (#1819).

   The Hub has no aggregate usage endpoint, so this composes the real data
   client-side: list the caller's agent teams, then each team's runs, and map
   the migration-0066 `token_usage_total` counter through. Runs recorded
   before the counter existed carry undefined (rendered as “—”, never 0).
   ═══════════════════════════════════════════════════════════════════════ */

export function useTokenUsageBoard(enabled: boolean) {
  const hubAuthenticated = useHubStore((s) => s.authenticated);

  return useQuery<TokenUsagePageTeam[]>({
    queryKey: hubQueryKeys.agentTeams.usageBoard,
    queryFn: async () => {
      const token = getAccessToken();
      if (!token) throw new Error('Hub session is required');
      const client = createHubClient({ getToken: () => token });
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
        })
      );
    },
    enabled: enabled && hubAuthenticated,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}
