import { describe, expect, it } from 'vitest';

import { getPendingReviewCount, getThreadRun, getUnreadThreadCount, mobileFixture } from './mobileFixtures';

describe('Mobile workflow fixtures', () => {
  it('cover core surfaces and non-empty workflow states', () => {
    expect(mobileFixture.threads.map((thread) => thread.id)).toContain('mobile-design');
    expect(mobileFixture.runs.map((run) => run.status)).toContain('approval_required');
    expect(mobileFixture.account.hubSession).toBe('expired');
  });

  it('computes mobile badges from workflow state', () => {
    expect(getPendingReviewCount(mobileFixture)).toBe(1);
    expect(getUnreadThreadCount(mobileFixture)).toBe(5);
    expect(getThreadRun(mobileFixture, 'mobile-design')?.id).toBe('run-mobile-design');
  });
});
