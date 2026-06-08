import { describe, expect, it } from 'vitest';
import {
  hubRuntimeEventFromPayload,
  normalizeHubRuntimeEventsToTranscript,
} from './normalizeHubRuntimeEvents';

describe('normalizeHubRuntimeEventsToTranscript', () => {
  it('projects Hub agent.stream runtime payloads into shared transcript blocks', () => {
    const blocks = normalizeHubRuntimeEventsToTranscript([
      {
        id: 'evt-hub-text',
        task_id: 'task-hub',
        edge_run_id: 'run-hub',
        edge_device_id: 'desktop-device-1',
        adapter_id: 'codex',
        session_id: 'hub-session-1',
        agent_instance_id: 'agent-instance-1',
        event_seq: 1,
        event_type: 'run.agent.text_block',
        payload: { content: 'Hub runtime 正在执行。' },
        created_at: '2026-06-07T04:00:01Z',
      },
      {
        id: 'evt-hub-tool',
        task_id: 'task-hub',
        edge_run_id: 'run-hub',
        session_id: 'hub-session-1',
        event_seq: 2,
        event_type: 'run.agent.tool_call',
        payload: { callId: 'call-rg', toolName: 'rg', status: 'running' },
        created_at: '2026-06-07T04:00:02Z',
      },
      {
        id: 'evt-hub-artifact',
        task_id: 'task-hub',
        edge_run_id: 'run-hub',
        session_id: 'hub-session-1',
        event_seq: 3,
        event_type: 'artifact.created',
        payload: {
          artifactId: 'artifact-web',
          title: 'web preview',
          uri: 'https://hub.example.test/artifacts/web-preview',
          mimeType: 'text/html',
        },
        created_at: '2026-06-07T04:00:03Z',
      },
    ]);

    expect(blocks).toEqual([
      expect.objectContaining({
        id: 'hub-runtime-session-task-hub-run-hub',
        kind: 'run_session',
        title: 'Hub task replay',
        status: 'running',
        runId: 'run-hub',
        taskId: 'task-hub',
        edgeRunId: 'run-hub',
        deviceId: 'desktop-device-1',
        adapterId: 'codex',
        sourceLabel: 'Hub replay',
        modeLabel: 'Real',
        targetLabel: 'Edge run',
      }),
      expect.objectContaining({
        id: 'edge-event-hub-runtime-evt-hub-text',
        kind: 'text',
        text: 'Hub runtime 正在执行。',
        evidenceRefs: [
          { id: 'run-run-hub', kind: 'run', label: 'Run run-hub', status: 'running' },
        ],
      }),
      expect.objectContaining({
        id: 'edge-event-hub-runtime-evt-hub-tool',
        kind: 'tool_call',
        toolName: 'rg',
        status: 'running',
        evidenceRefs: [
          { id: 'run-run-hub', kind: 'run', label: 'Run run-hub', status: 'running' },
          { id: 'tool-call-rg', kind: 'tool', label: 'rg', status: 'running' },
        ],
      }),
      expect.objectContaining({
        id: 'edge-event-hub-runtime-evt-hub-artifact',
        kind: 'artifact',
        title: 'web preview',
        evidenceRefs: [
          { id: 'run-run-hub', kind: 'run', label: 'Run run-hub', status: 'running' },
          {
            id: 'artifact-artifact-web',
            kind: 'artifact',
            label: 'web preview',
            mimeType: 'text/html',
            status: 'completed',
            uri: 'https://hub.example.test/artifacts/web-preview',
          },
        ],
      }),
    ]);
  });

  it('parses Hub WebSocket payloads and string runtime payloads', () => {
    const event = hubRuntimeEventFromPayload({
      id: 'evt-json',
      task_id: 'task-json',
      edge_run_id: 'run-json',
      session_id: 'hub-session-json',
      agent_instance_id: 'agent-json',
      event_seq: 4,
      event_type: 'run.agent.text_delta',
      payload: '{"content":"from json payload"}',
      created_at: '2026-06-07T04:00:04Z',
    });

    expect(event).toEqual({
      id: 'evt-json',
      task_id: 'task-json',
      edge_run_id: 'run-json',
      session_id: 'hub-session-json',
      agent_instance_id: 'agent-json',
      event_seq: 4,
      event_type: 'run.agent.text_delta',
      payload: '{"content":"from json payload"}',
      created_at: '2026-06-07T04:00:04Z',
    });
    expect(normalizeHubRuntimeEventsToTranscript([event!])[1]).toEqual(expect.objectContaining({
      kind: 'text',
      text: 'from json payload',
    }));
  });

  it('ignores invalid Hub runtime payloads', () => {
    expect(hubRuntimeEventFromPayload({ event_type: '', payload: {} })).toBeNull();
    expect(hubRuntimeEventFromPayload('not an object')).toBeNull();
    expect(normalizeHubRuntimeEventsToTranscript([
      { id: 'missing-type', payload: { content: 'ignored' } },
    ])).toEqual([]);
  });
});
