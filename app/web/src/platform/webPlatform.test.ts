import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { createWorkbenchDemoRuntimeStore } from '@shared/demo';
import type { AgentInfo } from '@shared/types';
import {
  agentInfoToWorkbenchAgent,
  createWebPlatform,
  hubSessionToWorkbenchConversation,
  resolveWebWorkbenchAgents,
  resolveWebWorkbenchConversations,
  webConversationWithPinnedMessages,
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
      provider: 'zhipu',
      model: 'glm-5.1',
      approvalPolicy: 'on-request',
      permissionMode: 'workspace-write',
      reasoningEffort: 'high',
      skills: ['Code', 'Review'],
      toolAllowlist: ['Read File'],
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
      provider: 'zhipu',
      model: 'glm-5.1',
      approvalPolicy: 'on-request',
      permissionMode: 'workspace-write',
      reasoningEffort: 'high',
      skills: ['Code', 'Review'],
      toolAllowlist: ['Read File'],
      status: 'available',
    });
  });

  it('keeps preview fallback agents until Hub profiles are available in demo-capable modes', () => {
    expect(resolveWebWorkbenchAgents(undefined)).toBe(webAgents);
    expect(resolveWebWorkbenchAgents([])).toBe(webAgents);
  });

  it('does not fall back to demo agents in real mode', () => {
    expect(resolveWebWorkbenchAgents(undefined, 'real')).toEqual([]);
    expect(resolveWebWorkbenchAgents([], 'real')).toEqual([]);
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
    expect(resolveWebWorkbenchConversations(undefined, false, 'real')).toEqual([webHubEmptyConversation]);
    expect(resolveWebWorkbenchConversations([], true)).toEqual([webHubEmptyConversation]);
  });

  it('maps Hub pinned messages into the active workbench conversation', () => {
    const conversation = {
      id: 'hub-session-1',
      title: '真实 Hub 会话',
      kind: 'group' as const,
      pinnedAnnouncement: {
        title: 'stale',
        content: 'stale pin',
      },
    };

    expect(webConversationWithPinnedMessages(conversation, [{
      id: 'message-pin-1',
      session_id: 'hub-session-1',
      seq_id: 2,
      client_msg_id: 'client-pin-1',
      sender_type: 'user',
      sender_id: 'delicious233',
      content_type: 'text',
      content: 'Hub 会话自己的置顶',
      created_at: '2026-06-07T06:49:00Z',
    }])).toMatchObject({
      id: 'hub-session-1',
      pinnedAnnouncement: {
        title: '真实 Hub 会话',
        content: 'Hub 会话自己的置顶',
        author: 'delicious233',
        sourceId: 'message-pin-1',
      },
    });

    expect(webConversationWithPinnedMessages(conversation, [])).not.toHaveProperty('pinnedAnnouncement');
  });

  it('routes auto unauthenticated submits into the demo runtime store', async () => {
    const demoRuntimeStore = createWorkbenchDemoRuntimeStore();
    const platform = createWebPlatform({
      demoRuntimeStore,
    });

    await expect(platform.runs.submitComposerIntent({
      conversationId: 'builder',
      text: '验证 demo runtime 写入',
      mode: 'ask',
      mentions: [],
      attachments: [],
      approvalMode: 'suggest',
    })).resolves.toEqual({ intentId: expect.stringMatching(/^demo-agent-/) });

    expect(demoRuntimeStore.resolveTranscript('builder')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        author: expect.objectContaining({ role: 'human' }),
        text: '验证 demo runtime 写入',
      }),
      expect.objectContaining({
        author: expect.objectContaining({ name: 'AgentHub Demo' }),
        displayTitle: 'Demo 模式已记录输入',
      }),
    ]));
  });

  it('opens the auth guard instead of silently using demo fallback when the Web root mounts auth', async () => {
    localStorage.clear();
    sessionStorage.clear();
    const demoRuntimeStore = createWorkbenchDemoRuntimeStore();
    const ensureAuth = vi.fn(() => false);
    const hubClient = {
      addAgentToSession: vi.fn(),
      sendMessage: vi.fn(),
      triggerAgentTask: vi.fn(),
    };
    const platform = createWebPlatform({
      demoRuntimeStore,
      ensureAuth,
      hubClient,
    });

    await expect(platform.runs.submitComposerIntent({
      conversationId: 'builder',
      text: '需要登录后才能进入真实 Hub 路径',
      mode: 'ask',
      mentions: [],
      attachments: [],
      approvalMode: 'suggest',
    })).rejects.toThrow('Hub authentication is required');

    expect(ensureAuth).toHaveBeenCalledTimes(1);
    expect(hubClient.sendMessage).not.toHaveBeenCalled();
    expect(demoRuntimeStore.resolveTranscript('builder')).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        author: expect.objectContaining({ role: 'human' }),
        text: '需要登录后才能进入真实 Hub 路径',
      }),
    ]));
  });

  it('submits Hub session messages and triggers the mentioned runtime agent', async () => {
    const queryClient = new QueryClient();
    const hubClient = {
      addAgentToSession: vi.fn().mockResolvedValue({
        id: 'agent-instance-1',
        agent_type: 'claude-code',
        session_id: 'hub-session-1',
        inviter_user_id: 'user-1',
        display_name: 'Hub Builder',
      }),
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
      listExecutionTargets: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'target-offline',
            name: 'Offline Desktop Edge',
            target_type: 'local_edge',
            health_state: 'offline',
            is_online: false,
          },
          {
            id: 'target-local-edge-1',
            name: 'Online Desktop Edge',
            target_type: 'local_edge',
            health_state: 'healthy',
            is_online: true,
          },
        ],
        page: { hasMore: false },
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
    expect(hubClient.addAgentToSession).toHaveBeenCalledWith('hub-session-1', {
      agent_type: 'claude-code',
      display_name: 'Hub Builder',
    });
    expect(hubClient.listExecutionTargets).toHaveBeenCalledWith({
      target_type: 'local_edge',
      pageSize: 50,
    });
    expect(hubClient.triggerAgentTask).toHaveBeenCalledWith('hub-message-1', {
      agent_instance_id: 'agent-instance-1',
      target_id: 'target-local-edge-1',
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

  it('reuses the cached exact Hub agent instance for repeated profile mentions', async () => {
    const queryClient = new QueryClient();
    const hubClient = {
      addAgentToSession: vi.fn().mockResolvedValue({
        id: 'agent-instance-cached',
        agent_type: 'claude-code',
        session_id: 'hub-session-1',
        inviter_user_id: 'user-1',
        display_name: 'Hub Builder',
      }),
      sendMessage: vi.fn()
        .mockResolvedValueOnce({
          message_id: 'hub-message-cached-1',
          seq_id: 41,
          created_at: '2026-06-07T00:00:05Z',
        })
        .mockResolvedValueOnce({
          message_id: 'hub-message-cached-2',
          seq_id: 42,
          created_at: '2026-06-07T00:00:06Z',
        }),
      triggerAgentTask: vi.fn().mockResolvedValue({
        id: 'task-cached',
        agent_instance_id: 'agent-instance-cached',
        triggered_by_user_id: 'user-1',
        trigger_message_id: 'hub-message-cached-1',
        status: 'queued',
      }),
      listExecutionTargets: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'target-local-edge-cached',
            name: 'Online Desktop Edge',
            target_type: 'local_edge',
            health_state: 'healthy',
            is_online: true,
          },
        ],
        page: { hasMore: false },
      }),
    };
    const platform = createWebPlatform({
      hubClient,
      queryClient,
      createClientMessageId: vi.fn()
        .mockReturnValueOnce('client-message-cached-1')
        .mockReturnValueOnce('client-message-cached-2'),
    });
    const baseIntent = {
      conversationId: 'hub-session-1',
      mode: 'code' as const,
      mentions: [{ id: 'profile-builder', label: 'Hub Builder', runtimeId: 'claude-code' }],
      attachments: [],
      approvalMode: 'suggest' as const,
    };

    await platform.runs.submitComposerIntent({ ...baseIntent, text: '第一次触发' });
    await platform.runs.submitComposerIntent({ ...baseIntent, text: '第二次触发' });

    expect(hubClient.addAgentToSession).toHaveBeenCalledTimes(1);
    expect(hubClient.triggerAgentTask).toHaveBeenNthCalledWith(1, 'hub-message-cached-1', {
      agent_instance_id: 'agent-instance-cached',
      target_id: 'target-local-edge-cached',
      model_params: expect.any(String),
    });
    expect(hubClient.triggerAgentTask).toHaveBeenNthCalledWith(2, 'hub-message-cached-2', {
      agent_instance_id: 'agent-instance-cached',
      target_id: 'target-local-edge-cached',
      model_params: expect.any(String),
    });
  });

  it('sends a Hub message without starting a task when no agent is mentioned', async () => {
    const hubClient = {
      addAgentToSession: vi.fn(),
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
    expect(hubClient.addAgentToSession).not.toHaveBeenCalled();
  });

  it('adds a pending Hub message optimistically while sendMessage is in flight', async () => {
    const queryClient = new QueryClient();
    const send = deferred<SendMessageResponse>();
    const hubClient = {
      addAgentToSession: vi.fn(),
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
      addAgentToSession: vi.fn(),
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
      addAgentToSession: vi.fn().mockResolvedValue({
        id: 'agent-instance-dispatch-failed',
        agent_type: 'claude-code',
        session_id: 'hub-session-1',
        inviter_user_id: 'user-1',
        display_name: 'Hub Builder',
      }),
      sendMessage: vi.fn().mockResolvedValue({
        message_id: 'hub-message-dispatch-failed',
        seq_id: 31,
        created_at: '2026-06-07T00:00:04Z',
      }),
      triggerAgentTask: vi.fn().mockRejectedValue(new Error('task dispatch failed')),
      listExecutionTargets: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'target-local-edge-dispatch-failed',
            name: 'Online Desktop Edge',
            target_type: 'local_edge',
            health_state: 'healthy',
            is_online: true,
          },
        ],
        page: { hasMore: false },
      }),
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
    expect(hubClient.triggerAgentTask).toHaveBeenCalledWith('hub-message-dispatch-failed', {
      agent_instance_id: 'agent-instance-dispatch-failed',
      target_id: 'target-local-edge-dispatch-failed',
      model_params: expect.any(String),
    });
  });

  it('rejects real Hub agent task dispatch when no online local_edge target is available', async () => {
    const hubClient = {
      addAgentToSession: vi.fn().mockResolvedValue({
        id: 'agent-instance-no-target',
        agent_type: 'claude-code',
        session_id: 'hub-session-1',
        inviter_user_id: 'user-1',
        display_name: 'Hub Builder',
      }),
      sendMessage: vi.fn().mockResolvedValue({
        message_id: 'hub-message-no-target',
        seq_id: 50,
        created_at: '2026-06-07T00:00:07Z',
      }),
      triggerAgentTask: vi.fn(),
      listExecutionTargets: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'target-relay-1',
            name: 'Hub Relay',
            target_type: 'hub_relay',
            health_state: 'healthy',
            is_online: true,
          },
        ],
        page: { hasMore: false },
      }),
    };
    const platform = createWebPlatform({
      hubClient,
      createClientMessageId: () => 'client-message-no-target',
    });

    await expect(platform.runs.submitComposerIntent({
      conversationId: 'hub-session-1',
      text: '需要本机 Edge 目标',
      mode: 'code',
      mentions: [{ id: 'profile-builder', label: 'Hub Builder', runtimeId: 'claude-code' }],
      attachments: [],
      approvalMode: 'suggest',
    })).rejects.toThrow('No online local_edge execution target is available for Web Hub dispatch.');

    expect(hubClient.sendMessage).toHaveBeenCalled();
    expect(hubClient.triggerAgentTask).not.toHaveBeenCalled();
  });

  it('rejects runtime-less agent mentions before sending a Hub message', async () => {
    const hubClient = {
      addAgentToSession: vi.fn(),
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
    expect(hubClient.addAgentToSession).not.toHaveBeenCalled();
  });
});
