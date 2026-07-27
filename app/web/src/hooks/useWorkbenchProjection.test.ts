/**
 * Successor coverage for the deleted useWorkbenchProjection hook.
 * Projection now lives in platform helpers consumed by useWebWorkbenchModel.
 */
import { describe, expect, it } from 'vitest';
import { resolveWebWorkbenchConversations } from '@/platform/webPlatformMapping';
import { resolveWebWorkbenchTranscript } from '@/platform/webWorkbenchTranscript';
import { webHubEmptyConversation, webHubEmptyTranscript } from '@/platform/webPlatformFixtures';
import type { Session } from '@/api/hubClient';

const hubSession = {
  id: 'hub-session-1',
  type: 'group',
  name: 'Agent 协作',
  member_count: 3,
} as Session;

describe('useWorkbenchProjection successors', () => {
  it('projects empty Hub conversation shell in real mode when signed out', () => {
    expect(resolveWebWorkbenchConversations(undefined, false, 'approved-real')).toEqual([
      webHubEmptyConversation,
    ]);
    expect(resolveWebWorkbenchTranscript(false, null, undefined, [], 'approved-real')).toEqual(
      webHubEmptyTranscript,
    );
  });

  it('projects empty Hub conversation shell when authenticated but sessions are empty', () => {
    expect(resolveWebWorkbenchConversations([], true, 'approved-real')).toEqual([
      webHubEmptyConversation,
    ]);
    expect(resolveWebWorkbenchConversations(undefined, true, 'approved-real')).toEqual([
      webHubEmptyConversation,
    ]);
  });

  it('maps Hub sessions into workbench conversations when Hub is ready', () => {
    const conversations = resolveWebWorkbenchConversations([hubSession], true, 'approved-real');
    expect(conversations).toEqual([
      expect.objectContaining({
        id: 'hub-session-1',
        title: 'Agent 协作',
      }),
    ]);
  });

  it('keeps empty transcript for real mode without an active Hub session (no demo fallback)', () => {
    expect(
      resolveWebWorkbenchTranscript(true, null, undefined, [], 'approved-real', 'hub-session-1'),
    ).toEqual(webHubEmptyTranscript);
  });

  it('projects Hub messages into transcript when an active session is present', () => {
    const transcript = resolveWebWorkbenchTranscript(
      true,
      'hub-session-1',
      [
        {
          id: 'msg-1',
          session_id: 'hub-session-1',
          seq_id: 1,
          sender_type: 'user',
          sender_id: 'user-1',
          sender: { nickname: 'Alice' },
          content: { text: 'hello from hub' },
          created_at: '2026-07-27T00:00:00Z',
        },
      ],
      [],
      'approved-real',
    );

    expect(transcript.some((block) => block.kind === 'text' && 'text' in block && block.text.includes('hello from hub'))).toBe(true);
  });

  it('does not invent Hub conversations from fixture mode when Hub auth is missing', () => {
    // fixture/demo may show local demo conversations, but never pretends they are Hub sessions.
    const conversations = resolveWebWorkbenchConversations(undefined, false, 'fixture');
    expect(conversations.every((item) => item.id !== 'hub-session-1')).toBe(true);
  });
});
