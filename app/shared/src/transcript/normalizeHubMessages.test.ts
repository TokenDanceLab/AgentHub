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
        createdAt: '2026-06-07T07:00:01Z',
        kind: 'text',
        text: '从 Hub session 发来的消息',
      },
      {
        id: 'hub-message-message-agent',
        author: { id: 'agent-1', name: 'Hub Builder', role: 'agent' },
        createdAt: '2026-06-07T07:00:02Z',
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

  it('keeps Agent DM, agent-to-agent, group @Agent, and task queue state visible', () => {
    const blocks = normalizeHubMessagesToTranscript([
      {
        id: 'human-to-builder',
        session_id: 'agent-dm-session',
        seq_id: 1,
        sender_type: 'user',
        sender_id: 'user-1',
        sender: { nickname: 'Delicious233' },
        content: {
          text: '请先起草项目方案',
          im_kind: 'agent_dm',
          to_agent: { id: 'agent-builder', label: 'Builder', runtime_id: 'claude-code' },
        },
        created_at: '2026-06-09T01:00:00Z',
      },
      {
        id: 'builder-to-reviewer',
        session_id: 'agent-dm-session',
        seq_id: 2,
        sender_type: 'agent',
        sender_id: 'agent-builder',
        sender: { nickname: 'Builder' },
        content: {
          text: '我完成方案草稿，请你 review API 合同。',
          im_kind: 'agent_dm',
          from_agent: { id: 'agent-builder', label: 'Builder' },
          to_agent: { id: 'agent-reviewer', label: 'Reviewer', runtime_id: 'codex' },
        },
        created_at: '2026-06-09T01:00:01Z',
      },
      {
        id: 'group-mention-reviewer',
        session_id: 'project-group-session',
        seq_id: 3,
        sender_type: 'user',
        sender_id: 'user-1',
        sender: { nickname: 'Delicious233' },
        content: {
          text: '@Reviewer 检查一下 shared transcript contract',
          im_kind: 'project_group',
          mentions: [{ id: 'agent-reviewer', label: 'Reviewer', runtime_id: 'codex' }],
          agent_task: { task_id: 'task-reviewer-1', status: 'queued' },
        },
        created_at: '2026-06-09T01:00:02Z',
      },
      {
        id: 'group-assigned-reviewer',
        session_id: 'project-group-session',
        seq_id: 4,
        sender_type: 'system',
        sender_id: 'hub-orchestrator',
        content: {
          text: 'Reviewer 已接到 shared transcript contract 复核任务。',
          im_kind: 'project_group',
          mentions: [{ id: 'agent-reviewer', label: 'Reviewer', runtime_id: 'codex' }],
          agent_task: { task_id: 'task-reviewer-1', status: 'assigned' },
        },
        created_at: '2026-06-09T01:00:03Z',
      },
    ]);

    expect(blocks).toEqual([
      expect.objectContaining({
        id: 'hub-message-human-to-builder',
        kind: 'text',
        text: '请先起草项目方案',
        displayTitle: 'Agent DM',
        displayDetail: 'IM agent_dm',
      }),
      expect.objectContaining({
        id: 'hub-message-builder-to-reviewer',
        kind: 'text',
        text: '我完成方案草稿，请你 review API 合同。',
        author: { id: 'agent-builder', name: 'Builder', role: 'agent' },
        displayTitle: 'Agent -> Agent',
        displayDetail: 'IM agent_dm · Builder -> Reviewer',
      }),
      expect.objectContaining({
        id: 'hub-message-group-mention-reviewer',
        kind: 'text',
        text: '@Reviewer 检查一下 shared transcript contract',
        displayTitle: 'Group @Agent',
        displayDetail: 'IM project_group · mentions @Reviewer · task task-reviewer-1',
        badgeLabel: '@Agent queued',
        badgeVariant: 'primary',
      }),
      expect.objectContaining({
        id: 'hub-message-group-assigned-reviewer',
        kind: 'text',
        text: 'Reviewer 已接到 shared transcript contract 复核任务。',
        displayTitle: 'Group @Agent',
        displayDetail: 'IM project_group · mentions @Reviewer · task task-reviewer-1',
        badgeLabel: '@Agent assigned',
        badgeVariant: 'thinking',
      }),
    ]);
  });

  it('projects orchestrator route decisions from message fixtures without running a model', () => {
    const blocks = normalizeHubMessagesToTranscript([
      {
        id: 'orchestrator-route',
        session_id: 'project-group-session',
        seq_id: 4,
        sender_type: 'agent',
        sender_id: 'agent-orchestrator',
        sender: { nickname: 'Orchestrator' },
        content: {
          text: '路由给 Reviewer 做 contract review。',
          im_kind: 'project_group',
          route_decision: {
            action: 'dispatch',
            target_agent: 'Reviewer',
            summary: 'Route shared transcript contract review to Reviewer.',
          },
        },
        created_at: '2026-06-09T01:00:03Z',
      },
    ]);

    expect(blocks).toEqual([
      {
        id: 'hub-message-orchestrator-route',
        author: { id: 'agent-orchestrator', name: 'Orchestrator', role: 'agent' },
        createdAt: '2026-06-09T01:00:03Z',
        kind: 'route_decision',
        action: 'dispatch',
        summary: 'Route shared transcript contract review to Reviewer.',
        targetAgent: 'Reviewer',
      },
    ]);
  });
});
