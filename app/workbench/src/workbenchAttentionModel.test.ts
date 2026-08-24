import type { Approval, Run, Thread } from '@shared/types';
import {
  deriveConversationLiveStatus,
  findFirstAwaitingConversationId,
  isRunActive,
  summarizeWorkbenchAttention,
} from './workbenchAttentionModel';

function makeRun(overrides: Partial<Run> & Pick<Run, 'runId' | 'threadId' | 'status'>): Run {
  return { projectId: 'p1', createdAt: '2026-08-25T00:00:00Z', ...overrides };
}

function makeApproval(
  overrides: Partial<Approval> & Pick<Approval, 'id' | 'runId' | 'threadId' | 'status'>,
): Approval {
  return { kind: 'command', summary: 's', createdAt: '2026-08-25T00:00:00Z', ...overrides };
}

function makeThread(id: string, conversationId?: string): Thread {
  return {
    id,
    projectId: 'p1',
    status: 'active',
    createdAt: '2026-08-25T00:00:00Z',
    ...(conversationId ? { conversationId } : {}),
  };
}

describe('isRunActive', () => {
  it('treats queued/starting/running as active and everything else as not', () => {
    expect(isRunActive('queued')).toBe(true);
    expect(isRunActive('starting')).toBe(true);
    expect(isRunActive('running')).toBe(true);
    expect(isRunActive('waiting_approval')).toBe(false);
    expect(isRunActive('finished')).toBe(false);
    expect(isRunActive('failed')).toBe(false);
    expect(isRunActive('cancelled')).toBe(false);
  });
});

describe('deriveConversationLiveStatus', () => {
  it('running outranks a pending approval waiting in the same conversation', () => {
    const status = deriveConversationLiveStatus(
      [makeRun({ runId: 'r1', threadId: 't1', status: 'running' })],
      1,
    );
    expect(status).toBe('running');
  });

  it('waiting run or pending approval both surface awaiting-approval over done', () => {
    const fromRun = deriveConversationLiveStatus(
      [
        makeRun({ runId: 'r1', threadId: 't1', status: 'finished' }),
        makeRun({ runId: 'r2', threadId: 't1', status: 'waiting_approval' }),
      ],
      0,
    );
    expect(fromRun).toBe('awaiting-approval');

    const fromApprovalOnly = deriveConversationLiveStatus(
      [makeRun({ runId: 'r1', threadId: 't1', status: 'finished' })],
      2,
    );
    expect(fromApprovalOnly).toBe('awaiting-approval');
  });

  it('reports done only for finished runs; failed/cancelled leave no live dot', () => {
    expect(
      deriveConversationLiveStatus([makeRun({ runId: 'r1', threadId: 't1', status: 'finished' })], 0),
    ).toBe('done');
    expect(
      deriveConversationLiveStatus([makeRun({ runId: 'r1', threadId: 't1', status: 'failed' })], 0),
    ).toBeUndefined();
    expect(
      deriveConversationLiveStatus([makeRun({ runId: 'r1', threadId: 't1', status: 'cancelled' })], 0),
    ).toBeUndefined();
  });

  it('returns undefined when nothing live or awaiting remains', () => {
    expect(deriveConversationLiveStatus([], 0)).toBeUndefined();
  });
});

describe('summarizeWorkbenchAttention', () => {
  it('feeds dots and counts from one model: attribution, pending-only counting, orphan threads', () => {
    const summary = summarizeWorkbenchAttention({
      runs: [
        makeRun({ runId: 'r1', threadId: 't1', status: 'running' }),
        makeRun({ runId: 'r2', threadId: 't2', status: 'waiting_approval' }),
        makeRun({ runId: 'r3', threadId: 't3', status: 'finished' }),
        // orphan thread (no conversationId): counted globally, no dot target
        makeRun({ runId: 'r4', threadId: 't4', status: 'starting' }),
      ],
      approvals: [
        makeApproval({ id: 'a1', runId: 'r2', threadId: 't2', status: 'pending' }),
        // decided approval must not count as awaiting
        makeApproval({ id: 'a2', runId: 'r3', threadId: 't3', status: 'approved' }),
      ],
      threads: [makeThread('t1', 'conv-a'), makeThread('t2', 'conv-b'), makeThread('t3', 'conv-c'), makeThread('t4')],
    });

    expect(summary.runningCount).toBe(2);
    // pending approval a1 only — r2 already carries it, no double count
    expect(summary.awaitingApprovalCount).toBe(1);
    expect(summary.liveStatusByConversation).toEqual({
      'conv-a': 'running',
      'conv-b': 'awaiting-approval',
      'conv-c': 'done',
    });
  });

  it('counts a waiting_approval run without approval record as one awaiting decision', () => {
    const summary = summarizeWorkbenchAttention({
      runs: [makeRun({ runId: 'r1', threadId: 't1', status: 'waiting_approval' })],
      approvals: [],
      threads: [makeThread('t1', 'conv-a')],
    });
    expect(summary.awaitingApprovalCount).toBe(1);
    expect(summary.liveStatusByConversation['conv-a']).toBe('awaiting-approval');
  });

  it('aggregates multiple threads of one conversation and returns empty surface on no input', () => {
    const summary = summarizeWorkbenchAttention({
      runs: [
        makeRun({ runId: 'r1', threadId: 't1', status: 'finished' }),
        makeRun({ runId: 'r2', threadId: 't2', status: 'running' }),
      ],
      approvals: [],
      threads: [makeThread('t1', 'conv-a'), makeThread('t2', 'conv-a')],
    });
    expect(summary.liveStatusByConversation['conv-a']).toBe('running');

    const empty = summarizeWorkbenchAttention({ runs: [], approvals: [], threads: [] });
    expect(empty).toEqual({ runningCount: 0, awaitingApprovalCount: 0, liveStatusByConversation: {} });
  });
});

describe('findFirstAwaitingConversationId', () => {
  it('returns the first awaiting conversation in list order, skipping other states', () => {
    const found = findFirstAwaitingConversationId(
      [{ id: 'c-running' }, { id: 'c-awaiting-1' }, { id: 'c-awaiting-2' }],
      { 'c-running': 'running', 'c-awaiting-1': 'awaiting-approval', 'c-awaiting-2': 'awaiting-approval' },
    );
    expect(found).toBe('c-awaiting-1');
  });

  it('returns undefined when no conversation awaits approval', () => {
    expect(findFirstAwaitingConversationId([{ id: 'c1' }], { c1: 'running' })).toBeUndefined();
    expect(findFirstAwaitingConversationId([], {})).toBeUndefined();
  });
});
