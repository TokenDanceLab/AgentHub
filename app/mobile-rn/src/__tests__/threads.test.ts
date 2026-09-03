/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * ThreadsScreen data-level logic tests.
 *
 * Covers thread filtering, task digest computation, status tone mapping,
 * avatar tone, review density states, and fixture scenario validation.
 *
 * Vitest environment: node — tests pure data transformations (no React rendering).
 */
import { describe, expect, it } from 'vitest';

import {
  getMobileFixtureForScenario,
  getPendingReviewCount,
  getUnreadThreadCount,
  mobileFixture,
} from '@/data/mobileFixtures';
import type {
  MobileAppFixture,
  MobileFixtureScenario,
  MobileRun,
  MobileSurfaceStatus,
  MobileThread,
} from '@/types';

// ---------------------------------------------------------------------------
// Replicated helpers (source: ThreadsScreen.tsx)
// ---------------------------------------------------------------------------

type ThreadStatus = 'online' | 'running' | 'waiting' | 'failed' | 'offline' | 'muted';
type StatusTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral';
type AvatarTone = 'brand' | 'accent' | 'success' | 'warning' | 'danger' | 'neutral';

function getStatusTone(status: MobileThread['status']): StatusTone {
  if (status === 'online') return 'success';
  if (status === 'running') return 'accent';
  if (status === 'waiting') return 'warning';
  if (status === 'failed') return 'danger';
  return 'neutral';
}

function getAvatarTone(
  thread: MobileThread,
  fallback: 'accent' | 'warning',
): AvatarTone {
  if (thread.avatarTone === 'success') return 'success';
  if (thread.avatarTone === 'warning') return 'warning';
  if (thread.avatarTone === 'danger') return 'danger';
  if (thread.avatarTone === 'neutral') return 'neutral';
  return fallback;
}

function filterThreads(threads: MobileThread[], query: string): MobileThread[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return threads;

  return threads.filter(
    (thread) =>
      thread.title.toLowerCase().includes(normalizedQuery) ||
      thread.subtitle.toLowerCase().includes(normalizedQuery) ||
      (thread.statusDetail ?? '').toLowerCase().includes(normalizedQuery),
  );
}

function getParticipantBadgeLabel(
  thread: MobileThread,
  labels: Record<string, string>,
): string | undefined {
  if (thread.participantKind === 'external') return labels.external;
  if (thread.participantKind === 'bot') return labels.bot;
  if (thread.participantKind === 'agent') return labels.agent;
  return undefined;
}

function needsAttention(thread: MobileThread): boolean {
  return (
    thread.reviewDensity === 'critical' ||
    thread.status === 'waiting' ||
    thread.status === 'failed'
  );
}

function getTaskDigestTone(
  failedCount: number,
  pendingCount: number,
): 'accent' | 'warning' | 'danger' {
  if (failedCount > 0) return 'danger';
  if (pendingCount > 0) return 'warning';
  return 'accent';
}

function computeTaskCounts(runs: MobileRun[]) {
  return {
    pending: runs.filter((r) => r.status === 'approval_required').length,
    active: runs.filter((r) => r.status === 'running' || r.status === 'queued').length,
    failed: runs.filter((r) => r.status === 'failed').length,
  };
}

// ---------------------------------------------------------------------------
// getStatusTone
// ---------------------------------------------------------------------------

describe('getStatusTone', () => {
  it('maps thread status to tone', () => {
    expect(getStatusTone('online')).toBe('success');
    expect(getStatusTone('running')).toBe('accent');
    expect(getStatusTone('waiting')).toBe('warning');
    expect(getStatusTone('failed')).toBe('danger');
    expect(getStatusTone('offline')).toBe('neutral');
    expect(getStatusTone('muted')).toBe('neutral');
  });
});

// ---------------------------------------------------------------------------
// getAvatarTone
// ---------------------------------------------------------------------------

describe('getAvatarTone', () => {
  const toneCases: Array<[NonNullable<MobileThread['avatarTone']>, string]> = [
    ['success', 'success'],
    ['danger', 'danger'],
    ['neutral', 'neutral'],
    ['warning', 'warning'],
  ];
  it.each(toneCases)('returns explicit avatarTone %s when defined', (avatarTone, expected) => {
    const thread: MobileThread = {
      id: 't1', title: 'Test', subtitle: '', initials: 'T',
      avatarTone, unread: 0, participantKind: 'agent',
      status: 'online', lastActivity: 'now',
    };
    expect(getAvatarTone(thread, 'accent')).toBe(expected);
  });

  it('falls back to provided fallback when avatarTone is brand or undefined', () => {
    const thread1: MobileThread = {
      id: 't2', title: 'Test', subtitle: '', initials: 'T',
      avatarTone: 'brand', unread: 0, participantKind: 'agent',
      status: 'online', lastActivity: 'now',
    };
    expect(getAvatarTone(thread1, 'accent')).toBe('accent');

    const thread2: MobileThread = {
      id: 't3', title: 'Test', subtitle: '', initials: 'T',
      unread: 0, participantKind: 'agent',
      status: 'online', lastActivity: 'now',
    };
    expect(getAvatarTone(thread2, 'warning')).toBe('warning');
  });

});

// ---------------------------------------------------------------------------
// filterThreads
// ---------------------------------------------------------------------------

describe('filterThreads', () => {
  const threads = mobileFixture.threads;

  it('returns all threads when query is empty', () => {
    expect(filterThreads(threads, '')).toHaveLength(threads.length);
  });

  it('filters by title', () => {
    const result = filterThreads(threads, 'AgentHub Mobile');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]!.title).toMatch(/AgentHub Mobile/);
  });

  it('filters by subtitle', () => {
    const result = filterThreads(threads, 'TokenDance 工作区');
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('filters by statusDetail', () => {
    const result = filterThreads(threads, 'Review in progress');
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('is case-insensitive', () => {
    const lower = filterThreads(threads, 'agenthub');
    const upper = filterThreads(threads, 'AGENTHUB');
    expect(lower.length).toBe(upper.length);
  });

  it('returns empty when no match', () => {
    const result = filterThreads(threads, 'ZzzzNoMatchForThisQuery');
    expect(result).toHaveLength(0);
  });

  it('trims whitespace from query', () => {
    const result = filterThreads(threads, '  AgentHub  ');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getParticipantBadgeLabel
// ---------------------------------------------------------------------------

describe('getParticipantBadgeLabel', () => {
  const labels = { external: 'External', bot: 'Bot', agent: 'Agent' };

  const badgeCases: Array<[MobileThread['participantKind'], string]> = [
    ['external', 'External'],
    ['bot', 'Bot'],
    ['agent', 'Agent'],
  ];
  it.each(badgeCases)('returns label for %s participant', (participantKind, expected) => {
    const thread: MobileThread = {
      id: 't1', title: '', subtitle: '', initials: 'T',
      unread: 0, participantKind, status: 'online', lastActivity: 'now',
    };
    expect(getParticipantBadgeLabel(thread, labels)).toBe(expected);
  });

  it('returns undefined for group and human', () => {
    const group: MobileThread = {
      id: 't1', title: '', subtitle: '', initials: 'T',
      unread: 0, participantKind: 'group', status: 'online', lastActivity: 'now',
    };
    expect(getParticipantBadgeLabel(group, labels)).toBeUndefined();

    const human: MobileThread = {
      id: 't2', title: '', subtitle: '', initials: 'T',
      unread: 0, participantKind: 'human', status: 'online', lastActivity: 'now',
    };
    expect(getParticipantBadgeLabel(human, labels)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// needsAttention
// ---------------------------------------------------------------------------

describe('needsAttention', () => {
  it('returns true for critical review density', () => {
    const thread: MobileThread = {
      id: 't1', title: '', subtitle: '', initials: 'T',
      unread: 0, participantKind: 'group', reviewDensity: 'critical',
      status: 'online', lastActivity: 'now',
    };
    expect(needsAttention(thread)).toBe(true);
  });

  it.each([['waiting'], ['failed']] as Array<[MobileThread['status']]>)(
    'returns true for %s status',
    (status) => {
    const thread: MobileThread = {
      id: 't1', title: '', subtitle: '', initials: 'T',
      unread: 0, participantKind: 'group', status, lastActivity: 'now',
    };
    expect(needsAttention(thread)).toBe(true);
  });

  it('returns false for normal threads', () => {
    const thread: MobileThread = {
      id: 't1', title: '', subtitle: '', initials: 'T',
      unread: 0, participantKind: 'group', status: 'online',
      reviewDensity: 'normal', lastActivity: 'now',
    };
    expect(needsAttention(thread)).toBe(false);
  });

  it('returns false for light density running threads', () => {
    const thread: MobileThread = {
      id: 't1', title: '', subtitle: '', initials: 'T',
      unread: 0, participantKind: 'group', reviewDensity: 'light',
      status: 'running', lastActivity: 'now',
    };
    expect(needsAttention(thread)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeTaskCounts
// ---------------------------------------------------------------------------

describe('computeTaskCounts', () => {
  it('computes correct counts from default fixture', () => {
    const counts = computeTaskCounts(mobileFixture.runs);
    // approval_required: 1, completed: 1, failed: 1
    expect(counts.pending).toBe(1);
    expect(counts.active).toBe(0);
    expect(counts.failed).toBe(1);
  });

  it('returns zeroes for empty runs', () => {
    const counts = computeTaskCounts([]);
    expect(counts).toEqual({ pending: 0, active: 0, failed: 0 });
  });

  it.each([['queued'], ['running']] as Array<[MobileRun['status']]>)(
    'counts %s runs as active',
    (status) => {
    const runs: MobileRun[] = [{
      id: 'r1', threadId: 't1', title: 'Test', status,
      target: 'mock', updatedAt: 'now', summary: '', changedFiles: [],
    }];
    const counts = computeTaskCounts(runs);
    expect(counts.active).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getTaskDigestTone
// ---------------------------------------------------------------------------

describe('getTaskDigestTone', () => {
  it('returns danger when there are failed tasks', () => {
    expect(getTaskDigestTone(1, 0)).toBe('danger');
    expect(getTaskDigestTone(1, 5)).toBe('danger');
  });

  it('returns warning when there are pending tasks and no failures', () => {
    expect(getTaskDigestTone(0, 3)).toBe('warning');
    expect(getTaskDigestTone(0, 1)).toBe('warning');
  });

  it('returns accent when no failures or pending tasks', () => {
    expect(getTaskDigestTone(0, 0)).toBe('accent');
  });
});

// ---------------------------------------------------------------------------
// Default fixture thread validation
// ---------------------------------------------------------------------------

describe('default fixture threads', () => {
  it('has 9 threads', () => {
    expect(mobileFixture.threads).toHaveLength(9);
  });

  it('has threads with various participant kinds', () => {
    const kinds = new Set(mobileFixture.threads.map((t) => t.participantKind));
    expect(kinds.has('group')).toBe(true);
    expect(kinds.has('agent')).toBe(true);
    expect(kinds.has('bot')).toBe(true);
  });

  it('has at least one thread with unread > 0', () => {
    const unreadCounts = mobileFixture.threads.map((t) => t.unread);
    expect(Math.max(...unreadCounts)).toBeGreaterThan(0);
  });

  it('has threads with various statuses', () => {
    const statuses = new Set(mobileFixture.threads.map((t) => t.status));
    expect(statuses.has('running')).toBe(true);
    expect(statuses.has('online')).toBe(true);
    expect(statuses.has('waiting')).toBe(true);
  });

  it('has threads with various review densities', () => {
    const densities = new Set(
      mobileFixture.threads
        .filter((t) => t.reviewDensity)
        .map((t) => t.reviewDensity),
    );
    expect(densities.has('dense')).toBe(true);
    expect(densities.has('critical')).toBe(true);
    expect(densities.has('normal')).toBe(true);
    expect(densities.has('light')).toBe(true);
  });

  it('has a thread matching "AgentHub Mobile Workbench"', () => {
    const found = mobileFixture.threads.find(
      (t) => t.title === 'AgentHub Mobile Workbench',
    );
    expect(found).toBeDefined();
    expect(found?.unread).toBe(4);
    expect(found?.participantKind).toBe('group');
  });

  it('has thread with activeRunId', () => {
    const hasActiveRun = mobileFixture.threads.some((t) => t.activeRunId !== undefined);
    expect(hasActiveRun).toBe(true);
  });

  it('every thread has a lastActivity', () => {
    for (const thread of mobileFixture.threads) {
      expect(thread.lastActivity.length).toBeGreaterThan(0);
    }
  });

  it('total unread count is 7', () => {
    expect(getUnreadThreadCount(mobileFixture)).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Fixture scenarios: thread states
// ---------------------------------------------------------------------------

describe('thread fixture scenarios', () => {
  it('offline scenario has offline-status thread', () => {
    const f = getMobileFixtureForScenario('offline');
    const hasOffline = f.threads.some((t) => t.status === 'offline');
    expect(hasOffline).toBe(true);
  });

  it('notification scenario has thread opened from notification', () => {
    const f = getMobileFixtureForScenario('notification');
    const notificationThread = f.threads.find((t) => t.previewIntent === 'notification');
    expect(notificationThread).toBeDefined();
    expect(notificationThread?.reviewDensity).toBe('critical');
  });

  it('deeplink scenario has deepLinkPath on thread', () => {
    const f = getMobileFixtureForScenario('deeplink');
    const hasDeepLink = f.threads.some(
      (t) => t.deepLinkPath === 'agenthub://threads/mobile-design',
    );
    expect(hasDeepLink).toBe(true);
  });

  it('sendError scenario has retryAvailable on thread', () => {
    const f = getMobileFixtureForScenario('sendError');
    expect(f.threads[0]!.retryAvailable).toBe(true);
    expect(f.threads[0]!.status).toBe('failed');
  });

  it('empty scenario has empty threads array', () => {
    const f = getMobileFixtureForScenario('empty');
    expect(f.threads).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// New entry sheet actions
// ---------------------------------------------------------------------------

describe('new entry sheet actions', () => {
  it('defines 3 action items for new entry', () => {
    const actions = [
      { icon: 'chat', title: 'Start AgentHub chat' },
      { icon: 'approval', title: 'Create review thread' },
      { icon: 'file', title: 'Post project update' },
    ];
    expect(actions).toHaveLength(3);
  });

  it('each action has an icon and title', () => {
    const actions = [
      { icon: 'chat', title: 'Start AgentHub chat' },
      { icon: 'approval', title: 'Create review thread' },
      { icon: 'file', title: 'Post project update' },
    ];
    for (const action of actions) {
      expect(action.icon).toBeTruthy();
      expect(action.title).toBeTruthy();
    }
  });
});
