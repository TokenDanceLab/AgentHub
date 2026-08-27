import { describe, expect, it, vi } from 'vitest';
import {
  BOARD_COLUMNS_IN_DISPLAY_ORDER,
  TASK_STATUS_SEQUENCE,
  WORKBENCH_BOARD_COLUMNS,
  boardColumnDisplayLabels,
  boardColumnForStatus,
  isAwaitingReviewStatus,
  needsHubOnlyMergeNotice,
  resolveReviewMergeDecision,
  type TaskReviewMergePort,
} from './workbenchBoardColumns';

/* ═══════════════════════════════════════════════════════════════════════
   Board-column contract tests (#1999, codeg board-columns pattern).

   Every expectation derives from the mapping table itself — the tests
   assert the table's invariants and the fail-closed lookup round-trip,
   never a mirrored copy of the implementation switch.
   ═══════════════════════════════════════════════════════════════════════ */

const KNOWN_TONES = new Set(['idle', 'running', 'review', 'confirm', 'done']);

describe('workbenchBoardColumns bidirectional contract (#1999)', () => {
  it('maps every lifecycle status to exactly one column (no duplicates)', () => {
    const statuses = WORKBENCH_BOARD_COLUMNS.map((column) => column.status);
    expect(new Set(statuses).size).toBe(statuses.length);
    expect(statuses.length).toBe(TASK_STATUS_SEQUENCE.length);
    // Set equality in both directions: sequence ⇄ columns.
    expect(new Set(statuses)).toEqual(new Set(TASK_STATUS_SEQUENCE));
    for (const status of TASK_STATUS_SEQUENCE) {
      expect(WORKBENCH_BOARD_COLUMNS.filter((column) => column.status === status)).toHaveLength(1);
    }
  });

  it('has no orphan columns: every column round-trips through the lookup', () => {
    for (const column of WORKBENCH_BOARD_COLUMNS) {
      expect(boardColumnForStatus(column.status)).toBe(column);
      // Column ids and labels are stable, non-empty identifiers.
      expect(column.id.length).toBeGreaterThan(0);
      expect(column.label.length).toBeGreaterThan(0);
      expect(KNOWN_TONES.has(column.tone)).toBe(true);
    }
  });

  it('keeps the sequence and the column set consistent', () => {
    // The lifecycle sequence derives from the table order…
    expect(TASK_STATUS_SEQUENCE).toEqual(WORKBENCH_BOARD_COLUMNS.map((column) => column.status));
    // …and the display order is a dense 1..N permutation of the same set.
    const orders = WORKBENCH_BOARD_COLUMNS.map((column) => column.boardOrder).sort((a, b) => a - b);
    expect(orders).toEqual(WORKBENCH_BOARD_COLUMNS.map((_, index) => index + 1));
    expect([...BOARD_COLUMNS_IN_DISPLAY_ORDER.map((column) => column.status)].sort()).toEqual(
      [...TASK_STATUS_SEQUENCE].sort(),
    );
    expect(boardColumnDisplayLabels()).toEqual(
      BOARD_COLUMNS_IN_DISPLAY_ORDER.map((column) => column.label),
    );
  });

  it('flags exactly one review-gated column', () => {
    const reviewColumns = WORKBENCH_BOARD_COLUMNS.filter((column) => column.awaitingReview);
    expect(reviewColumns).toHaveLength(1);
    const reviewColumn = reviewColumns[0]!;
    expect(isAwaitingReviewStatus(reviewColumn.status)).toBe(true);
    for (const column of WORKBENCH_BOARD_COLUMNS) {
      if (column !== reviewColumn) {
        expect(isAwaitingReviewStatus(column.status)).toBe(false);
      }
    }
  });

  it('never lets an unknown status land silently (negative)', () => {
    expect(boardColumnForStatus('不存在的状态')).toBeUndefined();
    expect(boardColumnForStatus('')).toBeUndefined();
    expect(boardColumnForStatus('MERGED')).toBeUndefined();
    expect(isAwaitingReviewStatus('不存在的状态')).toBe(false);
    // An unknown status must never satisfy the review gate either.
    expect(
      resolveReviewMergeDecision({ status: '不存在的状态', port: makePort(), surface: 'desktop' })
        .controlsVisible,
    ).toBe(false);
  });
});

describe('review-before-merge capability gate (#1999)', () => {
  it('fails closed without a capability port — zero controls even on desktop', () => {
    const decision = resolveReviewMergeDecision({ status: reviewColumnStatus(), surface: 'desktop' });
    expect(decision.controlsVisible).toBe(false);
    expect(decision.reason).toBe('no-capability-port');
    expect(
      resolveReviewMergeDecision({ status: reviewColumnStatus(), port: null, surface: 'desktop' })
        .controlsVisible,
    ).toBe(false);
  });

  it('renders controls only for awaiting-review tasks on a desktop port', () => {
    const decision = resolveReviewMergeDecision({
      status: reviewColumnStatus(),
      port: makePort(),
      surface: 'desktop',
    });
    expect(decision.controlsVisible).toBe(true);
    expect(decision.reason).toBeUndefined();
  });

  it('keeps Hub-only surfaces read-only even with a port', () => {
    for (const surface of ['web', 'mobile'] as const) {
      const decision = resolveReviewMergeDecision({
        status: reviewColumnStatus(),
        port: makePort(),
        surface,
      });
      expect(decision.controlsVisible).toBe(false);
      expect(decision.reason).toBe('hub-only-surface');
    }
  });

  it('blocks non-review statuses and unknown statuses', () => {
    for (const column of WORKBENCH_BOARD_COLUMNS) {
      if (column.awaitingReview) continue;
      const decision = resolveReviewMergeDecision({
        status: column.status,
        port: makePort(),
        surface: 'desktop',
      });
      expect(decision.controlsVisible).toBe(false);
      expect(decision.reason).toBe('not-awaiting-review');
    }
  });
});

describe('Hub-only merge notice honesty (#1999)', () => {
  const reviewStatus = WORKBENCH_BOARD_COLUMNS.find((column) => column.awaitingReview)!.status;
  const idleStatus = WORKBENCH_BOARD_COLUMNS.find((column) => !column.awaitingReview)!.status;

  it('shows on Hub-only surfaces only when awaiting-review tasks exist', () => {
    expect(needsHubOnlyMergeNotice({ surface: 'web', statuses: [reviewStatus] })).toBe(true);
    expect(needsHubOnlyMergeNotice({ surface: 'mobile', statuses: [idleStatus, reviewStatus] })).toBe(true);
  });

  it('stays silent on desktop, without review tasks, or without a known surface', () => {
    expect(needsHubOnlyMergeNotice({ surface: 'desktop', statuses: [reviewStatus] })).toBe(false);
    expect(needsHubOnlyMergeNotice({ surface: 'web', statuses: [idleStatus] })).toBe(false);
    expect(needsHubOnlyMergeNotice({ surface: 'web', statuses: [] })).toBe(false);
    expect(needsHubOnlyMergeNotice({ statuses: [reviewStatus] })).toBe(false);
  });

  it('never treats unknown statuses as review-gated', () => {
    expect(needsHubOnlyMergeNotice({ surface: 'web', statuses: ['已合并', 'MERGED'] })).toBe(false);
  });
});

// ── helpers (derive from the table; no hardcoded mirrors) ───────────────

function reviewColumnStatus(): string {
  return WORKBENCH_BOARD_COLUMNS.find((column) => column.awaitingReview)!.status;
}

function makePort(): TaskReviewMergePort {
  return { approveReview: vi.fn(), mergeTask: vi.fn() };
}
