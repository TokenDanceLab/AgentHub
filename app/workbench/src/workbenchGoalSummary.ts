/**
 * UX F8 — conversation-level goal banner derivation (#1998).
 *
 * Pure projection of goal tool calls already present in the transcript —
 * not a new data source and no Hub protocol. Goal calls enter transcripts
 * through the shared edge-event normalization (`toolCallBlock`): the block
 * `toolName` identifies the tool and the bounded scalar `input` projection
 * carries the goal arguments (`objective` on create, `status` on update).
 *
 * Fail-closed contract (mirrors the attention model boundary): unknown tool
 * vocabulary, a missing objective text, or a failed creation derive nothing,
 * so surfaces render no banner instead of guessing.
 */

import type { ToolCallTranscriptBlock, TranscriptBlock } from '@shared/transcript';

/**
 * Goal tool vocabulary — explicit SSOT (#1998). Evidence: the Codex runtime
 * goal tools (`create_goal` / `update_goal`) whose calls surface in AgentHub
 * transcripts as tool_call blocks through the codex adapter. No other
 * runtime (Claude Code, OpenCode, ACP) exposes a verified goal equivalent
 * today, so none is listed — 宁缺勿滥. Matching is exact and case-sensitive:
 * tool names arrive verbatim from the adapters.
 */
export const GOAL_TOOL_NAMES = {
  createGoal: 'create_goal',
  updateGoal: 'update_goal',
} as const;

/** `update_goal` status arguments accepted as "goal completed". */
const GOAL_COMPLETE_ARGS: ReadonlySet<string> = new Set(['complete', 'completed']);
/** `update_goal` status arguments accepted as "goal blocked". */
const GOAL_BLOCKED_ARGS: ReadonlySet<string> = new Set(['blocked']);

/** Goal lifecycle state projected onto the banner chip. */
export type WorkbenchGoalStatus = 'active' | 'blocked' | 'completed';

/** Derived goal summary rendered by the conversation goal banner. */
export interface WorkbenchGoalSummary {
  /** Goal text from the establishing create_goal call. */
  objective: string;
  status: WorkbenchGoalStatus;
  /** Newest goal tool-call timestamp known to the transcript (if any). */
  updatedAt?: string | undefined;
  /** Block id of the establishing create_goal call. */
  sourceBlockId: string;
}

/**
 * Scan a conversation transcript (chronological order, as produced by the
 * shared normalizers) and derive the current goal summary, or `undefined`
 * when the conversation has no derivable goal. Later create_goal calls
 * re-establish a fresh goal; update_goal calls only transition the status
 * when their argument is recognized.
 */
export function deriveGoalSummary(
  blocks: readonly TranscriptBlock[] | undefined,
): WorkbenchGoalSummary | undefined {
  if (!blocks || blocks.length === 0) return undefined;

  let current: WorkbenchGoalSummary | undefined;
  for (const block of blocks) {
    if (block.kind !== 'tool_call') continue;
    if (block.toolName === GOAL_TOOL_NAMES.createGoal) {
      // A failed creation establishes nothing and leaves any prior goal
      // untouched; a creation without derivable objective text hides the
      // banner (fail-closed — never render a goal we cannot quote).
      if (block.status === 'failed') continue;
      current = deriveGoalCreation(block);
      continue;
    }
    if (block.toolName === GOAL_TOOL_NAMES.updateGoal && current) {
      const nextStatus = deriveGoalUpdateStatus(block);
      if (!nextStatus) continue; // unknown/failed update: goal unchanged
      current = {
        ...current,
        status: nextStatus,
        ...(block.createdAt ? { updatedAt: block.createdAt } : {}),
      };
    }
  }
  return current;
}

function deriveGoalCreation(block: ToolCallTranscriptBlock): WorkbenchGoalSummary | undefined {
  const objective = goalObjectiveText(block);
  if (!objective) return undefined;
  return {
    objective,
    status: 'active',
    sourceBlockId: block.id,
    ...(block.createdAt ? { updatedAt: block.createdAt } : {}),
  };
}

/** Objective text precedence: scalar input projection → summary → target. */
function goalObjectiveText(block: ToolCallTranscriptBlock): string | undefined {
  const fromInput = block.input?.objective;
  if (typeof fromInput === 'string') {
    const trimmed = fromInput.trim();
    if (trimmed) return trimmed;
  }
  const summary = block.summary?.trim();
  if (summary) return summary;
  const target = block.target?.trim();
  if (target) return target;
  return undefined;
}

function deriveGoalUpdateStatus(block: ToolCallTranscriptBlock): WorkbenchGoalStatus | undefined {
  if (block.status === 'failed') return undefined;
  const arg = block.input?.status;
  if (typeof arg !== 'string') return undefined;
  const normalized = arg.trim().toLowerCase();
  if (GOAL_COMPLETE_ARGS.has(normalized)) return 'completed';
  if (GOAL_BLOCKED_ARGS.has(normalized)) return 'blocked';
  return undefined;
}
