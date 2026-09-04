/**
 * Successor coverage for the deleted useHubIMSnapshot hook.
 * IM snapshot projection now flows through workbench contacts/conversations helpers
 * and contact query fail-closed gates.
 */
import { describe, expect, it } from 'vitest';
import { resolveWebWorkbenchContacts } from '@/platform/useWebWorkbenchModel';
import { resolveWebWorkbenchConversations } from '@/platform/webPlatformMapping';
import { webHubEmptyConversation } from '@/platform/webPlatformFixtures';
import { resolveWebSessionLastReadSeq } from '@/platform/useWebWorkbenchModel';

describe('useHubIMSnapshot successors', () => {
  it('returns empty contact snapshot in real mode when Hub is not ready (fail-closed)', () => {
    expect(resolveWebWorkbenchContacts(undefined, false, 'approved-real')).toMatchObject({
      members: [],
      recentShortcuts: [],
    });
  });

  it('drops stale Hub contacts when readiness is lost (disconnect / signed-out)', () => {
    expect(resolveWebWorkbenchContacts([
      {
        user_id: 'user-1',
        username: 'alice',
        nickname: 'Alice',
        online: true,
        type: 'internal',
      },
    ], false, 'approved-real')).toMatchObject({
      members: [],
      recentShortcuts: [],
    });
  });

  it('projects Hub contacts when Hub IM snapshot is ready', () => {
    expect(resolveWebWorkbenchContacts([
      {
        user_id: 'user-1',
        username: 'alice',
        nickname: 'Alice Zhang',
        remark: '产品',
        online: true,
        type: 'internal',
      },
      {
        user_id: 'user-2',
        username: 'bob',
        nickname: 'Bob',
        online: false,
        type: 'external',
      },
    ], true, 'approved-real')).toMatchObject({
      members: [
        expect.objectContaining({ id: 'user-1', name: '产品' }),
        expect.objectContaining({ id: 'user-2', name: 'Bob' }),
      ],
      recentShortcuts: ['产品', 'Bob'],
    });
  });

  it('projects empty session list into Hub empty conversation shell (no fake IM threads)', () => {
    expect(resolveWebWorkbenchConversations([], true, 'approved-real')).toEqual([
      webHubEmptyConversation,
    ]);
  });

  it('does not advance last-read seq on empty or placeholder message snapshots', () => {
    expect(resolveWebSessionLastReadSeq(true, [{ id: 'm1', seq_id: 9 } as never])).toBeNull();
    expect(resolveWebSessionLastReadSeq(false, [])).toBeNull();
    expect(resolveWebSessionLastReadSeq(false, undefined)).toBeNull();
  });

  it('reads last-read seq from the newest real message after reconnect snapshot settles', () => {
    expect(resolveWebSessionLastReadSeq(false, [
      { id: 'm1', seq_id: 3 },
      { id: 'm2', seq_id: 7 },
    ] as never)).toBe(7);
  });
});
