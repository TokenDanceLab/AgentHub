import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  compactActiveAgentTask,
  readStoredWebActiveAgentTask,
  recordWebAgentTaskIndex,
  stringField,
  webActiveAgentTaskQueryKey,
  webActiveAgentTaskStorageKey,
  webAgentTaskIndexQueryKey,
} from './webPlatformAgentTask';
import {
  buildHubAgentTaskModelParams,
  isDispatchableLocalEdgeTarget,
  targetDispatchBlockerLabel,
} from './webPlatformDispatchHelpers';
import {
  buildAttachmentContentJSON,
  buildHubComposerPrompt,
  firstUploadedAttachment,
  hubMessagesQueryKey,
  hubMessagesQueryRoot,
  optimisticHubMessageFromIntent,
  resolveComposerMessageContent,
  webHubMessagesFamily,
} from './webPlatformMessageHelpers';
import {
  formatHubPinTime,
  hubSessionToWorkbenchConversation,
} from './webPlatformMapping';
import {
  webAgents,
  webConversations,
  webHubEmptyConversation,
  webHubEmptyTranscript,
  webTranscript,
} from './webPlatformFixtures';

describe('webPlatformFixtures residual seam', () => {
  it('exports non-empty demo conversations/agents and empty hub placeholders', () => {
    expect(webConversations.length).toBeGreaterThan(0);
    expect(webAgents.length).toBeGreaterThan(0);
    expect(webTranscript.length).toBeGreaterThan(0);
    expect(webHubEmptyConversation.id).toBe('hub-empty-workspace');
    expect(webHubEmptyTranscript[0]?.author.role).toBe('system');
  });
});

describe('webPlatformMapping pure helpers', () => {
  it('maps private sessions and formats pin times', () => {
    expect(hubSessionToWorkbenchConversation({
      session_id: 'hub-private-1',
      type: 'private',
      name: '  ',
      unread_count: 0,
    })).toEqual({
      id: 'hub-private-1',
      title: 'Hub 私聊',
      kind: 'direct',
      subtitle: 'Hub private',
    });

    expect(formatHubPinTime(undefined)).toBeUndefined();
    expect(formatHubPinTime('not-a-date')).toBeUndefined();
    expect(formatHubPinTime('2026-06-07T06:49:00Z')).toEqual(expect.any(String));
  });
});

describe('webPlatformMessageHelpers pure helpers', () => {
  it('builds attachment JSON and composer prompts', () => {
    expect(buildAttachmentContentJSON({
      id: 'a1',
      name: 'notes.md',
    })).toBe(JSON.stringify({ name: 'notes.md' }));

    expect(JSON.parse(buildAttachmentContentJSON({
      id: 'a1',
      name: 'notes.md',
      attachmentRef: {
        id: 'ref-1',
        name: 'notes.md',
        original_name: 'notes.md',
        size: 12,
        mime_type: 'text/markdown',
        url: 'https://example.test/ref-1',
      },
    }, ' caption '))).toEqual({
      attachment_id: 'ref-1',
      name: 'notes.md',
      caption: 'caption',
    });

    expect(buildHubComposerPrompt({
      conversationId: 'hub-session-1',
      text: 'hello',
      mode: 'ask',
      mentions: [],
      attachments: [{
        id: 'att-1',
        name: 'notes.md',
        source: 'browser',
        contentPreview: 'preview body',
      }],
      approvalMode: 'suggest',
    })).toContain('[AgentHub attachments]');
  });

  it('resolves content type for image/file/text and builds optimistic messages', () => {
    const imageIntent = {
      conversationId: 'hub-session-1',
      text: 'see image',
      mode: 'ask' as const,
      mentions: [],
      attachments: [{
        id: 'img-1',
        name: 'shot.png',
        mime: 'image/png',
        attachmentRef: {
          id: 'ref-img',
          name: 'shot.png',
          size: 10,
          mime_type: 'image/png',
          url: 'https://example.test/img',
        },
      }],
      approvalMode: 'suggest' as const,
    };
    expect(resolveComposerMessageContent(imageIntent)).toMatchObject({ contentType: 'image' });
    expect(firstUploadedAttachment(imageIntent.attachments, 'image/')?.id).toBe('img-1');

    const fileIntent = {
      ...imageIntent,
      attachments: [{
        id: 'file-1',
        name: 'doc.pdf',
        mime: 'application/pdf',
        attachmentRef: {
          id: 'ref-file',
          name: 'doc.pdf',
          size: 20,
          mime_type: 'application/pdf',
          url: 'https://example.test/file',
        },
      }],
    };
    expect(resolveComposerMessageContent(fileIntent)).toMatchObject({ contentType: 'file' });

    const optimistic = optimisticHubMessageFromIntent({
      conversationId: 'hub-session-1',
      text: 'optimistic text',
      mode: 'ask',
      mentions: [],
      attachments: [],
      approvalMode: 'suggest',
      replyTo: { messageId: 'msg-prev', author: 'alice', preview: 'prev text' },
    }, 'client-msg-1', '2026-06-07T00:00:00Z');

    expect(optimistic).toMatchObject({
      id: 'client-msg-1',
      client_msg_id: 'client-msg-1',
      content_type: 'text',
      content: 'optimistic text',
      reply_to: {
        id: 'msg-prev',
        sender_id: 'alice',
      },
    });
    expect(hubMessagesQueryKey('hub-session-1')).toEqual(['web-v4', 'hub-messages', 'hub-session-1']);
  });
});

describe('webPlatformAgentTask pure helpers', () => {
  it('compacts optional fields and round-trips localStorage', () => {
    localStorage.clear();
    const task = compactActiveAgentTask({
      taskId: 'task-1',
      sessionId: 'hub-session-1',
      status: 'queued',
      agentInstanceId: undefined,
      targetId: 'target-1',
    });
    expect(task).toEqual({
      taskId: 'task-1',
      sessionId: 'hub-session-1',
      targetId: 'target-1',
      status: 'queued',
    });
    expect(stringField('  ok  ')).toBe('ok');
    expect(stringField('   ')).toBeUndefined();
    expect(webActiveAgentTaskStorageKey('hub-session-1')).toBe('agenthub.web.activeAgentTask.hub-session-1');
    expect(webActiveAgentTaskQueryKey('hub-session-1')).toEqual(['web-v4', 'active-agent-task', 'hub-session-1']);
    expect(webAgentTaskIndexQueryKey('task-1')).toEqual(['web-v4', 'agent-task-index', 'task-1']);

    const queryClient = new QueryClient();
    recordWebAgentTaskIndex(queryClient, {
      taskId: 'task-1',
      sessionId: 'hub-session-1',
      targetId: 'target-1',
      status: 'queued',
    });
    expect(queryClient.getQueryData(webAgentTaskIndexQueryKey('task-1'))).toMatchObject({ taskId: 'task-1' });
    expect(readStoredWebActiveAgentTask('hub-session-1')).toEqual({
      taskId: 'task-1',
      sessionId: 'hub-session-1',
      targetId: 'target-1',
      status: 'queued',
    });

    localStorage.setItem(webActiveAgentTaskStorageKey('hub-session-2'), '{not-json');
    expect(readStoredWebActiveAgentTask('hub-session-2')).toBeNull();
    localStorage.setItem(webActiveAgentTaskStorageKey('hub-session-3'), JSON.stringify({ taskId: 'x' }));
    expect(readStoredWebActiveAgentTask('hub-session-3')).toBeNull();
  });
});

describe('webPlatformDispatchHelpers pure helpers', () => {
  it('classifies dispatchable local_edge targets and builds model params', () => {
    expect(isDispatchableLocalEdgeTarget({
      id: 't-online',
      name: 'Edge',
      target_type: 'local_edge',
      is_online: true,
      health_state: 'healthy',
    } as never)).toBe(true);

    expect(isDispatchableLocalEdgeTarget({
      id: 't-stale',
      name: 'Edge',
      target_type: 'local_edge',
      is_online: true,
      health_state: 'stale',
    } as never)).toBe(false);

    expect(targetDispatchBlockerLabel({
      id: 't-relay',
      name: 'Relay',
      target_type: 'hub_relay',
      is_online: true,
      health_state: 'healthy',
    } as never)).toBe('target type hub_relay');

    expect(targetDispatchBlockerLabel({
      id: 't-stale',
      name: 'Edge',
      target_type: 'local_edge',
      is_online: true,
      health_state: 'stale',
    } as never)).toBe('stale');

    expect(buildHubAgentTaskModelParams({
      conversationId: 'hub-session-1',
      text: 'go',
      mode: 'code',
      mentions: [{ id: 'p1', label: 'Builder', runtimeId: 'claude-code', model: 'glm-5.1' }],
      attachments: [{ id: 'a1', name: 'notes.md', source: 'browser', kind: 'file', mime: 'text/markdown', truncated: true }],
      approvalMode: 'workspace-write',
      workDir: 'D:\\Code\\TokenDance\\AgentHub',
    })).toEqual({
      source: 'web-v4-workbench',
      mode: 'code',
      approval_mode: 'workspace-write',
      work_dir: 'D:\\Code\\TokenDance\\AgentHub',
      mentions: [{ id: 'p1', label: 'Builder', runtime_id: 'claude-code', model: 'glm-5.1' }],
      attachments: [{ id: 'a1', name: 'notes.md', source: 'browser', kind: 'file', mime: 'text/markdown', truncated: true }],
    });
  });
});

// #2252: Web's transcript key family is what the shared reconnect/gap resync
// matches against. If `of` and `sessionIdOf` ever drift apart (or from the key
// the transcript query and the optimistic cache writers use), resync silently
// degrades to a no-op again — that is exactly the defect these assertions pin.
describe('webHubMessagesFamily (#2252)', () => {
  it('round-trips the real transcript key', () => {
    const key = hubMessagesQueryKey('hub-session-1');
    expect(webHubMessagesFamily.of('hub-session-1')).toEqual(key);
    expect(webHubMessagesFamily.sessionIdOf(key)).toBe('hub-session-1');
    expect(webHubMessagesFamily.root).toEqual(hubMessagesQueryRoot);
  });

  it('is a prefix-compatible root so broad invalidation still covers every session', () => {
    expect(hubMessagesQueryKey('hub-session-1').slice(0, 2)).toEqual([...hubMessagesQueryRoot]);
    expect(hubMessagesQueryKey('hub-session-2').slice(0, 2)).toEqual([...hubMessagesQueryRoot]);
  });

  it('rejects keys that are not a Web transcript cache', () => {
    expect(webHubMessagesFamily.sessionIdOf(['web-v4', 'hub-sessions'])).toBeNull();
    expect(webHubMessagesFamily.sessionIdOf(['web-v4', 'hub-pins', 'hub-session-1'])).toBeNull();
    expect(webHubMessagesFamily.sessionIdOf(['hub', 'threads', 'hub-session-1', 'messages'])).toBeNull();
    expect(webHubMessagesFamily.sessionIdOf(['web-v4', 'hub-messages', 42])).toBeNull();
  });
});
