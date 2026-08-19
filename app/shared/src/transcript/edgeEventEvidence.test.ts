// real_tested=true
import { describe, expect, it } from 'vitest';
import type { EventEnvelope, EventScope } from '../events';
import {
  AGENT_AUTHOR,
  EDGE_AUTHOR,
  agentAuthorFromEvent,
  approvalEvidence,
  approvalHubContext,
  blockBase,
  eventRunId,
  fileEvidence,
  normalizeApprovalRisk,
  normalizeEvidenceStatus,
  normalizeFileAction,
  runEvidence,
  toolEvidence,
} from './edgeEventEvidence';
import type { EvidenceRef, EvidenceRefStatus, TranscriptAuthor } from './types';

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

const AGENT_ROLE: TranscriptAuthor = { id: 'agent', name: 'Agent', role: 'agent' };
const EDGE_ROLE: TranscriptAuthor = { id: 'edge', name: 'Edge', role: 'system' };

describe('author constants', () => {
  it('exports the canonical agent author', () => {
    expect(AGENT_AUTHOR).toEqual(AGENT_ROLE);
  });

  it('exports the canonical edge author', () => {
    expect(EDGE_AUTHOR).toEqual(EDGE_ROLE);
  });
});

describe('agentAuthorFromEvent', () => {
  it('derives the author from payload.agentId and payload.agentName', () => {
    expect(
      agentAuthorFromEvent(
        edgeEvent('evt-1', 1, 'run.agent.text_delta', { agentId: 'agent-7', agentName: 'Researcher' }),
      ),
    ).toEqual({ id: 'agent-7', name: 'Researcher', role: 'agent' });
  });

  it('falls back through legacy snake_case id fields in priority order', () => {
    expect(
      agentAuthorFromEvent(edgeEvent('evt-2', 2, 'run.agent.text_delta', { agent_id: 'a-2' })),
    ).toMatchObject({ id: 'a-2' });
    expect(
      agentAuthorFromEvent(
        edgeEvent('evt-3', 3, 'run.agent.text_delta', { agentInstanceId: 'a-3' }),
      ),
    ).toMatchObject({ id: 'a-3' });
    expect(
      agentAuthorFromEvent(
        edgeEvent('evt-4', 4, 'run.agent.text_delta', { agent_instance_id: 'a-4' }),
      ),
    ).toMatchObject({ id: 'a-4' });
    expect(
      agentAuthorFromEvent(edgeEvent('evt-5', 5, 'run.agent.text_delta', { workerId: 'w-5' })),
    ).toMatchObject({ id: 'w-5' });
    expect(
      agentAuthorFromEvent(edgeEvent('evt-6', 6, 'run.agent.text_delta', { worker_id: 'w-6' })),
    ).toMatchObject({ id: 'w-6' });
    expect(
      agentAuthorFromEvent(edgeEvent('evt-7', 7, 'run.agent.text_delta', { runnerId: 'r-7' })),
    ).toMatchObject({ id: 'r-7' });
    expect(
      agentAuthorFromEvent(edgeEvent('evt-8', 8, 'run.agent.text_delta', { runner_id: 'r-8' })),
    ).toMatchObject({ id: 'r-8' });
  });

  it('prefers the first non-empty payload id over later fields', () => {
    expect(
      agentAuthorFromEvent(
        edgeEvent('evt-9', 9, 'run.agent.text_delta', {
          agentId: 'primary',
          agent_id: 'legacy',
          workerId: 'worker',
        }),
      ),
    ).toMatchObject({ id: 'primary' });
  });

  it('reads the author id from scope fields when payload has none', () => {
    expect(
      agentAuthorFromEvent(
        edgeEvent('evt-10', 1, 'run.agent.text_delta', {}, undefined, { agentId: 'scope-a' }),
      ),
    ).toMatchObject({ id: 'scope-a' });
    expect(
      agentAuthorFromEvent(
        edgeEvent('evt-11', 2, 'run.agent.text_delta', {}, undefined, { agent_id: 'scope-b' }),
      ),
    ).toMatchObject({ id: 'scope-b' });
    expect(
      agentAuthorFromEvent(
        edgeEvent('evt-12', 3, 'run.agent.text_delta', {}, undefined, { agentInstanceId: 'scope-c' }),
      ),
    ).toMatchObject({ id: 'scope-c' });
    expect(
      agentAuthorFromEvent(
        edgeEvent('evt-13', 4, 'run.agent.text_delta', {}, undefined, { agent_instance_id: 'scope-d' }),
      ),
    ).toMatchObject({ id: 'scope-d' });
  });

  it('derives the id from the label via safeAuthorId when no explicit id exists', () => {
    expect(
      agentAuthorFromEvent(
        edgeEvent('evt-14', 5, 'run.agent.text_delta', { agentName: 'My Cool Agent!!' }),
      ),
    ).toEqual({ id: 'my-cool-agent', name: 'My Cool Agent!!', role: 'agent' });
  });

  it('falls back to the canonical agent id when the label sanitizes to nothing', () => {
    expect(
      agentAuthorFromEvent(edgeEvent('evt-15', 6, 'run.agent.text_delta', { agentName: '!!!' })),
    ).toEqual({ id: 'agent', name: '!!!', role: 'agent' });
  });

  it('falls back through legacy label fields in priority order', () => {
    expect(
      agentAuthorFromEvent(edgeEvent('evt-16', 7, 'run.agent.text_delta', { agent_name: 'n-16' })),
    ).toMatchObject({ name: 'n-16' });
    expect(
      agentAuthorFromEvent(edgeEvent('evt-17', 8, 'run.agent.text_delta', { agentLabel: 'l-17' })),
    ).toMatchObject({ name: 'l-17' });
    expect(
      agentAuthorFromEvent(edgeEvent('evt-18', 9, 'run.agent.text_delta', { agent_label: 'l-18' })),
    ).toMatchObject({ name: 'l-18' });
    expect(
      agentAuthorFromEvent(edgeEvent('evt-19', 1, 'run.agent.text_delta', { displayName: 'd-19' })),
    ).toMatchObject({ name: 'd-19' });
    expect(
      agentAuthorFromEvent(edgeEvent('evt-20', 2, 'run.agent.text_delta', { display_name: 'd-20' })),
    ).toMatchObject({ name: 'd-20' });
    expect(
      agentAuthorFromEvent(edgeEvent('evt-21', 3, 'run.agent.text_delta', { workerName: 'w-21' })),
    ).toMatchObject({ name: 'w-21' });
    expect(
      agentAuthorFromEvent(edgeEvent('evt-22', 4, 'run.agent.text_delta', { worker_name: 'w-22' })),
    ).toMatchObject({ name: 'w-22' });
    expect(
      agentAuthorFromEvent(edgeEvent('evt-23', 5, 'run.agent.text_delta', { worker: 'w-23' })),
    ).toMatchObject({ name: 'w-23' });
    expect(
      agentAuthorFromEvent(edgeEvent('evt-24', 6, 'run.agent.text_delta', { agent: 'a-24' })),
    ).toMatchObject({ name: 'a-24' });
    expect(
      agentAuthorFromEvent(edgeEvent('evt-25', 7, 'run.agent.text_delta', { runnerName: 'r-25' })),
    ).toMatchObject({ name: 'r-25' });
    expect(
      agentAuthorFromEvent(edgeEvent('evt-26', 8, 'run.agent.text_delta', { runner_name: 'r-26' })),
    ).toMatchObject({ name: 'r-26' });
    expect(
      agentAuthorFromEvent(edgeEvent('evt-27', 9, 'run.agent.text_delta', { adapterLabel: 'ad-27' })),
    ).toMatchObject({ name: 'ad-27' });
    expect(
      agentAuthorFromEvent(edgeEvent('evt-28', 1, 'run.agent.text_delta', { adapter_label: 'ad-28' })),
    ).toMatchObject({ name: 'ad-28' });
  });

  it('uses the explicit id for the name when no label exists', () => {
    expect(
      agentAuthorFromEvent(edgeEvent('evt-29', 2, 'run.agent.text_delta', { agentId: 'a-29' })),
    ).toEqual({ id: 'a-29', name: 'a-29', role: 'agent' });
  });

  it('returns the canonical agent author when the event has no author fields', () => {
    expect(agentAuthorFromEvent(edgeEvent('evt-30', 3, 'run.agent.text_delta', {}))).toEqual(
      AGENT_ROLE,
    );
  });

  it('treats whitespace-only and non-string fields as missing', () => {
    expect(
      agentAuthorFromEvent(
        edgeEvent('evt-31', 4, 'run.agent.text_delta', { agentId: '   ', agentName: '\t ' }),
      ),
    ).toEqual(AGENT_ROLE);
    expect(
      agentAuthorFromEvent(
        edgeEvent('evt-32', 5, 'run.agent.text_delta', { agentId: 42, agentName: ['x'] }),
      ),
    ).toEqual(AGENT_ROLE);
  });

  it('trims whitespace from explicit ids and labels', () => {
    expect(
      agentAuthorFromEvent(
        edgeEvent('evt-33', 6, 'run.agent.text_delta', { agentId: '  a-33  ', agentName: '  N33  ' }),
      ),
    ).toEqual({ id: 'a-33', name: 'N33', role: 'agent' });
  });
});

describe('blockBase', () => {
  const author: TranscriptAuthor = { id: 'edge', name: 'Edge', role: 'system' };
  const runRef: EvidenceRef = { id: 'run-r1', kind: 'run', label: 'Run r1', status: 'running' };

  it('builds the block id from the event id', () => {
    const base = blockBase(edgeEvent('evt-b1', 1, 'run.started', {}), author, []);
    expect(base.id).toBe('edge-event-evt-b1');
    expect(base.author).toEqual(author);
  });

  it('includes createdAt from sentAt and evidenceRefs when provided', () => {
    expect(blockBase(edgeEvent('evt-b2', 2, 'run.started', {}, '2026-06-07T03:00:02Z'), author, [runRef])).toEqual({
      id: 'edge-event-evt-b2',
      author,
      createdAt: '2026-06-07T03:00:02Z',
      evidenceRefs: [runRef],
    });
  });

  it('omits createdAt when sentAt is empty', () => {
    const base = blockBase(edgeEvent('evt-b3', 3, 'run.started', {}, ''), author, [runRef]);
    expect(base.createdAt).toBeUndefined();
    expect(base.evidenceRefs).toEqual([runRef]);
  });

  it('omits evidenceRefs when the ref list is empty', () => {
    const base = blockBase(edgeEvent('evt-b4', 4, 'run.started', {}), author, []);
    expect(base.evidenceRefs).toBeUndefined();
  });
});

describe('runEvidence', () => {
  it('returns an empty list for undefined and empty run ids', () => {
    expect(runEvidence(undefined, 'running')).toEqual([]);
    expect(runEvidence('', 'running')).toEqual([]);
  });

  it('builds a run ref with the id prefix and run label', () => {
    expect(runEvidence('run-9', 'completed')).toEqual([
      { id: 'run-run-9', kind: 'run', label: 'Run run-9', status: 'completed' },
    ]);
  });

  it('passes through the status verbatim', () => {
    expect(runEvidence('run-10', 'failed')).toEqual([
      { id: 'run-run-10', kind: 'run', label: 'Run run-10', status: 'failed' },
    ]);
    expect(runEvidence('run-11', 'pending')).toEqual([
      { id: 'run-run-11', kind: 'run', label: 'Run run-11', status: 'pending' },
    ]);
  });
});

describe('toolEvidence', () => {
  it('returns an empty list for undefined and empty ids', () => {
    expect(toolEvidence(undefined, 'Tool', 'running')).toEqual([]);
    expect(toolEvidence('', 'Tool', 'running')).toEqual([]);
  });

  it('builds a tool ref with the id prefix and provided label', () => {
    expect(toolEvidence('call-1', 'read_file', 'completed')).toEqual([
      { id: 'tool-call-1', kind: 'tool', label: 'read_file', status: 'completed' },
    ]);
  });

  it('preserves a label that differs from the id', () => {
    expect(toolEvidence('call-2', 'Run bash command', 'failed')).toEqual([
      { id: 'tool-call-2', kind: 'tool', label: 'Run bash command', status: 'failed' },
    ]);
  });
});

describe('approvalEvidence', () => {
  it('keeps labels that already contain "approval" and trims them', () => {
    expect(approvalEvidence('ap-1', '  tool approval  ', 'pending')).toEqual({
      id: 'approval-ap-1',
      kind: 'approval',
      label: 'tool approval',
      status: 'pending',
    });
  });

  it('appends " approval" to labels without the word', () => {
    expect(approvalEvidence('ap-2', 'tool call', 'failed')).toEqual({
      id: 'approval-ap-2',
      kind: 'approval',
      label: 'tool call approval',
      status: 'failed',
    });
  });

  it('matches the word approval case-insensitively', () => {
    expect(approvalEvidence('ap-3', 'Tool APPROVAL', 'completed')).toEqual({
      id: 'approval-ap-3',
      kind: 'approval',
      label: 'Tool APPROVAL',
      status: 'completed',
    });
  });

  it('preserves status and prefixes the id', () => {
    expect(approvalEvidence('ap-4', 'x', 'running')).toEqual({
      id: 'approval-ap-4',
      kind: 'approval',
      label: 'x approval',
      status: 'running',
    });
  });
});

describe('approvalHubContext', () => {
  it('extracts all fields from payload snake_case keys', () => {
    expect(
      approvalHubContext(
        edgeEvent('evt-h1', 1, 'approval.requested', {
          team_id: 'team-1',
          team_run_id: 'team-run-1',
          agent_task_id: 'task-1',
          target_id: 'target-1',
          edge_device_id: 'device-1',
          correlation_id: 'corr-1',
        }),
      ),
    ).toEqual({
      teamId: 'team-1',
      teamRunId: 'team-run-1',
      agentTaskId: 'task-1',
      targetId: 'target-1',
      edgeDeviceId: 'device-1',
      correlationId: 'corr-1',
    });
  });

  it('falls back to payload camelCase keys', () => {
    expect(
      approvalHubContext(
        edgeEvent('evt-h2', 2, 'approval.requested', {
          teamId: 'team-2',
          teamRunId: 'team-run-2',
          agentTaskId: 'task-2',
          targetId: 'target-2',
          edgeDeviceId: 'device-2',
          correlationId: 'corr-2',
        }),
      ),
    ).toEqual({
      teamId: 'team-2',
      teamRunId: 'team-run-2',
      agentTaskId: 'task-2',
      targetId: 'target-2',
      edgeDeviceId: 'device-2',
      correlationId: 'corr-2',
    });
  });

  it('falls back through run_id and runId for teamRunId', () => {
    expect(
      approvalHubContext(edgeEvent('evt-h3', 3, 'approval.requested', { run_id: 'r-3' })),
    ).toEqual({ teamRunId: 'r-3' });
    expect(
      approvalHubContext(edgeEvent('evt-h4', 4, 'approval.requested', { runId: 'r-4' })),
    ).toEqual({ teamRunId: 'r-4' });
    expect(
      approvalHubContext(
        edgeEvent('evt-h5', 5, 'approval.requested', { run_id: 'r-5', runId: 'r-6' }),
      ),
    ).toEqual({ teamRunId: 'r-5' });
  });

  it('falls back to scope fields for task, target, and device ids', () => {
    expect(
      approvalHubContext(
        edgeEvent('evt-h6', 6, 'approval.requested', {}, undefined, {
          taskId: 'scope-task',
          targetId: 'scope-target',
          deviceId: 'scope-device',
        }),
      ),
    ).toEqual({
      agentTaskId: 'scope-task',
      targetId: 'scope-target',
      edgeDeviceId: 'scope-device',
    });
  });

  it('omits keys for fields that are absent', () => {
    expect(approvalHubContext(edgeEvent('evt-h7', 7, 'approval.requested', { team_id: 't-7' }))).toEqual({
      teamId: 't-7',
    });
    expect(approvalHubContext(edgeEvent('evt-h8', 8, 'approval.requested', {}))).toEqual({});
  });

  it('trims whitespace and ignores non-string values', () => {
    expect(
      approvalHubContext(
        edgeEvent('evt-h9', 9, 'approval.requested', {
          team_id: '  t-9  ',
          team_run_id: 5,
          correlation_id: '',
        }),
      ),
    ).toEqual({ teamId: 't-9' });
  });
});

describe('fileEvidence', () => {
  it('builds a file ref carrying the path in the id, label, and path fields', () => {
    expect(fileEvidence('src/main.ts')).toEqual({
      id: 'file-src/main.ts',
      kind: 'file',
      label: 'src/main.ts',
      path: 'src/main.ts',
    });
  });

  it('handles nested and whitespace-heavy paths verbatim', () => {
    expect(fileEvidence('/tmp/a b/c.txt')).toEqual({
      id: 'file-/tmp/a b/c.txt',
      kind: 'file',
      label: '/tmp/a b/c.txt',
      path: '/tmp/a b/c.txt',
    });
  });
});

describe('eventRunId', () => {
  it('prefers payload.runId over scope.runId', () => {
    expect(
      eventRunId(edgeEvent('evt-r1', 1, 'run.started', { runId: 'payload-run' }, undefined, { runId: 'scope-run' })),
    ).toBe('payload-run');
  });

  it('falls back to scope.runId when the payload has none', () => {
    expect(eventRunId(edgeEvent('evt-r2', 2, 'run.started', {}, undefined, { runId: 'scope-run' }))).toBe(
      'scope-run',
    );
  });

  it('returns undefined when neither payload nor scope has a run id', () => {
    expect(eventRunId(edgeEvent('evt-r3', 3, 'run.started', {}))).toBeUndefined();
  });

  it('treats whitespace-only run ids as missing', () => {
    expect(
      eventRunId(edgeEvent('evt-r4', 4, 'run.started', { runId: '   ' }, undefined, { runId: 'scope-run' })),
    ).toBe('scope-run');
    expect(
      eventRunId(edgeEvent('evt-r5', 5, 'run.started', {}, undefined, { runId: '  ' })),
    ).toBeUndefined();
  });
});

describe('normalizeEvidenceStatus', () => {
  const pendingStatuses = ['pending', 'queued'];
  const runningStatuses = ['running', 'starting', 'streaming', 'draining'];
  const failedStatuses = ['failed', 'cancelled', 'error', 'denied', 'rejected'];
  const completedStatuses = ['completed', 'finished', 'succeeded', 'success', 'approved', 'ready'];

  it.each(pendingStatuses)('maps %s to pending', (status) => {
    expect(normalizeEvidenceStatus(status)).toBe<EvidenceRefStatus>('pending');
  });

  it.each(runningStatuses)('maps %s to running', (status) => {
    expect(normalizeEvidenceStatus(status)).toBe<EvidenceRefStatus>('running');
  });

  it.each(failedStatuses)('maps %s to failed', (status) => {
    expect(normalizeEvidenceStatus(status)).toBe<EvidenceRefStatus>('failed');
  });

  it.each(completedStatuses)('maps %s to completed', (status) => {
    expect(normalizeEvidenceStatus(status)).toBe<EvidenceRefStatus>('completed');
  });

  it('defaults unknown and undefined statuses to running', () => {
    expect(normalizeEvidenceStatus(undefined)).toBe('running');
    expect(normalizeEvidenceStatus('bogus')).toBe('running');
    expect(normalizeEvidenceStatus('')).toBe('running');
  });

  it('trims surrounding whitespace before matching', () => {
    expect(normalizeEvidenceStatus('  pending  ')).toBe('pending');
    expect(normalizeEvidenceStatus('\tcompleted\n')).toBe('completed');
  });
});

describe('normalizeApprovalRisk', () => {
  it('returns undefined for missing or unknown risks', () => {
    expect(normalizeApprovalRisk(undefined)).toBeUndefined();
    expect(normalizeApprovalRisk('')).toBeUndefined();
    expect(normalizeApprovalRisk('catastrophic')).toBeUndefined();
  });

  it('maps english risk levels', () => {
    expect(normalizeApprovalRisk('low')).toBe('low');
    expect(normalizeApprovalRisk('medium')).toBe('medium');
    expect(normalizeApprovalRisk('mid')).toBe('medium');
    expect(normalizeApprovalRisk('high')).toBe('high');
    expect(normalizeApprovalRisk('critical')).toBe('critical');
  });

  it('maps chinese risk levels', () => {
    expect(normalizeApprovalRisk('低风险')).toBe('low');
    expect(normalizeApprovalRisk('中风险')).toBe('medium');
    expect(normalizeApprovalRisk('高风险')).toBe('high');
    expect(normalizeApprovalRisk('关键风险')).toBe('critical');
  });

  it('trims and lowercases input before matching', () => {
    expect(normalizeApprovalRisk('  HIGH  ')).toBe('high');
    expect(normalizeApprovalRisk('\tCritical\n')).toBe('critical');
  });

  it('does not match partially overlapping words', () => {
    expect(normalizeApprovalRisk('medium-high')).toBeUndefined();
    expect(normalizeApprovalRisk('lower')).toBeUndefined();
  });
});

describe('normalizeFileAction', () => {
  it('maps create variants to created', () => {
    expect(normalizeFileAction('created')).toBe('created');
    expect(normalizeFileAction('create')).toBe('created');
    expect(normalizeFileAction('added')).toBe('created');
    expect(normalizeFileAction('add')).toBe('created');
  });

  it('maps delete variants to deleted', () => {
    expect(normalizeFileAction('deleted')).toBe('deleted');
    expect(normalizeFileAction('delete')).toBe('deleted');
    expect(normalizeFileAction('removed')).toBe('deleted');
    expect(normalizeFileAction('remove')).toBe('deleted');
  });

  it('defaults any other value to modified', () => {
    expect(normalizeFileAction('modified')).toBe('modified');
    expect(normalizeFileAction('update')).toBe('modified');
    expect(normalizeFileAction('rewrote')).toBe('modified');
  });

  it('defaults missing actions to modified', () => {
    expect(normalizeFileAction(undefined)).toBe('modified');
    expect(normalizeFileAction('')).toBe('modified');
  });

  it('trims and lowercases input before matching', () => {
    expect(normalizeFileAction('  ADD  ')).toBe('created');
    expect(normalizeFileAction('\tDelete\n')).toBe('deleted');
  });
});
