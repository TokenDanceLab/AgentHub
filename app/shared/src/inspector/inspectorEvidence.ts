import type { EvidenceRef, EvidenceRefKind, EvidenceRefStatus } from '../transcript';

export interface InspectorEvidenceModel {
  total: number;
  counts: Record<EvidenceRefKind, number>;
  statuses: Record<EvidenceRefStatus, number>;
  runs: EvidenceRef[];
  tools: EvidenceRef[];
  files: EvidenceRef[];
  artifacts: EvidenceRef[];
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
