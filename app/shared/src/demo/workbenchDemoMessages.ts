/**
 * Workbench demo message fixtures (hub loop, pins, legacy builder transcript).
 * Peel companion of workbenchDemo (#1131). Pure only; zero behavior change.
 */

import type { TranscriptBlock } from '../transcript';
import { normalizeHubMessagesToTranscript, type HubMessageTranscriptInput } from '../transcript/normalizeHubMessages';
import type { WorkbenchDemoMessagePin } from './workbenchDemoTypes';

export const projectGroupMessageLoopHubMessages: HubMessageTranscriptInput[] = [
  {
    id: 'a2a-dm-builder',
    session_id: 'agent-dm-session',
    seq_id: 1,
    sender_type: 'user',
    sender_id: 'delicious233',
    sender: { nickname: 'Delicious233' },
    content: {
      text: 'Builder，先把项目群消息闭环的 shared fixture contract 梳理出来。',
      im_kind: 'agent_dm',
      to_agent: { id: 'builder', label: 'Builder', runtime_id: 'claude-code' },
      agent_task: { task_id: 'task-a2a-contract', status: 'queued' },
    },
    created_at: '2026-06-09T09:18:00+08:00',
  },
  {
    id: 'a2a-agent-to-agent',
    session_id: 'agent-dm-session',
    seq_id: 2,
    sender_type: 'agent',
    sender_id: 'builder',
    sender: { nickname: 'Builder' },
    content: {
      text: 'Reviewer，我会把 Hub message metadata 映射到 transcript，你复核 queued/assigned 可见性。',
      im_kind: 'agent_dm',
      from_agent: { id: 'builder', label: 'Builder', runtime_id: 'claude-code' },
      to_agent: { id: 'reviewer', label: 'Reviewer', runtime_id: 'codex' },
      agent_task: { task_id: 'task-a2a-review', status: 'queued' },
    },
    created_at: '2026-06-09T09:18:20+08:00',
  },
  {
    id: 'project-group-mention-reviewer',
    session_id: 'project-group-session',
    seq_id: 3,
    sender_type: 'user',
    sender_id: 'delicious233',
    sender: { nickname: 'Delicious233' },
    content: {
      text: '@Reviewer 检查 Agent-to-Agent / 项目群 / @Agent 消息线，不启动真实长连接。',
      im_kind: 'project_group',
      mentions: [{ id: 'reviewer', label: 'Reviewer', runtime_id: 'codex' }],
      agent_task: { task_id: 'task-a2a-review', status: 'queued', queue_id: 'project-group-fixture' },
    },
    created_at: '2026-06-09T09:18:40+08:00',
  },
  {
    id: 'project-group-route-decision',
    session_id: 'project-group-session',
    seq_id: 5,
    sender_type: 'agent',
    sender_id: 'orchestrator',
    sender: { nickname: 'Orchestrator' },
    content: {
      text: '路由给 Reviewer 做 focused coverage，Builder 继续补 fixture contract。',
      im_kind: 'project_group',
      route_decision: {
        action: 'dispatch',
        target_agent: 'Reviewer',
        summary: 'Project group @Agent mention routes task-a2a-review to Reviewer; fixture-only, no live push.',
      },
    },
    created_at: '2026-06-09T09:19:20+08:00',
  },
  {
    id: 'project-group-queued-reviewer',
    session_id: 'project-group-session',
    seq_id: 4,
    sender_type: 'system',
    sender_id: 'hub-fixture',
    sender: { nickname: 'Hub Fixture' },
    content: {
      text: 'task-a2a-review 已进入项目群 @Agent 队列，等待 Reviewer 接手。',
      im_kind: 'project_group',
      mentions: [{ id: 'reviewer', label: 'Reviewer', runtime_id: 'codex' }],
      agent_task: { task_id: 'task-a2a-review', status: 'queued', queue_id: 'project-group-fixture' },
    },
    created_at: '2026-06-09T09:19:00+08:00',
  },
  {
    id: 'project-group-assigned-reviewer',
    session_id: 'project-group-session',
    seq_id: 6,
    sender_type: 'system',
    sender_id: 'hub-fixture',
    sender: { nickname: 'Hub Fixture' },
    content: {
      text: 'Reviewer 已接手 task-a2a-review，项目群状态从 queued 进入 assigned。',
      im_kind: 'project_group',
      mentions: [{ id: 'reviewer', label: 'Reviewer', runtime_id: 'codex' }],
      agent_task: { task_id: 'task-a2a-review', status: 'assigned', queue_id: 'project-group-fixture' },
    },
    created_at: '2026-06-09T09:19:40+08:00',
  },
  {
    id: 'project-group-working-reviewer',
    session_id: 'project-group-session',
    seq_id: 7,
    sender_type: 'agent',
    sender_id: 'reviewer',
    sender: { nickname: 'Reviewer' },
    content: {
      text: 'Reviewer 正在复核 shared transcript rendering 和 Hub contract 可见性。',
      im_kind: 'project_group',
      from_agent: { id: 'reviewer', label: 'Reviewer', runtime_id: 'codex' },
      mentions: [{ id: 'reviewer', label: 'Reviewer', runtime_id: 'codex' }],
      agent_task: { task_id: 'task-a2a-review', status: 'working', queue_id: 'project-group-fixture' },
    },
    created_at: '2026-06-09T09:19:50+08:00',
  },
  {
    id: 'project-group-done-reviewer',
    session_id: 'project-group-session',
    seq_id: 8,
    sender_type: 'agent',
    sender_id: 'reviewer',
    sender: { nickname: 'Reviewer' },
    content: {
      text: 'Reviewer 已完成 task-a2a-review，消息同步链进入 done。',
      im_kind: 'project_group',
      from_agent: { id: 'reviewer', label: 'Reviewer', runtime_id: 'codex' },
      mentions: [{ id: 'reviewer', label: 'Reviewer', runtime_id: 'codex' }],
      agent_task: { task_id: 'task-a2a-review', status: 'done', queue_id: 'project-group-fixture' },
    },
    created_at: '2026-06-09T09:20:00+08:00',
  },
];

export const projectGroupMessageLoopTranscript: TranscriptBlock[] =
  normalizeHubMessagesToTranscript(projectGroupMessageLoopHubMessages);

export const demoWorkbenchPins: WorkbenchDemoMessagePin[] = [
  {
    conversationId: 'builder',
    messageId: 'builder-msg-1',
    pinnedBy: 'Delicious233',
    pinnedAt: '2026-06-06T14:49:00+08:00',
  },
];
