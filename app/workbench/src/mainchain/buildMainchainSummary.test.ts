// real_tested=true
import { describe, expect, it } from 'vitest';
import type { AgentHubPlatform } from '@shared/platform';
import type {
  AgentTimelineTranscriptBlock,
  ApprovalTranscriptBlock,
  ChildAgentTranscriptBlock,
  EvidenceRef,
  PermissionRequestTranscriptBlock,
  RouteDecisionTranscriptBlock,
  RunSessionTranscriptBlock,
  RunStepGroupTranscriptBlock,
  SubagentTranscriptBlock,
  SubtaskTranscriptBlock,
  TextTranscriptBlock,
  ToolCallTranscriptBlock,
} from '@shared/transcript';
import type { Artifact, Preview } from '@shared/types';
import type { FileDiff } from '@shared/types/chat';
import type { RuntimeEvidenceSnapshot } from '@shared/inspector';
import { buildMainchainSummary, runtimeEvidenceSourceSummary } from './buildMainchainSummary';
import type { MainchainSummary } from './types';

type SummaryInput = Parameters<typeof buildMainchainSummary>[0];

const EXPORT_DETAIL =
  'Copy Web -> Hub task -> target -> Edge -> replay/artifact/approval evidence JSON';

function t(key: string): string {
  return key;
}

function author(name: string) {
  return { id: `author-${name}`, name, role: 'agent' as const };
}

function textBlock(overrides: Partial<TextTranscriptBlock> = {}): TextTranscriptBlock {
  return {
    kind: 'text',
    id: 'text-1',
    author: author('assistant'),
    text: 'hello',
    ...overrides,
  };
}

function runSessionBlock(
  overrides: Partial<RunSessionTranscriptBlock> = {},
): RunSessionTranscriptBlock {
  return {
    kind: 'run_session',
    id: 'run-session-1',
    author: author('orchestrator'),
    title: 'Run session',
    ...overrides,
  };
}

function routeBlock(
  overrides: Partial<RouteDecisionTranscriptBlock> = {},
): RouteDecisionTranscriptBlock {
  return {
    kind: 'route_decision',
    id: 'route-1',
    author: author('dispatcher'),
    action: 'dispatch',
    ...overrides,
  };
}

function subagentBlock(
  overrides: Partial<SubagentTranscriptBlock> = {},
): SubagentTranscriptBlock {
  return {
    kind: 'subagent',
    id: 'subagent-1',
    author: author('agent'),
    title: 'Subagent',
    worker: 'builder',
    status: 'running',
    ...overrides,
  };
}

function subtaskBlock(overrides: Partial<SubtaskTranscriptBlock> = {}): SubtaskTranscriptBlock {
  return {
    kind: 'subtask',
    id: 'subtask-1',
    author: author('agent'),
    title: 'Subtask',
    status: 'running',
    ...overrides,
  };
}

function childAgentBlock(
  overrides: Partial<ChildAgentTranscriptBlock> = {},
): ChildAgentTranscriptBlock {
  return {
    kind: 'child_agent',
    id: 'child-1',
    author: author('agent'),
    title: 'Child agent',
    agent: 'inspector',
    status: 'running',
    ...overrides,
  };
}

function toolCallBlock(
  overrides: Partial<ToolCallTranscriptBlock> = {},
): ToolCallTranscriptBlock {
  return {
    kind: 'tool_call',
    id: 'tool-1',
    author: author('agent'),
    toolName: 'bash',
    status: 'completed',
    ...overrides,
  };
}

function agentTimelineBlock(
  overrides: Partial<AgentTimelineTranscriptBlock> = {},
): AgentTimelineTranscriptBlock {
  return {
    kind: 'agent_timeline',
    id: 'timeline-1',
    author: author('agent'),
    items: [],
    ...overrides,
  };
}

function runStepGroupBlock(
  overrides: Partial<RunStepGroupTranscriptBlock> = {},
): RunStepGroupTranscriptBlock {
  return {
    kind: 'run_step_group',
    id: 'group-1',
    author: author('agent'),
    icon: 'steps',
    title: 'Steps',
    status: 'completed',
    children: [],
    ...overrides,
  };
}

function approvalBlock(
  overrides: Partial<ApprovalTranscriptBlock> = {},
): ApprovalTranscriptBlock {
  return {
    kind: 'approval',
    id: 'approval-1',
    author: author('reviewer'),
    title: 'Approve file',
    status: 'pending',
    ...overrides,
  };
}

function permissionRequestBlock(
  overrides: Partial<PermissionRequestTranscriptBlock> = {},
): PermissionRequestTranscriptBlock {
  return {
    kind: 'permission_request',
    id: 'permission-1',
    author: author('guard'),
    requestId: 'req-1',
    title: 'Permission request',
    status: 'pending',
    ...overrides,
  };
}

function evidenceRef(kind: EvidenceRef['kind']): EvidenceRef {
  return { id: `ref-${kind}`, kind, label: `label-${kind}` };
}

function fileDiffFixture(overrides: Partial<FileDiff> = {}): FileDiff {
  return {
    filePath: 'src/app.ts',
    status: 'modified',
    additions: 2,
    deletions: 1,
    hunks: [],
    ...overrides,
  };
}

function artifactFixture(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'artifact-1',
    runId: 'run-1',
    threadId: 'thread-1',
    kind: 'file',
    path: 'out/report.md',
    sizeBytes: 128,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function previewFixture(overrides: Partial<Preview> = {}): Preview {
  return {
    id: 'preview-1',
    runId: 'run-1',
    threadId: 'thread-1',
    status: 'ready',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function runtimeSnapshot(overrides: Partial<RuntimeEvidenceSnapshot> = {}): RuntimeEvidenceSnapshot {
  return {
    diffs: [],
    artifacts: [],
    previews: [],
    ...overrides,
  };
}

function baseProps(overrides: Partial<SummaryInput> = {}): SummaryInput {
  return {
    evidence: [],
    platformSurface: 'web',
    selectedExecutionTargetId: '',
    targetRequired: false,
    transcript: [],
    t,
    ...overrides,
  };
}

function nodeOf(summary: MainchainSummary, id: string) {
  const found = summary.nodes.find((candidate) => candidate.id === id);
  if (!found) {
    throw new Error(`Missing node: ${id}`);
  }
  return found;
}

describe('buildMainchainSummary', () => {
  it('builds nine waiting/empty nodes and disables export for fully empty inputs', () => {
    const summary = buildMainchainSummary(baseProps());

    expect(summary.nodes.map((node) => node.id)).toEqual([
      'web',
      'hub-task',
      'supervisor',
      'worker',
      'route-event',
      'target',
      'edge',
      'replay',
      'evidence-path',
    ]);
    expect(nodeOf(summary, 'web')).toEqual({
      id: 'web',
      label: 'Web',
      detail: 'Shared/Web workbench',
      state: 'done',
    });
    expect(nodeOf(summary, 'hub-task')).toEqual({
      id: 'hub-task',
      label: 'Hub task',
      detail: 'mainchain.waitingTask',
      state: 'waiting',
    });
    expect(nodeOf(summary, 'supervisor')).toEqual({
      id: 'supervisor',
      label: 'Supervisor',
      detail: 'Supervisor',
      state: 'waiting',
    });
    expect(nodeOf(summary, 'worker')).toEqual({
      id: 'worker',
      label: 'Worker',
      detail: 'mainchain.waitingWorker',
      state: 'waiting',
    });
    expect(nodeOf(summary, 'route-event')).toEqual({
      id: 'route-event',
      label: 'Route + event',
      detail: '0 route / 0 event',
      state: 'empty',
    });
    expect(nodeOf(summary, 'target')).toEqual({
      id: 'target',
      label: 'Exact target',
      detail: 'mainchain.pickTarget',
      state: 'empty',
    });
    expect(nodeOf(summary, 'edge')).toEqual({
      id: 'edge',
      label: 'Active run',
      detail: 'mainchain.waitingEdgeEvidence',
      state: 'waiting',
    });
    expect(nodeOf(summary, 'replay')).toEqual({
      id: 'replay',
      label: 'Replay',
      detail: 'mainchain.noTranscript',
      state: 'empty',
    });
    expect(nodeOf(summary, 'evidence-path')).toEqual({
      id: 'evidence-path',
      label: 'Approval/artifact',
      detail: 'mainchain.noApprovalArtifact',
      state: 'empty',
    });
    expect(summary.exportEnabled).toBe(false);
    expect(summary.exportLabel).toBe('mainchain.waitingEvidence');
    expect(summary.exportDetail).toBe('mainchain.noRuntimeEvidence');
  });

  it.each([
    ['web', 'Web', 'Shared/Web workbench'],
    ['desktop', 'Shared UI', 'Desktop shared workbench'],
    ['mobile', 'Shared UI', 'Desktop shared workbench'],
  ] satisfies Array<[AgentHubPlatform['surface'], string, string]>)(
    'labels the surface node for the %s surface',
    (surface, expectedLabel, expectedDetail) => {
      const summary = buildMainchainSummary(baseProps({ platformSurface: surface }));
      const surfaceNode = nodeOf(summary, 'web');
      expect(surfaceNode.label).toBe(expectedLabel);
      expect(surfaceNode.detail).toBe(expectedDetail);
      expect(surfaceNode.state).toBe('done');
    },
  );

  it('marks hub task done from the run_session taskId', () => {
    const summary = buildMainchainSummary(
      baseProps({ transcript: [runSessionBlock({ taskId: 'task-7' })] }),
    );
    expect(nodeOf(summary, 'hub-task')).toEqual({
      id: 'hub-task',
      label: 'Hub task',
      detail: 'task-7',
      state: 'done',
    });
  });

  it('uses the workbench replayLabel as an active hub task when there is no taskId', () => {
    const summary = buildMainchainSummary(
      baseProps({
        transcript: [runSessionBlock()],
        workbenchStatus: { replayLabel: 'Replaying task-3' },
      }),
    );
    expect(nodeOf(summary, 'hub-task').detail).toBe('Replaying task-3');
    expect(nodeOf(summary, 'hub-task').state).toBe('active');
  });

  it('keeps the hub task waiting when a run_session has no taskId and no replayLabel', () => {
    const summary = buildMainchainSummary(
      baseProps({
        transcript: [runSessionBlock()],
        workbenchStatus: { initialLoading: true },
      }),
    );
    expect(nodeOf(summary, 'hub-task').detail).toBe('mainchain.waitingTask');
    expect(nodeOf(summary, 'hub-task').state).toBe('waiting');
  });

  it('prefers the run_session agentLabel for the supervisor', () => {
    const summary = buildMainchainSummary(
      baseProps({
        transcript: [runSessionBlock({ agentLabel: 'Chief', author: author('ignored') })],
      }),
    );
    expect(nodeOf(summary, 'supervisor').detail).toBe('Chief');
    expect(nodeOf(summary, 'supervisor').state).toBe('done');
  });

  it('falls back to the run_session author name for the supervisor', () => {
    const summary = buildMainchainSummary(
      baseProps({ transcript: [runSessionBlock({ author: author('orchestrator-9') })] }),
    );
    expect(nodeOf(summary, 'supervisor').detail).toBe('orchestrator-9');
    expect(nodeOf(summary, 'supervisor').state).toBe('done');
  });

  it('falls back to the first route_decision author name when there is no run_session', () => {
    const summary = buildMainchainSummary(
      baseProps({
        transcript: [textBlock(), routeBlock({ author: author('router-7') })],
      }),
    );
    expect(nodeOf(summary, 'supervisor').detail).toBe('router-7');
    expect(nodeOf(summary, 'supervisor').state).toBe('done');
  });

  it('defaults the supervisor to "Supervisor" with a waiting state when nothing is known', () => {
    const summary = buildMainchainSummary(baseProps({ transcript: [textBlock()] }));
    expect(nodeOf(summary, 'supervisor').detail).toBe('Supervisor');
    expect(nodeOf(summary, 'supervisor').state).toBe('waiting');
    expect(nodeOf(summary, 'edge').detail).toBe('mainchain.waitingEdgeEvidence');
  });

  it('uses a subagent worker name for the worker node', () => {
    const summary = buildMainchainSummary(
      baseProps({ transcript: [subagentBlock({ worker: 'builder-1' })] }),
    );
    expect(nodeOf(summary, 'worker').detail).toBe('builder-1');
    expect(nodeOf(summary, 'worker').state).toBe('active');
  });

  it('uses a subtask worker name for the worker node', () => {
    const summary = buildMainchainSummary(
      baseProps({ transcript: [subtaskBlock({ worker: 'tester' })] }),
    );
    expect(nodeOf(summary, 'worker').detail).toBe('tester');
    expect(nodeOf(summary, 'worker').state).toBe('active');
  });

  it('skips worker blocks with missing names and falls through to the next one', () => {
    const summary = buildMainchainSummary(
      baseProps({
        transcript: [
          subtaskBlock({ worker: undefined }),
          childAgentBlock({ agent: 'inspector-2' }),
        ],
      }),
    );
    expect(nodeOf(summary, 'worker').detail).toBe('inspector-2');
    expect(nodeOf(summary, 'worker').state).toBe('active');
  });

  it('uses a child_agent agent name for the worker node', () => {
    const summary = buildMainchainSummary(
      baseProps({ transcript: [childAgentBlock({ agent: 'auditor' })] }),
    );
    expect(nodeOf(summary, 'worker').detail).toBe('auditor');
    expect(nodeOf(summary, 'worker').state).toBe('active');
  });

  it('falls back to the route targetAgent when no worker block has a name', () => {
    const summary = buildMainchainSummary(
      baseProps({
        transcript: [routeBlock({ targetAgent: 'planner' }), subtaskBlock({ worker: undefined })],
      }),
    );
    expect(nodeOf(summary, 'worker').detail).toBe('planner');
    expect(nodeOf(summary, 'worker').state).toBe('active');
  });

  it('keeps the worker waiting when no worker or route target is known', () => {
    const summary = buildMainchainSummary(baseProps({ transcript: [textBlock()] }));
    expect(nodeOf(summary, 'worker').detail).toBe('mainchain.waitingWorker');
    expect(nodeOf(summary, 'worker').state).toBe('waiting');
  });

  it('counts route_decision blocks against event blocks for the route-event node', () => {
    const summary = buildMainchainSummary(
      baseProps({
        transcript: [
          routeBlock(),
          routeBlock({ id: 'route-2' }),
          toolCallBlock(),
          agentTimelineBlock(),
          runStepGroupBlock(),
        ],
      }),
    );
    expect(nodeOf(summary, 'route-event').detail).toBe('2 route / 3 event');
    expect(nodeOf(summary, 'route-event').state).toBe('done');
  });

  it('blocks the target when required, nothing is selected, and the state is no-target', () => {
    const summary = buildMainchainSummary(
      baseProps({
        targetRequired: true,
        workbenchStatus: { targetState: 'no-target' },
      }),
    );
    expect(nodeOf(summary, 'target').detail).toBe('mainchain.noTarget');
    expect(nodeOf(summary, 'target').state).toBe('blocked');
  });

  it('blocks the target when required, nothing is selected, and no label exists', () => {
    const summary = buildMainchainSummary(baseProps({ targetRequired: true }));
    expect(nodeOf(summary, 'target').detail).toBe('mainchain.noTarget');
    expect(nodeOf(summary, 'target').state).toBe('blocked');
  });

  it('does not block the target when one is already selected', () => {
    const summary = buildMainchainSummary(
      baseProps({
        targetRequired: true,
        selectedExecutionTargetId: 'exec-1',
        workbenchStatus: { targetState: 'no-target' },
      }),
    );
    expect(nodeOf(summary, 'target').detail).toBe('mainchain.pickTarget');
    expect(nodeOf(summary, 'target').state).toBe('waiting');
  });

  it('blocks the target on no-target state even when a label is available', () => {
    const summary = buildMainchainSummary(
      baseProps({
        targetRequired: true,
        composerTargetLabel: 'picked-label',
        workbenchStatus: { targetState: 'no-target' },
      }),
    );
    expect(nodeOf(summary, 'target').detail).toBe('picked-label');
    expect(nodeOf(summary, 'target').state).toBe('blocked');
  });

  it('marks the target done from the composer target label', () => {
    const summary = buildMainchainSummary(
      baseProps({ composerTargetLabel: 'Composer target' }),
    );
    expect(nodeOf(summary, 'target').detail).toBe('Composer target');
    expect(nodeOf(summary, 'target').state).toBe('done');
  });

  it('prefers composerTargetLabel over workbenchStatus.targetLabel over run_session targetLabel', () => {
    const summary = buildMainchainSummary(
      baseProps({
        composerTargetLabel: 'composer-label',
        workbenchStatus: { targetLabel: 'status-label' },
        transcript: [runSessionBlock({ targetLabel: 'session-label' })],
      }),
    );
    expect(nodeOf(summary, 'target').detail).toBe('composer-label');
    expect(nodeOf(summary, 'target').state).toBe('done');
  });

  it('falls back to workbenchStatus.targetLabel', () => {
    const summary = buildMainchainSummary(
      baseProps({
        workbenchStatus: { targetLabel: 'status-label' },
        transcript: [runSessionBlock({ targetLabel: 'session-label' })],
      }),
    );
    expect(nodeOf(summary, 'target').detail).toBe('status-label');
    expect(nodeOf(summary, 'target').state).toBe('done');
  });

  it('falls back to the run_session targetLabel', () => {
    const summary = buildMainchainSummary(
      baseProps({ transcript: [runSessionBlock({ targetLabel: 'session-label' })] }),
    );
    expect(nodeOf(summary, 'target').detail).toBe('session-label');
    expect(nodeOf(summary, 'target').state).toBe('done');
  });

  it('ignores the no-target state when a target is not required', () => {
    const summary = buildMainchainSummary(
      baseProps({
        targetRequired: false,
        workbenchStatus: { targetState: 'no-target' },
      }),
    );
    expect(nodeOf(summary, 'target').detail).toBe('mainchain.pickTarget');
    expect(nodeOf(summary, 'target').state).toBe('empty');
  });

  it('activates the edge from the run_session runId when there is no runtime evidence', () => {
    const summary = buildMainchainSummary(
      baseProps({ transcript: [runSessionBlock({ runId: 'run-9' })] }),
    );
    expect(nodeOf(summary, 'edge').detail).toBe('run-9');
    expect(nodeOf(summary, 'edge').state).toBe('active');
  });

  it('prefers the runtime evidence runId over the run_session runId', () => {
    const summary = buildMainchainSummary(
      baseProps({
        transcript: [runSessionBlock({ runId: 'run-1' })],
        runtimeEvidence: runtimeSnapshot({ runId: 'run-2' }),
      }),
    );
    expect(nodeOf(summary, 'edge').detail).toBe('run-2');
    expect(nodeOf(summary, 'edge').state).toBe('active');
  });

  it('prefers the run_session edgeRunId over the runId for the edge detail', () => {
    const summary = buildMainchainSummary(
      baseProps({
        transcript: [runSessionBlock({ edgeRunId: 'edge-9', runId: 'run-9' })],
      }),
    );
    expect(nodeOf(summary, 'edge').detail).toBe('edge-9');
    expect(nodeOf(summary, 'edge').state).toBe('active');
  });

  it('marks the edge done when runtime diffs exist even without a runId', () => {
    const summary = buildMainchainSummary(
      baseProps({ runtimeEvidence: runtimeSnapshot({ diffs: [fileDiffFixture()] }) }),
    );
    expect(nodeOf(summary, 'edge').detail).toBe('Edge evidence empty');
    expect(nodeOf(summary, 'edge').state).toBe('done');
    expect(summary.exportEnabled).toBe(true);
  });

  it('keeps the edge waiting for an empty runtime snapshot', () => {
    const summary = buildMainchainSummary(
      baseProps({ runtimeEvidence: runtimeSnapshot() }),
    );
    expect(nodeOf(summary, 'edge').detail).toBe('Edge evidence empty');
    expect(nodeOf(summary, 'edge').state).toBe('waiting');
    expect(summary.exportEnabled).toBe(false);
  });

  it('marks the edge done and surfaces loading text when a channel is loading', () => {
    const summary = buildMainchainSummary(
      baseProps({ runtimeEvidence: runtimeSnapshot({ loading: { diff: true } }) }),
    );
    expect(nodeOf(summary, 'edge').detail).toBe('diff loading');
    expect(nodeOf(summary, 'edge').state).toBe('done');
  });

  it('marks the edge done and surfaces error text when a channel errored', () => {
    const summary = buildMainchainSummary(
      baseProps({ runtimeEvidence: runtimeSnapshot({ errors: { previews: true } }) }),
    );
    expect(nodeOf(summary, 'edge').detail).toBe('preview error');
    expect(nodeOf(summary, 'edge').state).toBe('done');
  });

  it('activates the edge from a runtime evidence runId', () => {
    const summary = buildMainchainSummary(
      baseProps({ runtimeEvidence: runtimeSnapshot({ runId: 'runtime-run' }) }),
    );
    expect(nodeOf(summary, 'edge').detail).toBe('runtime-run');
    expect(nodeOf(summary, 'edge').state).toBe('active');
  });

  it('counts transcript blocks for the replay node', () => {
    const summary = buildMainchainSummary(
      baseProps({
        transcript: [textBlock(), routeBlock(), toolCallBlock()],
      }),
    );
    expect(nodeOf(summary, 'replay').detail).toBe('3 transcript blocks');
    expect(nodeOf(summary, 'replay').state).toBe('done');
  });

  it('activates the evidence path when approval evidence exists', () => {
    const summary = buildMainchainSummary(
      baseProps({ evidence: [evidenceRef('approval')] }),
    );
    expect(nodeOf(summary, 'evidence-path').detail).toBe(
      '1 approval / 0 artifact / 0 diff / 0 preview',
    );
    expect(nodeOf(summary, 'evidence-path').state).toBe('active');
  });

  it('marks the evidence path done for artifact/file/preview evidence without approvals', () => {
    const summary = buildMainchainSummary(
      baseProps({
        evidence: [
          evidenceRef('artifact'),
          evidenceRef('file'),
          evidenceRef('preview'),
        ],
      }),
    );
    expect(nodeOf(summary, 'evidence-path').detail).toBe(
      '0 approval / 1 artifact / 1 diff / 1 preview',
    );
    expect(nodeOf(summary, 'evidence-path').state).toBe('done');
  });

  it('adds approval and permission_request transcript blocks to the approval count', () => {
    const summary = buildMainchainSummary(
      baseProps({
        transcript: [approvalBlock(), permissionRequestBlock(), textBlock()],
      }),
    );
    expect(nodeOf(summary, 'evidence-path').detail).toBe(
      '2 approval / 0 artifact / 0 diff / 0 preview',
    );
    expect(nodeOf(summary, 'evidence-path').state).toBe('active');
  });

  it('prefers runtime evidence arrays over evidence refs for counts', () => {
    const summary = buildMainchainSummary(
      baseProps({
        evidence: [
          evidenceRef('artifact'),
          evidenceRef('artifact'),
          evidenceRef('file'),
          evidenceRef('preview'),
        ],
        runtimeEvidence: runtimeSnapshot({
          artifacts: [artifactFixture()],
          diffs: [fileDiffFixture(), fileDiffFixture()],
          previews: [],
        }),
      }),
    );
    expect(nodeOf(summary, 'evidence-path').detail).toBe(
      '0 approval / 1 artifact / 2 diff / 0 preview',
    );
    expect(nodeOf(summary, 'evidence-path').state).toBe('done');
  });

  it('lets an empty runtime snapshot zero artifact/diff/preview counts while approvals still count', () => {
    const summary = buildMainchainSummary(
      baseProps({
        evidence: [
          evidenceRef('artifact'),
          evidenceRef('file'),
          evidenceRef('preview'),
          evidenceRef('approval'),
        ],
        runtimeEvidence: runtimeSnapshot(),
      }),
    );
    expect(nodeOf(summary, 'evidence-path').detail).toBe(
      '1 approval / 0 artifact / 0 diff / 0 preview',
    );
    expect(nodeOf(summary, 'evidence-path').state).toBe('active');
    expect(summary.exportEnabled).toBe(true);
  });

  it('enables export when evidence refs exist', () => {
    const summary = buildMainchainSummary(
      baseProps({ evidence: [evidenceRef('run')] }),
    );
    expect(summary.exportEnabled).toBe(true);
    expect(summary.exportLabel).toBe('mainchain.exportJson');
    expect(summary.exportDetail).toBe(EXPORT_DETAIL);
  });

  it('enables export when a run_session block exists', () => {
    const summary = buildMainchainSummary(
      baseProps({ transcript: [runSessionBlock()] }),
    );
    expect(summary.exportEnabled).toBe(true);
    expect(summary.exportLabel).toBe('mainchain.exportJson');
    expect(summary.exportDetail).toBe(EXPORT_DETAIL);
  });

  it('enables export when runtime evidence has content', () => {
    const summary = buildMainchainSummary(
      baseProps({ runtimeEvidence: runtimeSnapshot({ previews: [previewFixture()] }) }),
    );
    expect(summary.exportEnabled).toBe(true);
    expect(summary.exportLabel).toBe('mainchain.exportJson');
    expect(summary.exportDetail).toBe(EXPORT_DETAIL);
  });

  it('uses the first run_session block when several exist', () => {
    const summary = buildMainchainSummary(
      baseProps({
        transcript: [
          runSessionBlock({ id: 'first', taskId: 'task-first' }),
          runSessionBlock({ id: 'second', taskId: 'task-second' }),
        ],
      }),
    );
    expect(nodeOf(summary, 'hub-task').detail).toBe('task-first');
  });

  it('combines transcript, evidence, and status into a fully resolved summary', () => {
    const summary = buildMainchainSummary(
      baseProps({
        composerTargetLabel: 'Composer target',
        evidence: [evidenceRef('artifact'), evidenceRef('preview')],
        platformSurface: 'web',
        selectedExecutionTargetId: 'exec-1',
        targetRequired: true,
        transcript: [
          runSessionBlock({
            taskId: 'task-42',
            runId: 'run-42',
            edgeRunId: 'edge-42',
            agentLabel: 'Boss',
            targetLabel: 'contracts/target.json',
          }),
          routeBlock({ author: author('dispatcher'), targetAgent: 'worker-x' }),
          subagentBlock({ worker: 'worker-x' }),
          toolCallBlock(),
          approvalBlock(),
        ],
      }),
    );

    expect(nodeOf(summary, 'web')).toEqual({
      id: 'web',
      label: 'Web',
      detail: 'Shared/Web workbench',
      state: 'done',
    });
    expect(nodeOf(summary, 'hub-task')).toEqual({
      id: 'hub-task',
      label: 'Hub task',
      detail: 'task-42',
      state: 'done',
    });
    expect(nodeOf(summary, 'supervisor')).toEqual({
      id: 'supervisor',
      label: 'Supervisor',
      detail: 'Boss',
      state: 'done',
    });
    expect(nodeOf(summary, 'worker')).toEqual({
      id: 'worker',
      label: 'Worker',
      detail: 'worker-x',
      state: 'active',
    });
    expect(nodeOf(summary, 'route-event')).toEqual({
      id: 'route-event',
      label: 'Route + event',
      detail: '1 route / 1 event',
      state: 'done',
    });
    expect(nodeOf(summary, 'target')).toEqual({
      id: 'target',
      label: 'Exact target',
      detail: 'Composer target',
      state: 'done',
    });
    expect(nodeOf(summary, 'edge')).toEqual({
      id: 'edge',
      label: 'Active run',
      detail: 'edge-42',
      state: 'active',
    });
    expect(nodeOf(summary, 'replay')).toEqual({
      id: 'replay',
      label: 'Replay',
      detail: '5 transcript blocks',
      state: 'done',
    });
    expect(nodeOf(summary, 'evidence-path')).toEqual({
      id: 'evidence-path',
      label: 'Approval/artifact',
      detail: '1 approval / 1 artifact / 0 diff / 1 preview',
      state: 'active',
    });
    expect(summary.exportEnabled).toBe(true);
    expect(summary.exportLabel).toBe('mainchain.exportJson');
    expect(summary.exportDetail).toBe(EXPORT_DETAIL);
  });
});

describe('runtimeEvidenceSourceSummary', () => {
  it('translates a waiting message when the snapshot is undefined', () => {
    expect(runtimeEvidenceSourceSummary(undefined, t)).toBe('mainchain.waitingEdgeEvidence');
  });

  it('joins every flagged loading channel', () => {
    const summary = runtimeEvidenceSourceSummary(
      runtimeSnapshot({
        loading: { diff: true, artifacts: true, previews: true },
      }),
      t,
    );
    expect(summary).toBe('diff loading / artifact loading / preview loading');
  });

  it('reports only the flagged loading channels', () => {
    const summary = runtimeEvidenceSourceSummary(
      runtimeSnapshot({ loading: { previews: true } }),
      t,
    );
    expect(summary).toBe('preview loading');
  });

  it('prefers loading flags over error flags', () => {
    const summary = runtimeEvidenceSourceSummary(
      runtimeSnapshot({
        loading: { artifacts: true },
        errors: { diff: true, artifacts: true },
      }),
      t,
    );
    expect(summary).toBe('artifact loading');
  });

  it('joins every flagged error channel', () => {
    const summary = runtimeEvidenceSourceSummary(
      runtimeSnapshot({ errors: { diff: true, previews: true } }),
      t,
    );
    expect(summary).toBe('diff error / preview error');
  });

  it('reports an empty edge for a snapshot without flags', () => {
    expect(runtimeEvidenceSourceSummary(runtimeSnapshot(), t)).toBe('Edge evidence empty');
  });

  it('reports an empty edge even with populated arrays when no flags are set', () => {
    const summary = runtimeEvidenceSourceSummary(
      runtimeSnapshot({
        diffs: [fileDiffFixture()],
        artifacts: [artifactFixture()],
        previews: [previewFixture()],
        runId: 'run-1',
      }),
      t,
    );
    expect(summary).toBe('Edge evidence empty');
  });
});
