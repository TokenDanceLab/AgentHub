import type { Approval, Run, RunStatus, Thread } from '@shared/types';

/**
 * F1/F6 attention model — pure derivation of live conversation status and
 * global "running n / awaiting approval m" counts from the existing
 * run/approval/thread model shapes (see `workbenchStateTypes`). No new Hub
 * protocol: the shell hands over the run/approval inventory it already has;
 * this module is the single derivation source shared by the conversation
 * sidebar live dots (F1), the rail badge and the status-strip chips (F6).
 *
 * Honest boundary: shells without a run inventory (demo surfaces) simply do
 * not provide the input — every consumer renders nothing when the summary is
 * absent. Cross-session pending approvals have no dedicated Hub endpoint;
 * this surface aggregates whatever the shell's client-side model contains.
 */

/** Live status shown as a dot on a conversation row (F1). */
export type ConversationLiveStatus = 'running' | 'awaiting-approval' | 'done';

/** Existing model arrays the shell already holds; no new wire shape. */
export interface WorkbenchAttentionInput {
  runs: Run[];
  approvals: Approval[];
  threads: Thread[];
}

/** Global attention counts shown in the rail badge and status strip (F6). */
export interface WorkbenchAttentionCounts {
  runningCount: number;
  awaitingApprovalCount: number;
}

export interface WorkbenchAttentionSummary extends WorkbenchAttentionCounts {
  /** Conversation id → live status; conversations without runs are omitted. */
  liveStatusByConversation: Record<string, ConversationLiveStatus>;
}

/** Run statuses that mean an agent is actively occupying the conversation. */
const ACTIVE_RUN_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  'queued',
  'starting',
  'running',
]);

/** Whether a run counts as "running" for attention purposes. */
export function isRunActive(status: RunStatus): boolean {
  return ACTIVE_RUN_STATUSES.has(status);
}

/**
 * Derive one conversation's live status from its runs + pending approvals.
 * Precedence: running > awaiting-approval > done. Failed/cancelled-only
 * conversations get no dot — nothing live and nothing awaiting the user.
 */
export function deriveConversationLiveStatus(
  conversationRuns: Run[],
  pendingApprovalCount: number,
): ConversationLiveStatus | undefined {
  let sawWaiting = pendingApprovalCount > 0;
  let sawFinished = false;
  for (const run of conversationRuns) {
    if (isRunActive(run.status)) return 'running';
    if (run.status === 'waiting_approval') sawWaiting = true;
    if (run.status === 'finished') sawFinished = true;
  }
  if (sawWaiting) return 'awaiting-approval';
  if (sawFinished) return 'done';
  return undefined;
}

/**
 * Aggregate the global attention summary from the raw model arrays.
 *
 * Counting semantics:
 * - runningCount: runs in queued/starting/running.
 * - awaitingApprovalCount: pending approvals, plus waiting_approval runs that
 *   carry no pending approval record (snapshot seeds may contain only the run
 *   side); each represents one decision the user owes the agent.
 * - Live dots are attributed to conversations through `thread.conversationId`;
 *   threads without a conversation still contribute to the global counts.
 */
export function summarizeWorkbenchAttention(
  input: WorkbenchAttentionInput,
): WorkbenchAttentionSummary {
  const { runs, approvals, threads } = input;

  const runningCount = runs.filter((run) => isRunActive(run.status)).length;

  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending');
  const runIdsWithPendingApproval = new Set(pendingApprovals.map((approval) => approval.runId));
  const waitingRunsWithoutApproval = runs.filter(
    (run) => run.status === 'waiting_approval' && !runIdsWithPendingApproval.has(run.runId),
  );
  const awaitingApprovalCount = pendingApprovals.length + waitingRunsWithoutApproval.length;

  const threadIdsByConversation = new Map<string, string[]>();
  for (const thread of threads) {
    if (!thread.conversationId) continue;
    const bucket = threadIdsByConversation.get(thread.conversationId);
    if (bucket) {
      bucket.push(thread.id);
    } else {
      threadIdsByConversation.set(thread.conversationId, [thread.id]);
    }
  }

  const runsByThread = new Map<string, Run[]>();
  for (const run of runs) {
    const bucket = runsByThread.get(run.threadId);
    if (bucket) {
      bucket.push(run);
    } else {
      runsByThread.set(run.threadId, [run]);
    }
  }

  const pendingByThread = new Map<string, number>();
  for (const approval of pendingApprovals) {
    pendingByThread.set(approval.threadId, (pendingByThread.get(approval.threadId) ?? 0) + 1);
  }

  const liveStatusByConversation: Record<string, ConversationLiveStatus> = {};
  for (const [conversationId, threadIds] of threadIdsByConversation) {
    const conversationRuns: Run[] = [];
    let pendingApprovalCount = 0;
    for (const threadId of threadIds) {
      const threadRuns = runsByThread.get(threadId);
      if (threadRuns) conversationRuns.push(...threadRuns);
      pendingApprovalCount += pendingByThread.get(threadId) ?? 0;
    }
    const status = deriveConversationLiveStatus(conversationRuns, pendingApprovalCount);
    if (status) liveStatusByConversation[conversationId] = status;
  }

  return { runningCount, awaitingApprovalCount, liveStatusByConversation };
}

/**
 * First conversation (in sidebar list order) whose live status is
 * awaiting-approval — the click-through fallback target for the status-strip
 * approval chip when the active conversation has no pending block to jump to.
 */
export function findFirstAwaitingConversationId(
  conversations: Array<{ id: string }>,
  liveStatusByConversation: Record<string, ConversationLiveStatus>,
): string | undefined {
  for (const conversation of conversations) {
    if (liveStatusByConversation[conversation.id] === 'awaiting-approval') {
      return conversation.id;
    }
  }
  return undefined;
}
