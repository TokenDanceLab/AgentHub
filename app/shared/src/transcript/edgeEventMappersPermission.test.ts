// real_tested=true
import { describe, expect, it } from 'vitest';
import type { EventEnvelope, EventScope } from '../events';
import { EDGE_AUTHOR } from './edgeEventEvidence';
import {
  permissionDecidedBlock,
  permissionRequestedBlock,
} from './edgeEventMappersPermission';

function edgeEvent(
  id: string,
  seq: number,
  type: string,
  payload: Record<string, unknown>,
  sentAt = `2026-06-07T03:00:0${seq}Z`,
  scopeOverrides: EventScope = {},
): EventEnvelope {
  return {
    version: 'v1',
    id,
    seq,
    type,
    scope: {
      threadId: 'thread-live',
      runId: typeof payload.runId === 'string' ? payload.runId : undefined,
      ...scopeOverrides,
    },
    sentAt,
    payload,
  };
}

describe('permissionRequestedBlock', () => {
  it('builds a permission_request block with title, risk, and hub context', () => {
    expect(
      permissionRequestedBlock(
        edgeEvent('evt-pr', 1, 'run.agent.permission_requested', {
          runId: 'run-1',
          requestId: 'req-1',
          title: 'Write to disk',
          toolName: 'write_file',
          risk: 'high',
          description: 'writes 3 files',
          team_id: 'team-1',
        }),
      ),
    ).toEqual({
      id: 'edge-event-evt-pr',
      author: EDGE_AUTHOR,
      createdAt: '2026-06-07T03:00:01Z',
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'pending' },
        { id: 'approval-req-1', kind: 'approval', label: 'write_file approval', status: 'pending' },
      ],
      kind: 'permission_request',
      requestId: 'req-1',
      title: 'Write to disk',
      status: 'pending',
      teamId: 'team-1',
      teamRunId: 'run-1',
      toolName: 'write_file',
      risk: 'high',
      reason: 'writes 3 files',
    });
  });

  it('falls back to approvalId for the request id', () => {
    const block = permissionRequestedBlock(
      edgeEvent('evt-pr2', 2, 'run.agent.permission_requested', {
        runId: 'run-2',
        approvalId: 'approval-2',
        toolName: 'shell',
      }),
    );
    expect(block?.requestId).toBe('approval-2');
    expect(block?.evidenceRefs?.[1]).toEqual({
      id: 'approval-approval-2',
      kind: 'approval',
      label: 'shell approval',
      status: 'pending',
    });
  });

  it('uses the event id as requestId and drops approval evidence when none is provided', () => {
    const block = permissionRequestedBlock(
      edgeEvent('evt-pr3', 3, 'run.agent.permission_requested', {
        runId: 'run-3',
        toolName: 'shell',
      }),
    );
    expect(block?.requestId).toBe('evt-pr3');
    expect(block?.evidenceRefs).toEqual([
      { id: 'run-run-3', kind: 'run', label: 'Run run-3', status: 'pending' },
    ]);
  });

  it('derives the toolName from kind and falls back to the title', () => {
    const byKind = permissionRequestedBlock(
      edgeEvent('evt-pr4', 4, 'run.agent.permission_requested', {
        requestId: 'req-4',
        kind: 'browse',
      }),
    );
    expect(byKind?.toolName).toBe('browse');
    expect(byKind?.title).toBe('Permission requested: browse');

    const byTitle = permissionRequestedBlock(
      edgeEvent('evt-pr5', 5, 'run.agent.permission_requested', {
        requestId: 'req-5',
        title: 'Open external link',
      }),
    );
    expect(byTitle?.toolName).toBe('Open external link');
    expect(byTitle?.title).toBe('Open external link');
  });

  it('defaults the toolName to permission when no name source is present', () => {
    const block = permissionRequestedBlock(
      edgeEvent('evt-pr6', 6, 'run.agent.permission_requested', { requestId: 'req-6' }),
    );
    expect(block?.toolName).toBe('permission');
    expect(block?.title).toBe('Permission requested: permission');
  });

  it('normalizes risk labels and omits unknown risk values', () => {
    const chineseRisk = permissionRequestedBlock(
      edgeEvent('evt-pr7', 7, 'run.agent.permission_requested', {
        requestId: 'req-7',
        riskLevel: '低风险',
      }),
    );
    expect(chineseRisk?.risk).toBe('low');

    const unknownRisk = permissionRequestedBlock(
      edgeEvent('evt-pr8', 8, 'run.agent.permission_requested', {
        requestId: 'req-8',
        risk: 'mystery',
      }),
    );
    expect(unknownRisk).not.toHaveProperty('risk');

    const criticalRisk = permissionRequestedBlock(
      edgeEvent('evt-pr8b', 9, 'run.agent.permission_requested', {
        requestId: 'req-8b',
        riskLevel: 'critical',
      }),
    );
    expect(criticalRisk?.risk).toBe('critical');
  });

  it('falls back through description, reason, summary, command, and path for the reason', () => {
    const byReason = permissionRequestedBlock(
      edgeEvent('evt-pr9', 9, 'run.agent.permission_requested', {
        requestId: 'req-9',
        reason: 'user asked',
      }),
    );
    expect(byReason?.reason).toBe('user asked');

    const bySummary = permissionRequestedBlock(
      edgeEvent('evt-pr10', 1, 'run.agent.permission_requested', {
        requestId: 'req-10',
        summary: 'summarized',
      }),
    );
    expect(bySummary?.reason).toBe('summarized');

    const byCommand = permissionRequestedBlock(
      edgeEvent('evt-pr11', 2, 'run.agent.permission_requested', {
        requestId: 'req-11',
        command: 'rm -rf /tmp/x',
      }),
    );
    expect(byCommand?.reason).toBe('rm -rf /tmp/x');

    const byPath = permissionRequestedBlock(
      edgeEvent('evt-pr12', 3, 'run.agent.permission_requested', {
        requestId: 'req-12',
        path: '/etc/hosts',
      }),
    );
    expect(byPath?.reason).toBe('/etc/hosts');
  });

  it('collects hub context fields from payload and scope', () => {
    const block = permissionRequestedBlock(
      edgeEvent('evt-pr13', 4, 'run.agent.permission_requested', {
        requestId: 'req-13',
        toolName: 'shell',
        team_id: 'team-13',
        team_run_id: 'team-run-13',
        agent_task_id: 'task-13',
        target_id: 'target-13',
        edge_device_id: 'device-13',
        correlation_id: 'corr-13',
      }),
    );
    expect(block).toMatchObject({
      teamId: 'team-13',
      teamRunId: 'team-run-13',
      agentTaskId: 'task-13',
      targetId: 'target-13',
      edgeDeviceId: 'device-13',
      correlationId: 'corr-13',
    });
  });

  it('falls back to scope fields for agent task, target, and device ids', () => {
    const block = permissionRequestedBlock(
      edgeEvent('evt-pr14', 5, 'run.agent.permission_requested', {
        requestId: 'req-14',
        toolName: 'shell',
      }, undefined, {
        taskId: 'task-scope',
        targetId: 'target-scope',
        deviceId: 'device-scope',
      }),
    );
    expect(block).toMatchObject({
      agentTaskId: 'task-scope',
      targetId: 'target-scope',
      edgeDeviceId: 'device-scope',
    });
  });
});

describe('permissionDecidedBlock', () => {
  it('builds a permission_result block for an allow decision', () => {
    expect(
      permissionDecidedBlock(
        edgeEvent('evt-pd', 1, 'run.agent.permission_decided', {
          runId: 'run-1',
          requestId: 'req-1',
          decision: 'allow',
          toolName: 'write_file',
        }),
      ),
    ).toEqual({
      id: 'edge-event-evt-pd',
      author: EDGE_AUTHOR,
      createdAt: '2026-06-07T03:00:01Z',
      evidenceRefs: [
        { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'completed' },
        { id: 'approval-req-1', kind: 'approval', label: 'write_file approval', status: 'completed' },
      ],
      kind: 'permission_result',
      requestId: 'req-1',
      title: 'Permission allow: write_file',
      status: 'completed',
      decision: 'allow',
      teamRunId: 'run-1',
      toolName: 'write_file',
    });
  });

  it('marks deny and rejected decisions as failed', () => {
    const denied = permissionDecidedBlock(
      edgeEvent('evt-pd2', 2, 'run.agent.permission_decided', {
        requestId: 'req-2',
        decision: 'deny',
      }),
    );
    expect(denied?.status).toBe('failed');
    expect(denied?.evidenceRefs?.[0]?.status).toBe('failed');

    const rejected = permissionDecidedBlock(
      edgeEvent('evt-pd3', 3, 'run.agent.permission_decided', {
        requestId: 'req-3',
        decision: 'rejected',
      }),
    );
    expect(rejected?.status).toBe('failed');
  });

  it('defaults the decision to decided when missing', () => {
    const block = permissionDecidedBlock(
      edgeEvent('evt-pd4', 4, 'run.agent.permission_decided', {
        requestId: 'req-4',
        toolName: 'shell',
      }),
    );
    expect(block?.decision).toBe('decided');
    expect(block?.title).toBe('Permission decided: shell');
    expect(block?.status).toBe('completed');
  });

  it('uses the event id as requestId when none is provided', () => {
    const block = permissionDecidedBlock(
      edgeEvent('evt-pd5', 5, 'run.agent.permission_decided', {
        runId: 'run-5',
        decision: 'deny',
        toolName: 'shell',
      }),
    );
    expect(block?.requestId).toBe('evt-pd5');
    expect(block?.evidenceRefs).toEqual([
      { id: 'run-run-5', kind: 'run', label: 'Run run-5', status: 'failed' },
    ]);
  });

  it('falls back to approvalId and kind for the request id and tool name', () => {
    const block = permissionDecidedBlock(
      edgeEvent('evt-pd6', 6, 'run.agent.permission_decided', {
        approvalId: 'approval-6',
        kind: 'browse',
        decision: 'allow',
      }),
    );
    expect(block?.requestId).toBe('approval-6');
    expect(block?.toolName).toBe('browse');
  });

  it('derives the reason from reason, then summary', () => {
    const byReason = permissionDecidedBlock(
      edgeEvent('evt-pd7', 7, 'run.agent.permission_decided', {
        requestId: 'req-7',
        reason: 'declined by user',
      }),
    );
    expect(byReason?.reason).toBe('declined by user');

    const bySummary = permissionDecidedBlock(
      edgeEvent('evt-pd8', 8, 'run.agent.permission_decided', {
        requestId: 'req-8',
        summary: 'summarized result',
      }),
    );
    expect(bySummary?.reason).toBe('summarized result');
  });

  it('collects hub context fields from payload', () => {
    const block = permissionDecidedBlock(
      edgeEvent('evt-pd9', 9, 'run.agent.permission_decided', {
        requestId: 'req-9',
        decision: 'allow',
        team_id: 'team-9',
        run_id: 'run-9',
        agent_task_id: 'task-9',
      }),
    );
    expect(block).toMatchObject({
      teamId: 'team-9',
      teamRunId: 'run-9',
      agentTaskId: 'task-9',
    });
  });
});
