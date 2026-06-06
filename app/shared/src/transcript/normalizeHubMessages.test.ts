import { describe, expect, it } from 'vitest';
import { normalizeHubMessagesToTranscript } from './normalizeHubMessages';

describe('normalizeHubMessagesToTranscript', () => {
  it('projects Hub session messages into shared transcript blocks', () => {
    const blocks = normalizeHubMessagesToTranscript([
      {
        id: 'message-agent',
        session_id: 'session-1',
        seq_id: 2,
        sender_type: 'agent',
        sender_id: 'agent-1',
        sender: { nickname: 'Hub Builder' },
        content: '{"text":"来自 Hub Agent 的回复"}',
        created_at: '2026-06-07T07:00:02Z',
      },
      {
        id: 'message-user',
        session_id: 'session-1',
        seq_id: 1,
        sender_type: 'user',
        sender_id: 'user-1',
        sender: { nickname: 'Delicious233' },
        content: { text: '从 Hub session 发来的消息' },
        created_at: '2026-06-07T07:00:01Z',
      },
    ]);

    expect(blocks).toEqual([
      {
        id: 'hub-message-message-user',
        author: { id: 'user-1', name: 'Delicious233', role: 'human' },
        kind: 'text',
        text: '从 Hub session 发来的消息',
      },
      {
        id: 'hub-message-message-agent',
        author: { id: 'agent-1', name: 'Hub Builder', role: 'agent' },
        kind: 'text',
        text: '来自 Hub Agent 的回复',
      },
    ]);
  });

  it('handles recalled and empty Hub messages without crashing', () => {
    const blocks = normalizeHubMessagesToTranscript([
      {
        session_id: 'session-1',
        seq_id: 3,
        sender_type: 'system',
        recalled: true,
        content: 'hidden',
      },
      {
        id: 'empty-message',
        sender_type: 'user',
        content: '   ',
      },
    ]);

    expect(blocks).toEqual([
      {
        id: 'hub-message-session-1-3',
        author: { id: 'hub-system', name: 'AgentHub', role: 'system' },
        kind: 'text',
        text: '消息已撤回',
      },
    ]);
  });
});
