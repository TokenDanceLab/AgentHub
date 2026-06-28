import { describe, expect, it } from 'vitest';
import {
  hubRuntimeEventFromPayload,
  normalizeHubRuntimeEventsToTranscript,
} from './normalizeHubRuntimeEvents';

describe('normalizeHubRuntimeEventsToTranscript', () => {
  it('orders Hub runtime session summaries and replayed blocks by created_at across runs', () => {
    const blocks = normalizeHubRuntimeEventsToTranscript([
      {
        id: 'evt-run-a-text',
        task_id: 'task-a',
        edge_run_id: 'run-a',
        event_seq: 1,
        event_type: 'run.agent.text_block',
        payload: { content: 'Run A first response.' },
        created_at: '2026-06-07T04:00:01Z',
      },
      {
        id: 'evt-run-b-text',
        task_id: 'task-b',
        edge_run_id: 'run-b',
        event_seq: 1,
        event_type: 'run.agent.text_block',
        payload: { content: 'Run B later response.' },
        created_at: '2026-06-07T04:00:03Z',
      },
    ]);

    expect(blocks.map((block) => block.id)).toEqual([
      'hub-runtime-session-task-a-run-a',
      'edge-event-hub-runtime-evt-run-a-text',
      'hub-runtime-session-task-b-run-b',
      'edge-event-hub-runtime-evt-run-b-text',
    ]);
  });

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
        payload: {
          content: 'Hub runtime 正在执行。',
          evidence_mode: 'real_tested',
          target_type: 'local_edge',
        },
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
        targetLabel: 'local_edge',
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

  it('projects Hub permission events into approval transcript blocks with Hub decision metadata', () => {
    const blocks = normalizeHubRuntimeEventsToTranscript([
      {
        id: 'evt-permission-requested',
        task_id: 'agent-task-1',
        edge_run_id: 'edge-run-1',
        session_id: 'hub-session-1',
        event_seq: 1,
        event_type: 'run.agent.permission_requested',
        payload: {
          requestId: 'approval-1',
          toolName: 'Bash',
          command: 'pnpm test',
          riskLevel: 'high',
          team_id: 'team-1',
          team_run_id: 'team-run-1',
          agent_task_id: 'agent-task-1',
          target_id: 'target-local-edge-1',
          edge_device_id: 'desktop-device-1',
          correlation_id: 'corr-web-hub-edge-1',
        },
        created_at: '2026-06-09T04:00:01Z',
      },
      {
        id: 'evt-permission-decided',
        task_id: 'agent-task-1',
        edge_run_id: 'edge-run-1',
        session_id: 'hub-session-1',
        event_seq: 2,
        event_type: 'run.agent.permission_decided',
        payload: {
          requestId: 'approval-1',
          toolName: 'Bash',
          decision: 'allow',
          reason: 'operator approved',
          team_id: 'team-1',
          team_run_id: 'team-run-1',
          agent_task_id: 'agent-task-1',
          target_id: 'target-local-edge-1',
          edge_device_id: 'desktop-device-1',
          correlation_id: 'corr-web-hub-edge-1',
        },
        created_at: '2026-06-09T04:00:02Z',
      },
    ]);

    expect(blocks).toEqual([
      expect.objectContaining({ kind: 'run_session' }),
      expect.objectContaining({
        kind: 'permission_request',
        requestId: 'approval-1',
        teamId: 'team-1',
        teamRunId: 'team-run-1',
        agentTaskId: 'agent-task-1',
        targetId: 'target-local-edge-1',
        edgeDeviceId: 'desktop-device-1',
        correlationId: 'corr-web-hub-edge-1',
        toolName: 'Bash',
        risk: 'high',
        reason: 'pnpm test',
        evidenceRefs: [
          { id: 'run-edge-run-1', kind: 'run', label: 'Run edge-run-1', status: 'pending' },
          { id: 'approval-approval-1', kind: 'approval', label: 'Bash approval', status: 'pending' },
        ],
      }),
      expect.objectContaining({
        kind: 'permission_result',
        requestId: 'approval-1',
        teamId: 'team-1',
        teamRunId: 'team-run-1',
        agentTaskId: 'agent-task-1',
        targetId: 'target-local-edge-1',
        edgeDeviceId: 'desktop-device-1',
        correlationId: 'corr-web-hub-edge-1',
        decision: 'allow',
        evidenceRefs: [
          { id: 'run-edge-run-1', kind: 'run', label: 'Run edge-run-1', status: 'completed' },
          { id: 'approval-approval-1', kind: 'approval', label: 'Bash approval', status: 'completed' },
        ],
      }),
    ]);
  });

  it('preserves Hub approval.requested titles and descriptions in real-mode replay', () => {
    const blocks = normalizeHubRuntimeEventsToTranscript([
      {
        id: 'evt-approval-requested',
        task_id: 'agent-task-approval',
        edge_run_id: 'edge-run-approval',
        session_id: 'hub-session-approval',
        event_seq: 1,
        event_type: 'approval.requested',
        payload: {
          approvalId: 'approval-visual-smoke',
          title: 'Review command approval',
          description: 'Approve workspace write?',
          status: 'pending',
          teamId: 'team-1',
          teamRunId: 'team-run-1',
          agentTaskId: 'agent-task-approval',
        },
        created_at: '2026-06-09T04:00:04Z',
      },
    ]);

    expect(blocks).toEqual([
      expect.objectContaining({ kind: 'run_session' }),
      expect.objectContaining({
        kind: 'permission_request',
        requestId: 'approval-visual-smoke',
        title: 'Review command approval',
        reason: 'Approve workspace write?',
        teamId: 'team-1',
        teamRunId: 'team-run-1',
        agentTaskId: 'agent-task-approval',
        toolName: 'Review command approval',
        evidenceRefs: [
          { id: 'run-edge-run-approval', kind: 'run', label: 'Run edge-run-approval', status: 'pending' },
          {
            id: 'approval-approval-visual-smoke',
            kind: 'approval',
            label: 'Review command approval',
            status: 'pending',
          },
        ],
      }),
    ]);
  });

  it('ignores invalid Hub runtime payloads', () => {
    expect(hubRuntimeEventFromPayload({ event_type: '', payload: {} })).toBeNull();
    expect(hubRuntimeEventFromPayload('not an object')).toBeNull();
    expect(normalizeHubRuntimeEventsToTranscript([
      { id: 'missing-type', payload: { content: 'ignored' } },
    ])).toEqual([]);
  });

  it('treats explicit real, verified, and live mode tokens as Real', () => {
    const blocks = normalizeHubRuntimeEventsToTranscript([
      {
        id: 'evt-mode-real',
        task_id: 'task-mode-real',
        edge_run_id: 'run-mode-real',
        event_seq: 1,
        event_type: 'run.agent.text_block',
        payload: { content: 'real mode', evidence_mode: 'real' },
        created_at: '2026-06-07T04:00:05Z',
      },
      {
        id: 'evt-mode-verified',
        task_id: 'task-mode-verified',
        edge_run_id: 'run-mode-verified',
        event_seq: 2,
        event_type: 'run.agent.text_block',
        payload: { content: 'verified mode', evidence_mode: 'verified' },
        created_at: '2026-06-07T04:00:06Z',
      },
      {
        id: 'evt-mode-live',
        task_id: 'task-mode-live',
        edge_run_id: 'run-mode-live',
        event_seq: 3,
        event_type: 'run.agent.text_block',
        payload: { content: 'live mode', runtime_mode: 'live' },
        created_at: '2026-06-07T04:00:07Z',
      },
    ]);

    const sessions = blocks.filter((block) => block.kind === 'run_session');
    expect(sessions).toEqual([
      expect.objectContaining({ taskId: 'task-mode-real', modeLabel: 'Real' }),
      expect.objectContaining({ taskId: 'task-mode-verified', modeLabel: 'Real' }),
      expect.objectContaining({ taskId: 'task-mode-live', modeLabel: 'Real' }),
    ]);
  });

  it('keeps opaque replay ids unverified without over-claiming mode or target', () => {
    const blocks = normalizeHubRuntimeEventsToTranscript([
      {
        id: 'evt-fixture-shaped',
        task_id: 'fixture-task-opaque',
        edge_run_id: 'run-opaque',
        edge_device_id: 'mockish-device-id',
        adapter_id: 'codex-fixture-looking-adapter',
        session_id: 'hub-session-opaque',
        event_seq: 1,
        event_type: 'run.agent.text_block',
        payload: { content: 'Replay payload with opaque ids only.' },
        created_at: '2026-06-07T04:00:05Z',
      },
    ]);

    expect(blocks[0]).toEqual(expect.objectContaining({
      id: 'hub-runtime-session-fixture-task-opaque-run-opaque',
      kind: 'run_session',
      modeLabel: 'Replay',
      targetLabel: 'Edge run evidence',
      taskId: 'fixture-task-opaque',
      edgeRunId: 'run-opaque',
      deviceId: 'mockish-device-id',
      adapterId: 'codex-fixture-looking-adapter',
    }));
    expect(blocks[0]).not.toEqual(expect.objectContaining({
      modeLabel: 'Real',
    }));
    expect(blocks[0]).not.toEqual(expect.objectContaining({
      targetLabel: 'local_edge',
    }));
    expect(blocks[1]).toEqual(expect.objectContaining({
      kind: 'text',
      text: 'Replay payload with opaque ids only.',
    }));
  });

  it('keeps Hub @Agent, runtime, and target identity on the replay session block', () => {
    const blocks = normalizeHubRuntimeEventsToTranscript([
      {
        id: 'evt-identity',
        task_id: 'task-identity',
        edge_run_id: 'run-identity',
        edge_device_id: 'device-local-edge-1',
        adapter_id: 'claude-code',
        session_id: 'hub-session-identity',
        agent_instance_id: 'agent-instance-builder',
        event_seq: 1,
        event_type: 'run.agent.text_block',
        payload: {
          content: 'Identity-bearing runtime event.',
          display_name: 'Hub Builder',
          runtime_id: 'claude-code',
          target_label: 'Online Desktop Edge',
          evidence_mode: 'real',
        },
        created_at: '2026-06-07T04:00:08Z',
      },
    ]);

    expect(blocks[0]).toEqual(expect.objectContaining({
      kind: 'run_session',
      agentLabel: 'Hub Builder',
      runtimeLabel: 'claude-code',
      targetLabel: 'Online Desktop Edge',
      modeLabel: 'Real',
    }));
  });

  it('propagates Hub runtime agent identity onto replayed edge transcript blocks', () => {
    const blocks = normalizeHubRuntimeEventsToTranscript([
      {
        id: 'evt-reviewer-text',
        task_id: 'task-reviewer',
        edge_run_id: 'run-reviewer',
        session_id: 'hub-session-reviewer',
        agent_instance_id: 'agent-instance-reviewer',
        agent_label: 'Reviewer',
        event_seq: 1,
        event_type: 'run.agent.text_block',
        payload: { content: 'Reviewer replay report.' },
        created_at: '2026-06-07T04:00:09Z',
      },
    ]);

    expect(blocks[1]).toEqual(expect.objectContaining({
      kind: 'text',
      text: 'Reviewer replay report.',
      author: { id: 'agent-instance-reviewer', name: 'Reviewer', role: 'agent' },
    }));
  });

  it('projects permission, artifact, and terminal Hub replay events into stable transcript blocks', () => {
    const blocks = normalizeHubRuntimeEventsToTranscript([
      {
        id: 'evt-permission-requested',
        task_id: 'task-contract',
        edge_run_id: 'run-contract',
        session_id: 'hub-session-contract',
        event_seq: 1,
        event_type: 'run.agent.permission_requested',
        payload: {
          requestId: 'perm-write',
          toolName: 'Write',
          risk: 'high',
          reason: 'Needs workspace write approval.',
        },
        created_at: '2026-06-07T04:00:09Z',
      },
      {
        id: 'evt-permission-decided',
        task_id: 'task-contract',
        edge_run_id: 'run-contract',
        session_id: 'hub-session-contract',
        event_seq: 2,
        event_type: 'run.agent.permission_decided',
        payload: {
          requestId: 'perm-write',
          toolName: 'Write',
          decision: 'allow',
          reason: 'Approved by Web.',
        },
        created_at: '2026-06-07T04:00:10Z',
      },
      {
        id: 'evt-artifact-contract',
        task_id: 'task-contract',
        edge_run_id: 'run-contract',
        session_id: 'hub-session-contract',
        event_seq: 3,
        event_type: 'artifact.created',
        payload: {
          artifactId: 'artifact-report',
          path: 'reports/p0-transcript.md',
          mimeType: 'text/markdown',
        },
        created_at: '2026-06-07T04:00:11Z',
      },
      {
        id: 'evt-done-contract',
        task_id: 'task-contract-done',
        edge_run_id: 'run-contract-done',
        session_id: 'hub-session-contract',
        event_seq: 4,
        event_type: 'run.agent.result',
        payload: {
          runId: 'run-contract-done',
          success: true,
          summary: 'Done.',
        },
        created_at: '2026-06-07T04:00:12Z',
      },
      {
        id: 'evt-failed-contract',
        task_id: 'task-contract-failed',
        edge_run_id: 'run-contract-failed',
        session_id: 'hub-session-contract',
        event_seq: 5,
        event_type: 'run.failed',
        payload: {
          runId: 'run-contract-failed',
          error: 'Runtime failed.',
        },
        created_at: '2026-06-07T04:00:13Z',
      },
      {
        id: 'evt-cancel-contract',
        task_id: 'task-contract-cancel',
        edge_run_id: 'run-contract-cancel',
        session_id: 'hub-session-contract',
        event_seq: 6,
        event_type: 'run.cancelled',
        payload: {
          runId: 'run-contract-cancel',
          reason: 'Cancelled by user.',
        },
        created_at: '2026-06-07T04:00:14Z',
      },
    ]);

    expect(blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'permission_request',
        requestId: 'perm-write',
        status: 'pending',
        toolName: 'Write',
        risk: 'high',
      }),
      expect.objectContaining({
        kind: 'permission_result',
        requestId: 'perm-write',
        status: 'completed',
        decision: 'allow',
        toolName: 'Write',
      }),
      expect.objectContaining({
        kind: 'artifact',
        artifactId: 'artifact-report',
        title: 'reports/p0-transcript.md',
        path: 'reports/p0-transcript.md',
        mimeType: 'text/markdown',
        evidenceRefs: expect.arrayContaining([
          expect.objectContaining({
            id: 'artifact-artifact-report',
            kind: 'artifact',
            path: 'reports/p0-transcript.md',
            status: 'completed',
          }),
        ]),
      }),
      expect.objectContaining({
        kind: 'result',
        success: true,
        summary: 'Done.',
      }),
      expect.objectContaining({
        kind: 'failure',
        runId: 'run-contract-failed',
        reason: 'Runtime failed.',
      }),
      expect.objectContaining({
        kind: 'failure',
        runId: 'run-contract-cancel',
        title: 'Run run-contract-cancel cancelled',
        reason: 'Cancelled by user.',
      }),
    ]));
  });
});
