import { describe, expect, it } from 'vitest';
import {
  agentRunEventToChatMessage,
  hubMessageToChatMessage,
  mergeAgentRunEvents,
  projectRunDetail,
  projectRunEvents,
} from './hubAdapters';

describe('hubMessageToChatMessage runtime payloads', () => {
  it('renders bridged tool calls as tool blocks instead of JSON text', () => {
    const message = hubMessageToChatMessage({
      id: 'msg-tool',
      session_id: 'sess-1',
      sender_type: 'agent',
      content_type: 'text',
      content: JSON.stringify({
        callId: 'call-1',
        toolName: 'Bash',
        input: { command: 'pnpm test' },
        status: 'running',
      }),
    });

    expect(message.blocks).toEqual([
      {
        kind: 'tool_use',
        callId: 'call-1',
        toolName: 'Bash',
        input: { command: 'pnpm test' },
        status: 'running',
        children: [],
      },
    ]);
  });

  it('renders bridged file changes as file change blocks', () => {
    const message = hubMessageToChatMessage({
      id: 'msg-file',
      session_id: 'sess-1',
      sender_type: 'agent',
      content_type: 'text',
      content: JSON.stringify({
        path: 'src/App.tsx',
        action: 'modified',
        diff: '@@ -1 +1 @@',
      }),
    });

    expect(message.blocks).toEqual([
      {
        kind: 'file_change',
        path: 'src/App.tsx',
        action: 'modified',
        diff: '@@ -1 +1 @@',
      },
    ]);
  });

  it('keeps plain text JSON content readable when it is not a runtime payload', () => {
    const message = hubMessageToChatMessage({
      id: 'msg-text',
      session_id: 'sess-1',
      sender_type: 'agent',
      content_type: 'text',
      content: JSON.stringify({ content: 'plain answer from agent' }),
    });

    expect(message.blocks).toEqual([{ kind: 'text', content: 'plain answer from agent' }]);
  });

  it('does not treat generic JSON id fields as tool call ids', () => {
    const message = hubMessageToChatMessage({
      id: 'msg-json',
      session_id: 'sess-1',
      sender_type: 'agent',
      content_type: 'text',
      content: JSON.stringify({ id: 'ordinary-record', content: 'not a tool result' }),
    });

    expect(message.blocks).toEqual([{ kind: 'text', content: 'not a tool result' }]);
  });

  it('projects runtime blocks into RunDetail data', () => {
    const messages = [
      hubMessageToChatMessage({
        id: 'msg-text',
        session_id: 'sess-1',
        sender_type: 'agent',
        created_at: '2026-05-26T10:00:00.000Z',
        content_type: 'text',
        content: JSON.stringify({ content: 'analysis complete' }),
      }),
      hubMessageToChatMessage({
        id: 'msg-tool-call',
        session_id: 'sess-1',
        sender_type: 'agent',
        created_at: '2026-05-26T10:00:01.000Z',
        content_type: 'text',
        content: JSON.stringify({
          callId: 'call-1',
          toolName: 'Bash',
          input: { command: 'pnpm test' },
          status: 'running',
        }),
      }),
      hubMessageToChatMessage({
        id: 'msg-tool-result',
        session_id: 'sess-1',
        sender_type: 'agent',
        created_at: '2026-05-26T10:00:02.000Z',
        content_type: 'text',
        content: JSON.stringify({
          callId: 'call-1',
          toolName: 'Bash',
          output: 'all tests passed',
          status: 'completed',
        }),
      }),
      hubMessageToChatMessage({
        id: 'msg-file',
        session_id: 'sess-1',
        sender_type: 'agent',
        created_at: '2026-05-26T10:00:03.000Z',
        content_type: 'text',
        content: JSON.stringify({
          path: 'src/App.tsx',
          action: 'modified',
          diff: '@@ -1 +1 @@',
        }),
      }),
    ];

    expect(projectRunDetail(messages)).toEqual({
      outputText: 'analysis complete',
      toolCalls: [
        {
          callId: 'call-1',
          toolName: 'Bash',
          status: 'completed',
          timestamp: '2026-05-26T10:00:01.000Z',
          output: 'all tests passed',
        },
      ],
      changedFiles: [
        {
          path: 'src/App.tsx',
          action: 'modified',
          timestamp: '2026-05-26T10:00:03.000Z',
        },
      ],
    });
  });

  it('projects typed Hub run events into RunDetail data', () => {
    const events = [
      {
        id: 'evt-1',
        task_id: 'task-1',
        session_id: 'sess-1',
        agent_instance_id: 'agent-1',
        event_seq: 1,
        event_type: 'run.agent.text_delta',
        payload: JSON.stringify({ runId: 'run-1', content: 'Hello from Codex' }),
        created_at: '2026-05-26T10:00:00.000Z',
      },
      {
        id: 'evt-2',
        task_id: 'task-1',
        session_id: 'sess-1',
        agent_instance_id: 'agent-1',
        event_seq: 2,
        event_type: 'run.agent.tool_call',
        payload: JSON.stringify({
          runId: 'run-1',
          callId: 'call-1',
          toolName: 'Bash',
          input: { command: 'pnpm test' },
          status: 'running',
        }),
        created_at: '2026-05-26T10:00:01.000Z',
      },
      {
        id: 'evt-3',
        task_id: 'task-1',
        session_id: 'sess-1',
        agent_instance_id: 'agent-1',
        event_seq: 3,
        event_type: 'run.agent.tool_result',
        payload: JSON.stringify({
          runId: 'run-1',
          callId: 'call-1',
          toolName: 'Bash',
          output: 'tests passed',
          status: 'completed',
        }),
        created_at: '2026-05-26T10:00:02.000Z',
      },
    ];

    expect(projectRunEvents(events)).toEqual({
      outputText: 'Hello from Codex',
      toolCalls: [
        {
          callId: 'call-1',
          toolName: 'Bash',
          status: 'completed',
          timestamp: '2026-05-26T10:00:01.000Z',
          output: 'tests passed',
        },
      ],
      changedFiles: [],
    });
  });

  it('renders Codex files[] file_change payloads from typed run events', () => {
    const message = agentRunEventToChatMessage({
      id: 'evt-files',
      task_id: 'task-1',
      session_id: 'sess-1',
      agent_instance_id: 'agent-1',
      event_seq: 1,
      event_type: 'run.agent.file_change',
      payload: JSON.stringify({
        runId: 'run-1',
        files: [
          { path: 'src/main.rs', kind: 'update' },
          { path: 'src/lib.rs', kind: 'add' },
          { path: 'src/old.rs', kind: 'delete' },
        ],
      }),
      created_at: '2026-05-26T10:00:03.000Z',
    });

    expect(message.blocks).toEqual([
      { kind: 'file_change', path: 'src/main.rs', action: 'modified' },
      { kind: 'file_change', path: 'src/lib.rs', action: 'created' },
      { kind: 'file_change', path: 'src/old.rs', action: 'deleted' },
    ]);
  });

  it('projects stdout run.output.batch chunks from typed run events', () => {
    expect(projectRunEvents([
      {
        id: 'evt-output',
        task_id: 'task-1',
        session_id: 'sess-1',
        agent_instance_id: 'agent-1',
        event_seq: 1,
        event_type: 'run.output.batch',
        payload: JSON.stringify({
          runId: 'run-1',
          stream: 'stdout',
          chunks: [
            { offset: 0, text: 'line 1\n' },
            { offset: 7, text: 'line 2\n' },
          ],
        }),
        created_at: '2026-05-26T10:00:04.000Z',
      },
    ])).toMatchObject({
      outputText: 'line 1\nline 2\n',
    });
  });

  it('merges run event replay and websocket events by id and event sequence', () => {
    const replay = [
      { id: 'evt-2', task_id: 'task-1', event_seq: 2, event_type: 'run.agent.text_delta', payload: { content: 'b' } },
    ];
    const realtime = [
      { id: 'evt-1', task_id: 'task-1', event_seq: 1, event_type: 'run.agent.text_delta', payload: { content: 'a' } },
      { id: 'evt-2', task_id: 'task-1', event_seq: 2, event_type: 'run.agent.text_delta', payload: { content: 'b2' } },
    ];

    expect(mergeAgentRunEvents(replay, realtime).map((event) => event.id)).toEqual(['evt-1', 'evt-2']);
    expect(mergeAgentRunEvents(replay, realtime)[1]?.payload).toEqual({ content: 'b2' });
  });
});
