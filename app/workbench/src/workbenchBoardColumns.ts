/* ═══════════════════════════════════════════════════════════════════════
   Workbench Tasks board column SSOT (#1999, UX F13).

   Single status→column mapping table: every task status maps to exactly
   one board column (id / label / tone), and both the lifecycle sequence
   and the board display order derive from this table — neither is copied
   into the other. Consumers:
   - workbenchTaskGroups.ts re-exports TASK_STATUS_SEQUENCE and derives
     status-group ordering from boardColumnDisplayLabels().
   - the Tasks board view renders column chrome (tone, review marker)
     from this same table.

   review-before-merge gate: approve/merge controls render only when a
   real capability port is present on a Desktop/Local-Edge surface; every
   other combination fails closed to zero controls (codeg To-dos
   semantics — 排队可见、不静默落列、不假合并).
   ═══════════════════════════════════════════════════════════════════════ */

import type { AgentHubSurface } from '@shared/platform';
import type { TaskStatus } from './pages';

export type BoardColumnTone = 'idle' | 'running' | 'review' | 'confirm' | 'done';

export interface WorkbenchBoardColumn {
  /** Stable column id for DOM hooks and contract tests. */
  readonly id: string;
  /** Task status mapped into this column (exactly one column per status). */
  readonly status: TaskStatus;
  /** Column display label. */
  readonly label: string;
  /** Semantic tone — resolved to the shared state palette in TasksPage CSS. */
  readonly tone: BoardColumnTone;
  /** 1-based board display order (dense, no gaps). */
  readonly boardOrder: number;
  /** review-before-merge: tasks in this column wait for human review. */
  readonly awaitingReview: boolean;
}

/**
 * Canonical status→column table. Array order IS the lifecycle sequence;
 * board display order is the explicit dense boardOrder.
 */
export const WORKBENCH_BOARD_COLUMNS: readonly WorkbenchBoardColumn[] = [
  { id: 'todo', status: '未开始', label: '未开始', tone: 'idle', boardOrder: 4, awaitingReview: false },
  { id: 'running', status: '进行中', label: '进行中', tone: 'running', boardOrder: 1, awaitingReview: false },
  { id: 'review', status: '待评审', label: '待评审', tone: 'review', boardOrder: 2, awaitingReview: true },
  { id: 'confirm', status: '待确认', label: '待确认', tone: 'confirm', boardOrder: 3, awaitingReview: false },
  { id: 'done', status: '已完成', label: '已完成', tone: 'done', boardOrder: 5, awaitingReview: false },
];

/** Lifecycle status sequence — derived from the column table, never copied. */
export const TASK_STATUS_SEQUENCE: readonly TaskStatus[] =
  WORKBENCH_BOARD_COLUMNS.map((column) => column.status);

/** Columns in board display order. */
export const BOARD_COLUMNS_IN_DISPLAY_ORDER: readonly WorkbenchBoardColumn[] =
  [...WORKBENCH_BOARD_COLUMNS].sort((a, b) => a.boardOrder - b.boardOrder);

const BOARD_COLUMN_BY_STATUS: ReadonlyMap<string, WorkbenchBoardColumn> =
  new Map(WORKBENCH_BOARD_COLUMNS.map((column) => [column.status, column]));

/** Fail-closed status→column lookup: unknown statuses never land silently. */
export function boardColumnForStatus(status: string): WorkbenchBoardColumn | undefined {
  return BOARD_COLUMN_BY_STATUS.get(status);
}

/** Board column labels in display order (status-group ordering SSOT). */
export function boardColumnDisplayLabels(): string[] {
  return BOARD_COLUMNS_IN_DISPLAY_ORDER.map((column) => column.label);
}

/** True when the status belongs to the review-gated column. */
export function isAwaitingReviewStatus(status: string): boolean {
  return boardColumnForStatus(status)?.awaitingReview ?? false;
}

// ── review-before-merge capability gate ─────────────────────────────────

/**
 * Real review-before-merge capability port (#1999). Only a surface that
 * hosts a Local Edge merge path may provide one; the Tasks route never
 * invents a port, so an absent port means zero controls (fail-closed).
 */
export interface TaskReviewMergePort {
  /** Approve the pending review of a task. */
  approveReview(taskId: string): Promise<void> | void;
  /** Merge a task whose review has been approved. */
  mergeTask(taskId: string): Promise<void> | void;
}

export type ReviewMergeBlockedReason =
  | 'not-awaiting-review'
  | 'no-capability-port'
  | 'hub-only-surface';

export interface ReviewMergeDecision {
  /** Approve/merge controls may render. */
  controlsVisible: boolean;
  /** Present when blocked; explains why zero controls render. */
  reason?: ReviewMergeBlockedReason | undefined;
}

/**
 * Fail-closed gate for review/merge controls: visible only when the task
 * awaits review AND a real capability port exists AND the surface is
 * Desktop (the only surface with Local Edge). Web/Mobile stay read-only.
 */
export function resolveReviewMergeDecision(input: {
  status: string;
  port?: TaskReviewMergePort | null | undefined;
  surface?: AgentHubSurface | null | undefined;
}): ReviewMergeDecision {
  const column = boardColumnForStatus(input.status);
  if (!column || !column.awaitingReview) {
    return { controlsVisible: false, reason: 'not-awaiting-review' };
  }
  if (!input.port) {
    return { controlsVisible: false, reason: 'no-capability-port' };
  }
  if (input.surface !== 'desktop') {
    return { controlsVisible: false, reason: 'hub-only-surface' };
  }
  return { controlsVisible: true };
}

/**
 * Honest Hub-only notice (#1999): surfaces without Desktop/Local Edge may
 * show awaiting-review tasks but must say merging happens elsewhere — they
 * never render a merged or fake-merged state.
 */
export function needsHubOnlyMergeNotice(input: {
  surface?: AgentHubSurface | null | undefined;
  statuses: readonly string[];
}): boolean {
  if (!input.surface || input.surface === 'desktop') return false;
  return input.statuses.some((status) => isAwaitingReviewStatus(status));
}
