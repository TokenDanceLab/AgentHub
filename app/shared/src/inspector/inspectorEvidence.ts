import type { EvidenceRef, EvidenceRefKind, EvidenceRefStatus } from '../transcript';
import type { Artifact, Preview } from '../types';
import type { FileDiff } from '../types/chat';

export interface InspectorEvidenceModel {
  total: number;
  counts: Record<EvidenceRefKind, number>;
  statuses: Record<EvidenceRefStatus, number>;
  runs: EvidenceRef[];
  tools: EvidenceRef[];
  files: EvidenceRef[];
  artifacts: EvidenceRef[];
  approvals: EvidenceRef[];
}

export type RuntimeEvidenceSource = 'edge' | 'event' | 'none';
export type RuntimeEvidenceChannel = 'diff' | 'artifacts' | 'previews';
export type RuntimeEvidenceStateKind = 'loading' | 'error';

export interface RuntimeEvidenceSnapshot {
  runId?: string | undefined;
  diffs: FileDiff[];
  artifacts: Artifact[];
  previews: Preview[];
  loading?: {
    diff?: boolean | undefined;
    artifacts?: boolean | undefined;
    previews?: boolean | undefined;
  } | undefined;
  errors?: {
    diff?: boolean | undefined;
    artifacts?: boolean | undefined;
    previews?: boolean | undefined;
  } | undefined;
  sources?: {
    diff?: RuntimeEvidenceSource | undefined;
    artifacts?: RuntimeEvidenceSource | undefined;
    previews?: RuntimeEvidenceSource | undefined;
  } | undefined;
}

export interface RuntimeEvidenceChannelSummary {
  channel: RuntimeEvidenceChannel;
  title: string;
  count: number;
  source: RuntimeEvidenceSource;
  sourceLabel: string;
  loading: boolean;
  error: boolean;
}

export interface RuntimeEvidenceStateItem {
  channel: RuntimeEvidenceChannel;
  kind: RuntimeEvidenceStateKind;
  label: string;
}

export interface RuntimeEvidenceInspectorModel {
  runLabel: string;
  hasEvidence: boolean;
  channels: RuntimeEvidenceChannelSummary[];
  stateItems: RuntimeEvidenceStateItem[];
  loadingItems: RuntimeEvidenceStateItem[];
  errorItems: RuntimeEvidenceStateItem[];
  emptyTitle: string;
  emptyDetail: string;
}

export type DiffProposalReviewStatus = 'review' | 'approved' | 'rejected';

export interface DiffProposalEvidenceInput {
  diff: FileDiff;
  artifactId?: string | undefined;
  approvalId?: string | undefined;
  correlationId?: string | undefined;
}

export interface DiffProposalEvidenceModel {
  filePath: string;
  reviewStatus: DiffProposalReviewStatus;
  canApply: boolean;
  canRevert: boolean;
  editId: string;
  hash: string;
  artifactId: string;
  approvalId: string;
  correlationId: string;
  exportLabel: string;
  exportMode: 'review-only';
  safeToExport: boolean;
  guardReasons: string[];
}

export interface DiffProposalEvidenceManifest {
  schema: 'agenthub-diff-proposal-evidence-manifest-v1';
  export_mode: 'review-only';
  real_apply_supported: false;
  generatedAt: string;
  proposals: Array<{
    file_path: string;
    review_status: DiffProposalReviewStatus;
    can_apply: boolean;
    can_revert: boolean;
    edit_id: string;
    hash: string;
    artifact_id: string;
    approval_id: string;
    correlation_id: string;
  }>;
}

export function buildInspectorEvidenceModel(evidence: EvidenceRef[]): InspectorEvidenceModel {
  const model: InspectorEvidenceModel = {
    total: evidence.length,
    counts: {
      approval: 0,
      artifact: 0,
      file: 0,
      preview: 0,
      run: 0,
      tool: 0,
    },
    statuses: {
      completed: 0,
      failed: 0,
      pending: 0,
      running: 0,
    },
    runs: [],
    tools: [],
    files: [],
    artifacts: [],
    approvals: [],
  };

  for (const item of evidence) {
    model.counts[item.kind] += 1;
    if (item.status) {
      model.statuses[item.status] += 1;
    }

    switch (item.kind) {
      case 'run':
        model.runs.push(item);
        break;
      case 'tool':
        model.tools.push(item);
        break;
      case 'file':
        model.files.push(item);
        break;
      case 'artifact':
        model.artifacts.push(item);
        break;
      case 'approval':
        model.approvals.push(item);
        break;
    }
  }

  return model;
}

export function buildDiffProposalEvidenceModel(input: DiffProposalEvidenceInput): DiffProposalEvidenceModel {
  const reviewStatus = normalizeDiffProposalReviewStatus(input.diff.reviewStatus);
  const canApply = Boolean(input.diff.canApply);
  const canRevert = Boolean(input.diff.canRevert);
  const editId = input.diff.editId ?? '';
  const hash = input.diff.hash ?? '';
  const artifactId = input.artifactId ?? '';
  const approvalId = input.approvalId ?? '';
  const correlationId = input.correlationId ?? '';
  const guardReasons = diffProposalEvidenceGuardReasons({
    filePath: input.diff.filePath,
    reviewStatus,
    canApply,
    canRevert,
    hash,
    artifactId,
    approvalId,
    correlationId,
  });
  return {
    filePath: input.diff.filePath,
    reviewStatus,
    canApply,
    canRevert,
    editId,
    hash,
    artifactId,
    approvalId,
    correlationId,
    exportLabel: reviewStatus === 'approved' ? 'Export approved evidence' : 'Export evidence',
    exportMode: 'review-only',
    safeToExport: guardReasons.length === 0,
    guardReasons,
  };
}

export function buildDiffProposalEvidenceManifest(
  proposals: DiffProposalEvidenceModel[],
  generatedAt = new Date().toISOString(),
): DiffProposalEvidenceManifest {
  const unsafe = proposals.flatMap((proposal) =>
    proposal.guardReasons.map((reason) => `${proposal.filePath || '<unknown>'}:${reason}`),
  );
  if (unsafe.length > 0) {
    throw new Error(`Unsafe diff proposal evidence export: ${unsafe.join(', ')}`);
  }
  return {
    schema: 'agenthub-diff-proposal-evidence-manifest-v1',
    export_mode: 'review-only',
    real_apply_supported: false,
    generatedAt,
    proposals: proposals.map((proposal) => ({
      file_path: proposal.filePath,
      review_status: proposal.reviewStatus,
      can_apply: proposal.canApply,
      can_revert: proposal.canRevert,
      edit_id: proposal.editId,
      hash: proposal.hash,
      artifact_id: proposal.artifactId,
      approval_id: proposal.approvalId,
      correlation_id: proposal.correlationId,
    })),
  };
}

function diffProposalEvidenceGuardReasons(input: {
  filePath: string;
  reviewStatus: DiffProposalReviewStatus;
  canApply: boolean;
  canRevert: boolean;
  hash: string;
  artifactId: string;
  approvalId: string;
  correlationId: string;
}): string[] {
  const reasons: string[] = [];
  if (!input.filePath.trim()) {
    reasons.push('missing-file-path');
  }
  if (input.reviewStatus === 'review') {
    reasons.push('unreviewed-diff');
  }
  if (input.canApply) {
    reasons.push('apply-capability-exposed');
  }
  if (input.canRevert) {
    reasons.push('revert-capability-exposed');
  }
  if (!input.hash.startsWith('sha256:')) {
    reasons.push('missing-sha256-hash');
  }
  if (!input.artifactId.trim()) {
    reasons.push('missing-artifact-id');
  }
  if (!input.approvalId.trim()) {
    reasons.push('missing-approval-id');
  }
  if (!input.correlationId.trim()) {
    reasons.push('missing-correlation-id');
  }
  return reasons;
}

export type InspectorTranslate = (key: string | string[], options?: any) => string;

export function evidenceStatusLabel(t: InspectorTranslate, status: EvidenceRefStatus | undefined): string {
  switch (status) {
    case 'pending':
      return t('inspector.status.pending');
    case 'running':
      return t('inspector.status.running');
    case 'completed':
      return t('inspector.status.completed');
    case 'failed':
      return t('inspector.status.failed');
    default:
      return t('inspector.status.default');
  }
}

function normalizeDiffProposalReviewStatus(status: string | undefined): DiffProposalReviewStatus {
  switch (status) {
    case 'approved':
    case 'allow':
    case 'accepted':
      return 'approved';
    case 'rejected':
    case 'deny':
    case 'denied':
      return 'rejected';
    default:
      return 'review';
  }
}

export function buildRuntimeEvidenceInspectorModel<Ns extends string>(
  evidence: RuntimeEvidenceSnapshot,
  t: InspectorTranslate,
): RuntimeEvidenceInspectorModel {
  const channels: RuntimeEvidenceChannelSummary[] = [
    runtimeEvidenceChannelSummary({
      channel: 'diff',
      title: 'Diff snapshot',
      count: evidence.diffs.length,
      source: evidence.sources?.diff,
      loading: evidence.loading?.diff,
      error: evidence.errors?.diff,
    }),
    runtimeEvidenceChannelSummary({
      channel: 'artifacts',
      title: 'Artifacts',
      count: evidence.artifacts.length,
      source: evidence.sources?.artifacts,
      loading: evidence.loading?.artifacts,
      error: evidence.errors?.artifacts,
    }),
    runtimeEvidenceChannelSummary({
      channel: 'previews',
      title: 'Previews',
      count: evidence.previews.length,
      source: evidence.sources?.previews,
      loading: evidence.loading?.previews,
      error: evidence.errors?.previews,
    }),
  ];
  const stateItems = channels.flatMap((channel) => runtimeEvidenceStateItems(channel, t));
  const sourceSummary = channels
    .map((channel) => `${channel.title}: ${channel.sourceLabel}`)
    .join(' / ');

  return {
    runLabel: evidence.runId ? `Run ${evidence.runId}` : t('inspector.currentRun'),
    hasEvidence: channels.some((channel) => channel.count > 0),
    channels,
    stateItems,
    loadingItems: stateItems.filter((item) => item.kind === 'loading'),
    errorItems: stateItems.filter((item) => item.kind === 'error'),
    emptyTitle: t('inspector.emptyTitle'),
    emptyDetail: t('inspector.emptyDetail', { source: sourceSummary }),
  };
}

function runtimeEvidenceChannelSummary(input: {
  channel: RuntimeEvidenceChannel;
  title: string;
  count: number;
  source?: RuntimeEvidenceSource | undefined;
  loading?: boolean | undefined;
  error?: boolean | undefined;
}): RuntimeEvidenceChannelSummary {
  const source = input.source ?? 'none';
  return {
    channel: input.channel,
    title: input.title,
    count: input.count,
    source,
    sourceLabel: runtimeEvidenceSourceLabel(source),
    loading: Boolean(input.loading),
    error: Boolean(input.error),
  };
}

function runtimeEvidenceStateItems(summary: RuntimeEvidenceChannelSummary, t: InspectorTranslate): RuntimeEvidenceStateItem[] {
  const items: RuntimeEvidenceStateItem[] = [];
  if (summary.loading) {
    items.push({
      channel: summary.channel,
      kind: 'loading',
      label: t('inspector.channelLoading', { channel: runtimeEvidenceChannelLabel(summary.channel) }),
    });
  }
  if (summary.error) {
    items.push({
      channel: summary.channel,
      kind: 'error',
      label: t('inspector.channelLoadFailed', { channel: runtimeEvidenceChannelTitle(summary.channel) }),
    });
  }
  return items;
}

function runtimeEvidenceSourceLabel(source: RuntimeEvidenceSource): string {
  switch (source) {
    case 'edge':
      return 'Edge';
    case 'event':
      return 'Event';
    default:
      return 'None';
  }
}

function runtimeEvidenceChannelLabel(channel: RuntimeEvidenceChannel): string {
  switch (channel) {
    case 'diff':
      return 'diff snapshot';
    case 'artifacts':
      return 'artifact index';
    case 'previews':
      return 'preview index';
  }
}

function runtimeEvidenceChannelTitle(channel: RuntimeEvidenceChannel): string {
  switch (channel) {
    case 'diff':
      return 'Diff snapshot';
    case 'artifacts':
      return 'Artifact index';
    case 'previews':
      return 'Preview index';
  }
}
