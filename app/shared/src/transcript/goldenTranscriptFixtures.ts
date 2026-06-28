import type { HubMessageTranscriptInput } from './normalizeHubMessages';
import { normalizeHubMessagesToTranscript } from './normalizeHubMessages';
import type { HubRuntimeEventTranscriptInput } from './normalizeHubRuntimeEvents';
import { normalizeHubRuntimeEventsToTranscript } from './normalizeHubRuntimeEvents';
import { orderTranscriptBlocks } from './order';
import { isSidebarOnlyTranscriptBlock, type TranscriptBlock } from './types';

export const GOLDEN_MIXED_SOURCE_SESSION_ID = 'session-golden-chat-flow';
export const GOLDEN_MIXED_SOURCE_TASK_ID = 'golden-chat-flow-task';
export const GOLDEN_MIXED_SOURCE_RUN_ID = 'run-golden-chat-flow';

export const goldenMixedSourceHubMessages: HubMessageTranscriptInput[] = [
  {
    id: 'message-golden-user',
    session_id: GOLDEN_MIXED_SOURCE_SESSION_ID,
    seq_id: 1,
    client_msg_id: 'client-golden-user',
    sender_type: 'user',
    sender_id: 'user-golden',
    sender: { nickname: 'Golden User' },
    content_type: 'text',
    content: 'Kick off the golden mixed-source contract.',
    created_at: '2026-06-26T08:00:00Z',
  },
];

export const goldenMixedSourceHubRuntimeEvents: HubRuntimeEventTranscriptInput[] = [
  {
    id: 'evt-golden-call-read-a',
    task_id: GOLDEN_MIXED_SOURCE_TASK_ID,
    edge_run_id: GOLDEN_MIXED_SOURCE_RUN_ID,
    session_id: GOLDEN_MIXED_SOURCE_SESSION_ID,
    agent_instance_id: 'agent-golden-builder',
    agent_label: 'Builder',
    event_seq: 1,
    event_type: 'run.agent.tool_call',
    payload: { callId: 'read-a', toolName: 'Read', path: 'src/a.ts' },
    created_at: '2026-06-26T08:00:01Z',
  },
  {
    id: 'evt-golden-call-read-b',
    task_id: GOLDEN_MIXED_SOURCE_TASK_ID,
    edge_run_id: GOLDEN_MIXED_SOURCE_RUN_ID,
    session_id: GOLDEN_MIXED_SOURCE_SESSION_ID,
    agent_instance_id: 'agent-golden-builder',
    agent_label: 'Builder',
    event_seq: 2,
    event_type: 'run.agent.tool_call',
    payload: { callId: 'read-b', toolName: 'Read', path: 'src/b.ts' },
    created_at: '2026-06-26T08:00:02Z',
  },
  {
    id: 'evt-golden-result-read-a',
    task_id: GOLDEN_MIXED_SOURCE_TASK_ID,
    edge_run_id: GOLDEN_MIXED_SOURCE_RUN_ID,
    session_id: GOLDEN_MIXED_SOURCE_SESSION_ID,
    agent_instance_id: 'agent-golden-builder',
    agent_label: 'Builder',
    event_seq: 3,
    event_type: 'run.agent.tool_result',
    payload: { callId: 'read-a', toolName: 'Read', summary: 'A result belongs to src/a.ts' },
    created_at: '2026-06-26T08:00:03Z',
  },
  {
    id: 'evt-golden-result-read-b',
    task_id: GOLDEN_MIXED_SOURCE_TASK_ID,
    edge_run_id: GOLDEN_MIXED_SOURCE_RUN_ID,
    session_id: GOLDEN_MIXED_SOURCE_SESSION_ID,
    agent_instance_id: 'agent-golden-builder',
    agent_label: 'Builder',
    event_seq: 4,
    event_type: 'run.agent.tool_result',
    payload: { callId: 'read-b', toolName: 'Read', summary: 'B result belongs to src/b.ts' },
    created_at: '2026-06-26T08:00:04Z',
  },
  {
    id: 'evt-golden-subagent-report',
    task_id: GOLDEN_MIXED_SOURCE_TASK_ID,
    edge_run_id: GOLDEN_MIXED_SOURCE_RUN_ID,
    session_id: GOLDEN_MIXED_SOURCE_SESSION_ID,
    agent_instance_id: 'agent-golden-builder',
    agent_label: 'Builder',
    event_seq: 5,
    event_type: 'run.agent.subagent_task',
    payload: {
      title: 'Deep report should stay in inspector',
      worker: 'Reviewer QA',
      status: 'running',
      summary: 'Inspector-only orchestration detail.',
    },
    created_at: '2026-06-26T08:00:05Z',
  },
  {
    id: 'evt-golden-route-report',
    task_id: GOLDEN_MIXED_SOURCE_TASK_ID,
    edge_run_id: GOLDEN_MIXED_SOURCE_RUN_ID,
    session_id: GOLDEN_MIXED_SOURCE_SESSION_ID,
    agent_instance_id: 'agent-golden-builder',
    agent_label: 'Builder',
    event_seq: 6,
    event_type: 'run.agent.route_decision',
    payload: {
      action: 'fanout',
      nextWorker: 'Reviewer QA',
      summary: 'Route details belong to the inspector DAG.',
    },
    created_at: '2026-06-26T08:00:06Z',
  },
  {
    id: 'evt-golden-runtime-diagnostic',
    task_id: GOLDEN_MIXED_SOURCE_TASK_ID,
    edge_run_id: GOLDEN_MIXED_SOURCE_RUN_ID,
    session_id: GOLDEN_MIXED_SOURCE_SESSION_ID,
    agent_instance_id: 'agent-golden-builder',
    agent_label: 'Builder',
    event_seq: 7,
    event_type: 'run.agent.text_block',
    payload: {
      content: 'Runtime: mock replay',
    },
    created_at: '2026-06-26T08:00:06.500Z',
  },
  {
    id: 'evt-golden-markdown-summary',
    task_id: GOLDEN_MIXED_SOURCE_TASK_ID,
    edge_run_id: GOLDEN_MIXED_SOURCE_RUN_ID,
    session_id: GOLDEN_MIXED_SOURCE_SESSION_ID,
    agent_instance_id: 'agent-golden-builder',
    agent_label: 'Builder',
    event_seq: 8,
    event_type: 'run.agent.text_block',
    payload: {
      content: [
        'The golden replay summary is below.',
        '',
        '| Check | Status |',
        '| --- | --- |',
        '| order | ordered |',
      ].join('\n'),
    },
    created_at: '2026-06-26T08:00:07Z',
  },
];

export const goldenMixedSourceFullBlockIds = [
  'hub-message-client-golden-user',
  'hub-runtime-session-golden-chat-flow-task-run-golden-chat-flow',
  'edge-event-hub-runtime-evt-golden-call-read-a',
  'edge-event-hub-runtime-evt-golden-call-read-b',
  'edge-event-hub-runtime-evt-golden-result-read-a',
  'edge-event-hub-runtime-evt-golden-result-read-b',
  'edge-event-hub-runtime-evt-golden-subagent-report',
  'edge-event-hub-runtime-evt-golden-route-report',
  'edge-event-hub-runtime-evt-golden-markdown-summary',
] as const;

export const goldenMixedSourceMainBlockIds = [
  'hub-message-client-golden-user',
  'edge-event-hub-runtime-evt-golden-call-read-a',
  'edge-event-hub-runtime-evt-golden-call-read-b',
  'edge-event-hub-runtime-evt-golden-result-read-a',
  'edge-event-hub-runtime-evt-golden-result-read-b',
  'edge-event-hub-runtime-evt-golden-markdown-summary',
] as const;

export const goldenMixedSourceInspectorOnlyBlockIds = [
  'hub-runtime-session-golden-chat-flow-task-run-golden-chat-flow',
  'edge-event-hub-runtime-evt-golden-subagent-report',
  'edge-event-hub-runtime-evt-golden-route-report',
] as const;

export function resolveGoldenMixedSourceTranscript(): TranscriptBlock[] {
  return orderTranscriptBlocks([
    ...normalizeHubMessagesToTranscript(goldenMixedSourceHubMessages),
    ...normalizeHubRuntimeEventsToTranscript(goldenMixedSourceHubRuntimeEvents),
  ]);
}

export function resolveGoldenMixedSourceMainTranscript(): TranscriptBlock[] {
  return resolveGoldenMixedSourceTranscript().filter((block) => !isSidebarOnlyTranscriptBlock(block));
}
