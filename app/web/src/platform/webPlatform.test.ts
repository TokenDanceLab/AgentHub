import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '@shared/types';
import {
  agentInfoToWorkbenchAgent,
  createWebPlatform,
  hubSessionToWorkbenchConversation,
  resolveWebWorkbenchAgents,
  resolveWebWorkbenchConversations,
  webAgents,
  webConversations,
  webHubEmptyConversation,
} from './webPlatform';
import type { MessageResponse, SendMessageResponse } from '@/api/hubClient';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function hubMessages(queryClient: QueryClient, sessionId = 'hub-session-1'): MessageResponse[] {
  return queryClient.getQueryData<MessageResponse[]>(['web-v4', 'hub-messages', sessionId]) ?? [];
}

describe('webPlatform workbench agent mapping', () => {
  it('maps Hub AgentInfo into shared workbench agents', () => {
    const agent: AgentInfo = {
      id: 'agent-profile-1',
      name: 'Hub Builder',
      description: 'Runtime: claude-code - Model: glm-5.1',
      profileId: 'agent-profile-1',
      runtimeId: 'claude-code',
      model: 'glm-5.1',
      status: 'available',
      capabilities: {
        streaming: true,
        toolCalls: true,
        fileChanges: true,
        thinkingVisible: true,
        multiTurn: true,
        mcpIntegration: true,
        permissionHooks: true,
        subAgentSpawn: true,
      },
    };

    expect(agentInfoToWorkbenchAgent(agent)).toEqual({
      id: 'agent-profile-1',
      name: 'Hub Builder',
      description: 'Runtime: claude-code - Model: glm-5.1',
      runtimeId: 'claude-code',
      model: 'glm-5.1',
      status: 'available',
    });
  });

  it('keeps preview fallback agents until Hub profiles are available', () => {
    expect(resolveWebWorkbenchAgents(undefined)).toBe(webAgents);
    expect(resolveWebWorkbenchAgents([])).toBe(webAgents);
  });

  it('maps Hub sessions into shared workbench conversations', () => {
    expect(hubSessionToWorkbenchConversation({
      session_id: 'hub-session-1',
      type: 'group',
      name: '真实 Hub 会话',
      unread_count: 2,
      member_count: 3,
    })).toEqual({
      id: 'hub-session-1',
      title: '真实 Hub 会话',
      kind: 'group',
      subtitle: 'Hub group · 3 members',
      unreadCount: 2,
    });

    expect(resolveWebWorkbenchConversations(undefined, false)).toBe(webConversations);
    expect(resolveWebWorkbenchConversations([], true)).toEqual([webHubEmptyConversation]);
  });

  it('submits Hub session messages and triggers the mentioned runtime agent', async () => {
    const queryClient = new QueryClient();
    const hubClient = {
      sendMessage: vi.fn().mockResolvedValue({
        message_id: 'hub-message-1',
        seq_id: 12,
        created_at: '2026-06-07T00:00:00Z',
      }),
      triggerAgentTask: vi.fn().mockResolvedValue({
        id: 'task-1',
        agent_instance_id: 'agent-instance-1',
        triggered_by_user_id: 'user-1',
        trigger_message_id: 'hub-message-1',
        status: 'queued',
      }),
    };
    const platform = createWebPlatform({
      hubClient,
      queryClient,
      createClientMessageId: () => 'client-message-1',
      now: () => '2026-06-07T00:00:00Z',
    });

    await expect(platform.runs.submitComposerIntent({
      conversationId: 'hub-session-1',
      text: '继续 v4 clean rebuild',
      mode: 'code',
      mentions: [{
        id: 'profile-builder',
        label: 'Hub Builder',
        runtimeId: 'claude-code',
        model: 'glm-5.1',
      }],
      attachments: [{
        id: 'att-1',
        name: 'notes.md',
        source: 'browser',
        contentPreview: 'attachment context',
      }],
      approvalMode: 'workspace-write',
      workDir: 'D:\\Code\\TokenDance\\AgentHub',
    })).resolves.toEqual({ intentId: 'task-1' });

    expect(hubClient.sendMessage).toHaveBeenCalledWith('hub-session-1', {
      client_msg_id: 'client-message-1',
      content_type: 'text',
      content: expect.stringContaining('继续 v4 clean rebuild'),
    });
    const sentMessageBody = hubClient.sendMessage.mock.calls[0]?.[1];
    expect(sentMessageBody?.content).toContain('attachment context');
    expect(hubClient.triggerAgentTask).toHaveBeenCalledWith('hub-message-1', {
      agent_type: 'claude-code',
      model_params: expect.any(String),
    });
    const triggerOptions = hubClient.triggerAgentTask.mock.calls[0]?.[1];
    expect(JSON.parse(String(triggerOptions?.model_params))).toMatchObject({
      source: 'web-v4-workbench',
      mode: 'code',
      approval_mode: 'workspace-write',
      work_dir: 'D:\\Code\\TokenDance\\AgentHub',
      mentions: [{ id: 'profile-builder', label: 'Hub Builder', runtime_id: 'claude-code', model: 'glm-5.1' }],
      attachments: [{ id: 'att-1', name: 'notes.md', source: 'browser' }],
    });
    expect(hubMessages(queryClient)).toEqual([
      expect.objectContaining({
        id: 'hub-message-1',
        client_msg_id: 'client-message-1',
        seq_id: 12,
        content: expect.stringContaining('继续 v4 clean rebuild'),
      }),
    ]);
  });

  it('sends a Hub message without starting a task when no agent is mentioned', async () => {
    const hubClient = {
      sendMessage: vi.fn().mockResolvedValue({
        message_id: 'hub-message-2',
        seq_id: 13,
        created_at: '2026-06-07T00:00:00Z',
      }),
      triggerAgentTask: vi.fn(),
    };
    const platform = createWebPlatform({
      hubClient,
      createClientMessageId: () => 'client-message-2',
    });

    await expect(platform.runs.submitComposerIntent({
      conversationId: 'hub-session-1',
      text: '只发送 Hub 消息',
      mode: 'ask',
      mentions: [],
      attachments: [],
      approvalMode: 'suggest',
    })).resolves.toEqual({ intentId: 'hub-message-2' });

    expect(hubClient.sendMessage).toHaveBeenCalledWith('hub-session-1', {
      client_msg_id: 'client-message-2',
      content_type: 'text',
      content: '只发送 Hub 消息',
    });
    expect(hubClient.triggerAgentTask).not.toHaveBeenCalled();
  });

  it('adds a pending Hub message optimistically while sendMessage is in flight', async () => {
    const queryClient = new QueryClient();
    const send = deferred<SendMessageResponse>();
    const hubClient = {
      sendMessage: vi.fn(() => send.promise),
      triggerAgentTask: vi.fn(),
    };
    const platform = createWebPlatform({
      hubClient,
      queryClient,
      createClientMessageId: () => 'client-message-pending',
      now: () => '2026-06-07T00:00:01Z',
    });

    const submit = platform.runs.submitComposerIntent({
      conversationId: 'hub-session-1',
      text: '乐观显示消息',
      mode: 'ask',
      mentions: [],
      attachments: [],
      approvalMode: 'suggest',
    });

    expect(hubMessages(queryClient)).toEqual([
      expect.objectContaining({
        id: 'client-message-pending',
        client_msg_id: 'client-message-pending',
        seq_id: Number.MAX_SAFE_INTEGER,
        sender_type: 'user',
        content: '乐观显示消息',
        created_at: '2026-06-07T00:00:01Z',
      }),
    ]);

    send.resolve({
      message_id: 'hub-message-confirmed',
      seq_id: 21,
      created_at: '2026-06-07T00:00:02Z',
    });
    await expect(submit).resolves.toEqual({ intentId: 'hub-message-confirmed' });
    expect(hubMessages(queryClient)).toEqual([
      expect.objectContaining({
        id: 'hub-message-confirmed',
        client_msg_id: 'client-message-pending',
        seq_id: 21,
        content: '乐观显示消息',
        created_at: '2026-06-07T00:00:02Z',
      }),
    ]);
  });

  it('removes the optimistic Hub message when sendMessage fails', async () => {
    const queryClient = new QueryClient();
    const hubClient = {
      sendMessage: vi.fn().mockRejectedValue(new Error('send failed')),
      triggerAgentTask: vi.fn(),
    };
    const platform = createWebPlatform({
      hubClient,
      queryClient,
      createClientMessageId: () => 'client-message-failed',
      now: () => '2026-06-07T00:00:03Z',
    });

    await expect(platform.runs.submitComposerIntent({
      conversationId: 'hub-session-1',
      text: '发送失败要回滚',
      mode: 'ask',
      mentions: [],
      attachments: [],
      approvalMode: 'suggest',
    })).rejects.toThrow('send failed');

    expect(hubMessages(queryClient)).toEqual([]);
    expect(hubClient.triggerAgentTask).not.toHaveBeenCalled();
  });

  it('keeps the confirmed Hub message when task dispatch fails after sending', async () => {
    const queryClient = new QueryClient();
    const hubClient = {
      sendMessage: vi.fn().mockResolvedValue({
        message_id: 'hub-message-dispatch-failed',
        seq_id: 31,
        created_at: '2026-06-07T00:00:04Z',
      }),
      triggerAgentTask: vi.fn().mockRejectedValue(new Error('task dispatch failed')),
    };
    const platform = createWebPlatform({
      hubClient,
      queryClient,
      createClientMessageId: () => 'client-message-dispatch-failed',
      now: () => '2026-06-07T00:00:03Z',
    });

    await expect(platform.runs.submitComposerIntent({
      conversationId: 'hub-session-1',
      text: '消息已发送但任务失败',
      mode: 'code',
      mentions: [{ id: 'profile-builder', label: 'Hub Builder', runtimeId: 'claude-code' }],
      attachments: [],
      approvalMode: 'suggest',
    })).rejects.toThrow('task dispatch failed');

    expect(hubMessages(queryClient)).toEqual([
      expect.objectContaining({
        id: 'hub-message-dispatch-failed',
        client_msg_id: 'client-message-dispatch-failed',
        seq_id: 31,
        content: '消息已发送但任务失败',
      }),
    ]);
  });

  it('rejects runtime-less agent mentions before sending a Hub message', async () => {
    const hubClient = {
      sendMessage: vi.fn(),
      triggerAgentTask: vi.fn(),
    };
    const platform = createWebPlatform({
      hubClient,
      createClientMessageId: () => 'client-message-3',
    });

    await expect(platform.runs.submitComposerIntent({
      conversationId: 'hub-session-1',
      text: '调度未配置 Agent',
      mode: 'code',
      mentions: [{ id: 'profile-configuring', label: 'Configuring Agent' }],
      attachments: [],
      approvalMode: 'suggest',
    })).rejects.toThrow(/missing a runtime id/);

    expect(hubClient.sendMessage).not.toHaveBeenCalled();
    expect(hubClient.triggerAgentTask).not.toHaveBeenCalled();
  });
});
