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

export function buildInspectorEvidenceModel(evidence: EvidenceRef[]): InspectorEvidenceModel {
  const model: InspectorEvidenceModel = {
    total: evidence.length,
    counts: {
      artifact: 0,
      file: 0,
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
    }
  }

  return model;
}

export function evidenceStatusLabel(status: EvidenceRefStatus | undefined): string {
  switch (status) {
    case 'pending':
      return '等待';
    case 'running':
      return '运行中';
    case 'completed':
      return '完成';
    case 'failed':
      return '失败';
    default:
      return '记录';
  }
}

export function buildRuntimeEvidenceInspectorModel(
  evidence: RuntimeEvidenceSnapshot,
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
  const stateItems = channels.flatMap(runtimeEvidenceStateItems);
  const sourceSummary = channels
    .map((channel) => `${channel.title}: ${channel.sourceLabel}`)
    .join(' / ');

  return {
    runLabel: evidence.runId ? `Run ${evidence.runId}` : '当前 Run',
    hasEvidence: channels.some((channel) => channel.count > 0),
    channels,
    stateItems,
    loadingItems: stateItems.filter((item) => item.kind === 'loading'),
    errorItems: stateItems.filter((item) => item.kind === 'error'),
    emptyTitle: '暂无运行证据',
    emptyDetail: `Edge 已返回空 diff、artifact 和 preview snapshot。来源：${sourceSummary}`,
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

function runtimeEvidenceStateItems(summary: RuntimeEvidenceChannelSummary): RuntimeEvidenceStateItem[] {
  const items: RuntimeEvidenceStateItem[] = [];
  if (summary.loading) {
    items.push({
      channel: summary.channel,
      kind: 'loading',
      label: `正在读取 ${runtimeEvidenceChannelLabel(summary.channel)}`,
    });
  }
  if (summary.error) {
    items.push({
      channel: summary.channel,
      kind: 'error',
      label: `${runtimeEvidenceChannelTitle(summary.channel)} 读取失败`,
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
