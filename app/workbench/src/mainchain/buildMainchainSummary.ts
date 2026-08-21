import type { AgentHubPlatform } from '@shared/platform';
import type { EvidenceRef, TranscriptBlock } from '@shared/transcript';
import type { RuntimeEvidenceSnapshot } from '../RightInspector';
import type { MainchainNode, MainchainSummary } from './types';

export type MainchainWorkbenchStatus = {
  dataMode?: string | undefined;
  replayLabel?: string | undefined;
  targetLabel?: string | undefined;
  targetState?: string | undefined;
  initialLoading?: boolean | undefined;
  loadError?: string | undefined;
};

export function buildMainchainSummary({
  composerTargetLabel,
  evidence,
  platformSurface,
  runtimeEvidence,
  selectedExecutionTargetId,
  targetRequired,
  transcript,
  workbenchStatus,
  t,
}: {
  composerTargetLabel?: string | undefined;
  evidence: EvidenceRef[];
  platformSurface: AgentHubPlatform['surface'];
  runtimeEvidence?: RuntimeEvidenceSnapshot | undefined;
  selectedExecutionTargetId: string;
  targetRequired: boolean;
  transcript: TranscriptBlock[];
  workbenchStatus?: MainchainWorkbenchStatus | undefined;
  t: (key: string, options?: Record<string, unknown>) => string;
}): MainchainSummary {
  const runSession = transcript.find((block) => block.kind === 'run_session');
  const taskId = runSession?.kind === 'run_session' ? runSession.taskId : undefined;
  const edgeRunId = runSession?.kind === 'run_session' ? runSession.edgeRunId : undefined;
  const runId = runtimeEvidence?.runId ?? (runSession?.kind === 'run_session' ? runSession.runId : undefined);
  const artifactCount = runtimeEvidence
    ? runtimeEvidence.artifacts.length
    : evidence.filter((item) => item.kind === 'artifact').length;
  const approvalCount = evidence.filter((item) => item.kind === 'approval').length
    + transcript.filter((block) => block.kind === 'approval' || block.kind === 'permission_request').length;
  const diffCount = runtimeEvidence?.diffs.length ?? evidence.filter((item) => item.kind === 'file').length;
  const previewCount = runtimeEvidence?.previews.length ?? evidence.filter((item) => item.kind === 'preview').length;
  const routeBlocks = transcript.filter((block) => block.kind === 'route_decision');
  const workerBlocks = transcript.filter((block) => (
    block.kind === 'subagent' || block.kind === 'subtask' || block.kind === 'child_agent'
  ));
  const eventBlocks = transcript.filter((block) => (
    block.kind === 'agent_timeline' || block.kind === 'tool_call' || block.kind === 'run_step_group'
  ));
  const supervisorLabel = runSession?.kind === 'run_session'
    ? runSession.agentLabel ?? runSession.author.name
    : routeBlocks[0]?.author.name ?? 'Supervisor';
  const workerLabel = workerBlocks.map((block) => {
    if (block.kind === 'subagent' || block.kind === 'subtask') return block.worker;
    return block.agent;
  }).find(Boolean) ?? routeBlocks.find((block) => block.kind === 'route_decision')?.targetAgent;
  const evidencePathDetail = `${approvalCount} approval / ${artifactCount} artifact`;
  const hasRuntimeEvidence = Boolean(runtimeEvidence && (
    runtimeEvidence.diffs.length > 0
    || runtimeEvidence.artifacts.length > 0
    || runtimeEvidence.previews.length > 0
    || runtimeEvidence.runId
    || runtimeEvidence.loading?.diff
    || runtimeEvidence.loading?.artifacts
    || runtimeEvidence.loading?.previews
    || runtimeEvidence.errors?.diff
    || runtimeEvidence.errors?.artifacts
    || runtimeEvidence.errors?.previews
  ));
  const hasExportEvidence = evidence.length > 0 || hasRuntimeEvidence || Boolean(runSession);
  const targetLabel = composerTargetLabel
    ?? workbenchStatus?.targetLabel
    ?? (runSession?.kind === 'run_session' ? runSession.targetLabel : undefined);
  const targetBlocked = targetRequired
    && !selectedExecutionTargetId
    && (workbenchStatus?.targetState === 'no-target' || !targetLabel);
  const targetState = targetBlocked
    ? 'blocked'
    : targetLabel
      ? 'done'
      : targetRequired
        ? 'waiting'
        : 'empty';

  const nodes: MainchainNode[] = [
    {
      id: 'web',
      label: platformSurface === 'web' ? 'Web' : 'Shared UI',
      detail: platformSurface === 'web' ? 'Shared/Web workbench' : 'Desktop shared workbench',
      state: 'done',
    },
    {
      id: 'hub-task',
      label: 'Hub task',
      detail: taskId ? taskId : workbenchStatus?.replayLabel ?? t('mainchain.waitingTask'),
      state: taskId ? 'done' : workbenchStatus?.replayLabel ? 'active' : 'waiting',
    },
    {
      id: 'supervisor',
      label: 'Supervisor',
      detail: supervisorLabel,
      state: supervisorLabel === 'Supervisor' ? 'waiting' : 'done',
    },
    {
      id: 'worker',
      label: 'Worker',
      detail: workerLabel ?? t('mainchain.waitingWorker'),
      state: workerLabel ? 'active' : 'waiting',
    },
    {
      id: 'route-event',
      label: 'Route + event',
      detail: `${routeBlocks.length} route / ${eventBlocks.length} event`,
      state: routeBlocks.length + eventBlocks.length > 0 ? 'done' : 'empty',
    },
    {
      id: 'target',
      label: 'Exact target',
      detail: targetLabel ?? (targetBlocked ? t('mainchain.noTarget') : t('mainchain.pickTarget')),
      state: targetState,
    },
    {
      id: 'edge',
      label: 'Active run',
      detail: edgeRunId ?? runId ?? runtimeEvidenceSourceSummary(runtimeEvidence, t),
      state: runId || edgeRunId ? 'active' : hasRuntimeEvidence ? 'done' : 'waiting',
    },
    {
      id: 'replay',
      label: 'Replay',
      detail: transcript.length > 0 ? `${transcript.length} transcript blocks` : t('mainchain.noTranscript'),
      state: transcript.length > 0 ? 'done' : 'empty',
    },
    {
      id: 'evidence-path',
      label: 'Approval/artifact',
      detail: artifactCount + approvalCount + diffCount + previewCount > 0
        ? `${evidencePathDetail} / ${diffCount} diff / ${previewCount} preview`
        : t('mainchain.noApprovalArtifact'),
      state: approvalCount > 0 ? 'active' : artifactCount + diffCount + previewCount > 0 ? 'done' : 'empty',
    },
  ];

  return {
    nodes,
    exportEnabled: hasExportEvidence,
    exportLabel: hasExportEvidence ? t('mainchain.exportJson') : t('mainchain.waitingEvidence'),
    exportDetail: hasExportEvidence
      ? 'Copy Web -> Hub task -> target -> Edge -> replay/artifact/approval evidence JSON'
      : t('mainchain.noRuntimeEvidence'),
  };
}

export function runtimeEvidenceSourceSummary(
  runtimeEvidence: RuntimeEvidenceSnapshot | undefined,
  t: (key: string) => string,
): string {
  if (!runtimeEvidence) return t('mainchain.waitingEdgeEvidence');
  const loading = [
    runtimeEvidence.loading?.diff ? 'diff loading' : undefined,
    runtimeEvidence.loading?.artifacts ? 'artifact loading' : undefined,
    runtimeEvidence.loading?.previews ? 'preview loading' : undefined,
  ].filter(Boolean);
  if (loading.length > 0) return loading.join(' / ');
  const errors = [
    runtimeEvidence.errors?.diff ? 'diff error' : undefined,
    runtimeEvidence.errors?.artifacts ? 'artifact error' : undefined,
    runtimeEvidence.errors?.previews ? 'preview error' : undefined,
  ].filter(Boolean);
  if (errors.length > 0) return errors.join(' / ');
  return 'Edge evidence empty';
}
