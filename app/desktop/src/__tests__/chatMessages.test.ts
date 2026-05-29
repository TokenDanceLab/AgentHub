import { describe, expect, it } from 'vitest';

import {
  applyRuntimeAgentLabel,
  buildChatMessagesFromThreadItems,
  buildRunReplayFallbackMessages,
  mergeChatMessages,
} from '@/utils/chatMessages';
import type { ChatMessage } from '@/components/ChatView.types';

describe('chat message projection', () => {
  it('projects persisted Edge user_message items into user bubbles', () => {
    const messages = buildChatMessagesFromThreadItems([
      {
        itemId: 'item_1',
        threadId: 'thread_local',
        type: 'user_message',
        role: 'user',
        content: '用户输入去哪了',
        createdAt: '2026-05-28T10:05:54Z',
      },
      {
        itemId: 'item_run',
        threadId: 'thread_local',
        type: 'run',
        status: 'queued',
        createdAt: '2026-05-28T10:05:54Z',
      },
    ]);

    expect(messages).toEqual([
      {
        id: 'thread-item-item_1',
        role: 'user',
        timestamp: '2026-05-28T10:05:54Z',
        blocks: [{ kind: 'text', content: '用户输入去哪了' }],
      },
    ]);
  });

  it('keeps persisted user messages before live agent messages', () => {
    const persisted = buildChatMessagesFromThreadItems([
      {
        itemId: 'item_user',
        threadId: 'thread_local',
        type: 'user_message',
        role: 'user',
        content: '你是谁？',
        createdAt: '2026-05-28T10:05:54Z',
      },
    ]);
    const live: ChatMessage[] = [
      {
        id: 'agent-run-1',
        role: 'agent',
        timestamp: '2026-05-28T10:05:56Z',
        blocks: [{ kind: 'text', content: '我是 AgentHub Desktop。' }],
      },
    ];

    expect(mergeChatMessages({ persisted, live }).map((msg) => msg.id)).toEqual([
      'thread-item-item_user',
      'agent-run-1',
    ]);
  });

  it('drops an optimistic user bubble once the same persisted message arrives', () => {
    const persisted = buildChatMessagesFromThreadItems([
      {
        itemId: 'item_user',
        threadId: 'thread_local',
        type: 'user_message',
        role: 'user',
        content: 'same prompt',
        createdAt: '2026-05-28T10:05:54Z',
      },
    ]);
    const optimistic: ChatMessage[] = [
      {
        id: 'user-starting-1',
        role: 'user',
        timestamp: '2026-05-28T10:05:53Z',
        blocks: [{ kind: 'text', content: 'same prompt' }],
      },
    ];

    expect(mergeChatMessages({ persisted, optimistic })).toHaveLength(1);
    expect(mergeChatMessages({ persisted, optimistic })[0].id).toBe('thread-item-item_user');
  });

  it('prefers live agent rendering over persisted transcript for the same run', () => {
    const persisted = buildChatMessagesFromThreadItems([
      {
        itemId: 'item_agent',
        threadId: 'thread_local',
        runId: 'run_1',
        type: 'agent_message',
        role: 'agent',
        content: 'green-842',
        createdAt: '2026-05-28T10:05:56Z',
      },
    ]);
    const live: ChatMessage[] = [
      {
        id: 'evt_live_agent',
        role: 'agent',
        parentId: 'run_1',
        timestamp: '2026-05-28T10:05:56Z',
        blocks: [
          { kind: 'thinking', content: 'checking memory' },
          { kind: 'text', content: 'green-842' },
        ],
      },
    ];

    const merged = mergeChatMessages({ persisted, live });

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('evt_live_agent');
    expect(merged[0].blocks.map((block) => block.kind)).toEqual(['thinking', 'text']);
  });

  it('projects terminal runs without persisted agent transcript into explicit replay fallback rows', () => {
    const fallback = buildRunReplayFallbackMessages(
      [
        {
          itemId: 'item_user',
          type: 'user_message',
          role: 'user',
          content: 'why did the answer disappear?',
          createdAt: '2026-05-28T10:33:50Z',
        },
        {
          itemId: 'item_run',
          runId: 'run_missing',
          type: 'run',
          status: 'queued',
          createdAt: '2026-05-28T10:33:50Z',
        },
      ],
      [
        {
          runId: 'run_missing',
          status: 'finished',
          createdAt: '2026-05-28T10:33:50Z',
          finishedAt: '2026-05-28T10:33:57Z',
        },
      ],
      {
        agentName: 'Codex',
        statusLabel: (status) => `status:${status}`,
        content: ({ runId, statusLabel }) => `No replayable output for ${runId} (${statusLabel}).`,
      },
    );

    expect(fallback).toEqual([
      {
        id: 'run-replay-fallback-run_missing',
        role: 'agent',
        timestamp: '2026-05-28T10:33:57Z',
        parentId: 'run_missing',
        agentName: 'Codex',
        blocks: [{ kind: 'text', content: 'No replayable output for run_missing (status:finished).' }],
      },
    ]);
  });

  it('does not add replay fallback when the run already has an agent transcript', () => {
    const fallback = buildRunReplayFallbackMessages(
      [
        {
          itemId: 'item_run',
          runId: 'run_has_agent',
          type: 'run',
          status: 'queued',
          createdAt: '2026-05-28T10:33:50Z',
        },
        {
          itemId: 'item_agent',
          runId: 'run_has_agent',
          type: 'agent_message',
          role: 'agent',
          content: 'USER-BUBBLE-528',
          createdAt: '2026-05-28T10:33:57Z',
        },
      ],
      [
        {
          runId: 'run_has_agent',
          status: 'finished',
          createdAt: '2026-05-28T10:33:50Z',
          finishedAt: '2026-05-28T10:33:57Z',
        },
      ],
    );

    expect(fallback).toEqual([]);
  });

  it('uses the selected runtime label instead of inner model labels for live agent rows', () => {
    const messages: ChatMessage[] = [
      {
        id: 'live-agent',
        role: 'agent',
        parentId: 'run_orch',
        agentName: 'claude-opus-4-7[1M]',
        timestamp: '2026-05-28T10:05:56Z',
        blocks: [{ kind: 'text', content: 'ok' }],
      },
      {
        id: 'child-agent',
        role: 'agent',
        parentId: 'run_child',
        agentName: 'Research worker',
        timestamp: '2026-05-28T10:05:57Z',
        blocks: [{ kind: 'text', content: 'done' }],
      },
    ];

    expect(applyRuntimeAgentLabel(messages, 'Orchestrator')).toEqual([
      {
        ...messages[0],
        agentName: 'Orchestrator',
      },
      messages[1],
    ]);
  });
});
