import { describe, expect, it } from 'vitest';
import { reduceNavigationTarget, type MobileNavigationRoutingState } from './navigationRouting';

const base: MobileNavigationRoutingState = {
  activeTab: 'chat',
  threadId: 'thread-old',
  runId: 'run-old',
};

describe('reduceNavigationTarget (mobile deep link / notification routing)', () => {
  it('routes thread targets to the thread tab and replaces the selection', () => {
    const next = reduceNavigationTarget(base, {
      screen: 'thread',
      threadId: 'thread-delicious233',
    });

    expect(next).toEqual({
      activeTab: 'thread',
      threadId: 'thread-delicious233',
    });
  });

  it('routes run targets to the tasks tab with the run id', () => {
    const next = reduceNavigationTarget(base, {
      screen: 'tasks',
      source: 'run',
      runId: 'run-agenthub',
      threadId: 'thread-delicious233',
    });

    expect(next).toEqual({
      activeTab: 'tasks',
      runId: 'run-agenthub',
      threadId: 'thread-delicious233',
    });
  });

  it('opens the review sheet for approval targets', () => {
    const next = reduceNavigationTarget(base, {
      screen: 'tasks',
      source: 'approval',
      approvalId: 'approval-agenthub',
      runId: 'run-agenthub',
      threadId: 'thread-delicious233',
    });

    expect(next).toEqual({
      activeTab: 'tasks',
      runId: 'run-agenthub',
      threadId: 'thread-delicious233',
      approvalSheetMode: 'review',
    });
  });

  it('routes activity targets to the tasks tab without a sheet', () => {
    const next = reduceNavigationTarget(base, {
      screen: 'tasks',
      source: 'activity',
      runId: 'run-agenthub',
    });

    expect(next).toEqual({
      activeTab: 'tasks',
      runId: 'run-agenthub',
    });
  });

  it('stale identifiers are dropped when a newer target does not carry them', () => {
    const next = reduceNavigationTarget(base, {
      screen: 'tasks',
      source: 'activity',
    });

    expect(next.threadId).toBeUndefined();
    expect(next.runId).toBeUndefined();
    expect(next.activeTab).toBe('tasks');
  });
});
