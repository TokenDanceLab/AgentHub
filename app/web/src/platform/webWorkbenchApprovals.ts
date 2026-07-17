import type { ApprovalDecisionAction } from '@shared/transcript';
import type { createHubClient } from '@/api/hubClient';

type WebApprovalHubClient = Pick<ReturnType<typeof createHubClient>, 'decideTaskApproval' | 'decideTeamApproval'>;

export async function decideWebApprovalWithHubClient(
  client: WebApprovalHubClient,
  action: ApprovalDecisionAction,
): Promise<void> {
  if (action.teamId && action.teamRunId) {
    await client.decideTeamApproval(action.teamId, action.teamRunId, action.approvalId, {
      decision: action.decision,
    });
    return;
  }
  if (action.agentTaskId) {
    await client.decideTaskApproval(action.agentTaskId, action.approvalId, {
      decision: action.decision,
    });
    return;
  }
  throw new Error('Hub approval decision requires agentTaskId or teamId and teamRunId');
}
