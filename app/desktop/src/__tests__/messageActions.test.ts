import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/components/ChatView.types';
import { buildForkDraft, findRetryPrompt } from '@/utils/messageActions';

function message(id: string, role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id,
    role,
    timestamp: `2026-05-29T00:00:0${id.length}Z`,
    blocks: [{ kind: 'text', content }],
  };
}

describe('messageActions', () => {
  it('retries the selected user message directly', () => {
    const messages = [
      message('u1', 'user', 'first prompt'),
      message('a1', 'agent', 'first answer'),
      message('u2', 'user', 'second prompt'),
    ];

    expect(findRetryPrompt(messages, 'u1')).toEqual({
      prompt: 'first prompt',
      sourceMessageId: 'u1',
    });
  });

  it('retries an agent answer by using the nearest preceding user prompt', () => {
    const messages = [
      message('u1', 'user', 'first prompt'),
      message('a1', 'agent', 'first answer'),
      message('u2', 'user', 'second prompt'),
      message('a2', 'agent', 'second answer'),
    ];

    expect(findRetryPrompt(messages, 'a2')).toEqual({
      prompt: 'second prompt',
      sourceMessageId: 'u2',
    });
  });

  it('builds a fork draft from the scoped conversation context', () => {
    const messages = [
      message('u1', 'user', 'first prompt'),
      message('a1', 'agent', 'first answer'),
      message('u2', 'user', 'second prompt'),
      message('a2', 'agent', 'second answer'),
    ];

    expect(buildForkDraft({
      sourceTitle: 'Local Thread',
      sourceThreadId: 'thread_local',
      messages,
      messageId: 'a2',
    })).toContain('Forked from: Local Thread (thread_local)');
    expect(buildForkDraft({
      sourceTitle: 'Local Thread',
      sourceThreadId: 'thread_local',
      messages,
      messageId: 'a2',
    })).toContain('second prompt');
  });
});
