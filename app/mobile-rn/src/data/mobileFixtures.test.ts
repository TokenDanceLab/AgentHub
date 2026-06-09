import { describe, expect, it } from 'vitest';

import type { MobileFixtureScenario } from '@/types';

import {
  getMobileFixtureForScenario,
  getPendingReviewCount,
  getThreadRun,
  getUnreadThreadCount,
  mobileFixture,
} from './mobileFixtures';

describe('Mobile workflow fixtures', () => {
  it('cover core surfaces and non-empty workflow states', () => {
    expect(mobileFixture.threads.map((thread) => thread.id)).toContain('mobile-design');
    expect(mobileFixture.runs.map((run) => run.status)).toContain('approval_required');
    expect(mobileFixture.account.hubSession).toBe('active');
    expect(mobileFixture.threads.length).toBeGreaterThanOrEqual(8);
    expect(mobileFixture.runs).toHaveLength(3);
    expect(Object.keys(mobileFixture.transcript)).toHaveLength(3);
  });

  it('computes mobile badges from workflow state', () => {
    expect(getPendingReviewCount(mobileFixture)).toBe(1);
    expect(getUnreadThreadCount(mobileFixture)).toBe(7);
    expect(getThreadRun(mobileFixture, 'mobile-design')?.id).toBe('run-mobile-design');
  });

  it('returns the exported fixture for the default scenario', () => {
    expect(getMobileFixtureForScenario('default')).toBe(mobileFixture);
  });

  it('covers every preview fixture scenario shape', () => {
    const scenarios: MobileFixtureScenario[] = [
      'default',
      'empty',
      'offline',
      'notification',
      'deeplink',
      'sendError',
      'sendPending',
      'approvalPending',
      'approvalError',
      'approvalResolved',
      'diffPreview',
      'previewMatrix',
    ];

    const fixtures = Object.fromEntries(
      scenarios.map((scenario) => [scenario, getMobileFixtureForScenario(scenario)]),
    ) as Record<MobileFixtureScenario, typeof mobileFixture>;

    expect(fixtures.empty.account).toMatchObject({
      tokenDanceId: 'signed_in',
      hubSession: 'active',
      notification: 'prompt',
      hubSync: 'active',
    });
    expect(fixtures.empty.threads).toHaveLength(0);
    expect(fixtures.empty.runs).toHaveLength(0);
    expect(fixtures.empty.transcript).toEqual({});

    expect(fixtures.offline.threads).not.toHaveLength(0);
    expect(fixtures.offline.account.hubSync).toBe('offline');
    expect(fixtures.offline.account.hubSession).toBe('missing');
    expect(fixtures.offline.threads.some((thread) => thread.status === 'offline')).toBe(true);

    expect(fixtures.notification.account.notification).toBe('granted');
    expect(fixtures.notification.runs.some((run) => run.previewIntent === 'notification')).toBe(true);
    expect(fixtures.notification.threads.some((thread) => thread.previewIntent === 'notification')).toBe(true);

    expect(fixtures.deeplink.threads.some((thread) => thread.deepLinkPath === 'agenthub://threads/mobile-design')).toBe(true);
    expect(fixtures.deeplink.runs.some((run) => run.deepLinkPath === 'agenthub://runs/run-mobile-design')).toBe(true);

    expect(fixtures.sendError.account.hubSession).toBe('active');
    expect(fixtures.sendError.runs.some((run) => run.status === 'failed' && run.previewIntent === 'sendError')).toBe(true);
    expect(fixtures.sendError.threads.some((thread) => thread.status === 'failed' && thread.retryAvailable)).toBe(true);

    expect(fixtures.sendPending.account.hubSync).toBe('active');
    expect(fixtures.sendPending.runs.some((run) => run.status === 'running' && run.previewIntent === 'sendPending')).toBe(true);
    expect(fixtures.sendPending.threads.some((thread) => thread.status === 'running' && thread.previewIntent === 'sendPending')).toBe(true);

    expect(fixtures.approvalPending.runs.some((run) => run.status === 'approval_required')).toBe(true);
    expect(fixtures.approvalPending.runs.some((run) => run.approvalRisk === 'medium')).toBe(true);

    expect(fixtures.approvalError.account.hubSession).toBe('expired');
    expect(fixtures.approvalError.runs.some((run) => run.previewIntent === 'approvalError' && run.retryAvailable)).toBe(true);
    expect(JSON.stringify(fixtures.approvalError)).not.toMatch(/Bearer|token=|stack trace|raw server response/i);

    expect(fixtures.approvalResolved.runs.some((run) => run.status === 'completed' && run.previewIntent === 'approvalResolved')).toBe(true);
    expect(
      fixtures.approvalResolved.transcript['approval-resolved-chat']?.some(
        (block) => block.kind === 'approval' && block.status === 'completed',
      ),
    ).toBe(true);

    expect(fixtures.diffPreview.runs.some((run) => run.changedFiles.length >= 7)).toBe(true);
    expect(
      fixtures.diffPreview.transcript['diff-preview-chat']?.some(
        (block) => block.kind === 'diff' && block.lines && block.lines.length >= 6,
      ),
    ).toBe(true);

    const fixtureText = JSON.stringify(fixtures);
    expect(fixtureText).toContain('Delicious233');
    expect(fixtureText).toContain('TokenDance');
    expect(fixtureText).toContain('AgentHub');
  });
});
