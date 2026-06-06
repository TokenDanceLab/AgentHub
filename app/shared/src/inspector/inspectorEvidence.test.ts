import { describe, expect, it } from 'vitest';
import { buildInspectorEvidenceModel, evidenceStatusLabel } from './inspectorEvidence';
import type { EvidenceRef } from '../transcript';

describe('buildInspectorEvidenceModel', () => {
  it('groups transcript evidence for the right inspector', () => {
    const evidence: EvidenceRef[] = [
      { id: 'run-1', kind: 'run', label: 'Run 1', status: 'running' },
      { id: 'tool-rg', kind: 'tool', label: 'rg desktop', status: 'completed' },
      { id: 'file-app', kind: 'file', label: 'app/shared/src/workbench/RightInspector.tsx' },
      { id: 'artifact-smoke', kind: 'artifact', label: 'visual-smoke-desktop.png', status: 'completed' },
    ];

    const model = buildInspectorEvidenceModel(evidence);

    expect(model.total).toBe(4);
    expect(model.counts).toEqual({ artifact: 1, file: 1, run: 1, tool: 1 });
    expect(model.statuses).toEqual({ completed: 2, failed: 0, pending: 0, running: 1 });
    expect(model.runs.map((item) => item.id)).toEqual(['run-1']);
    expect(model.tools.map((item) => item.id)).toEqual(['tool-rg']);
    expect(model.files.map((item) => item.id)).toEqual(['file-app']);
    expect(model.artifacts.map((item) => item.id)).toEqual(['artifact-smoke']);
  });

  it('formats v4 inspector status labels in Chinese', () => {
    expect(evidenceStatusLabel('pending')).toBe('等待');
    expect(evidenceStatusLabel('running')).toBe('运行中');
    expect(evidenceStatusLabel('completed')).toBe('完成');
    expect(evidenceStatusLabel('failed')).toBe('失败');
    expect(evidenceStatusLabel(undefined)).toBe('记录');
  });
});
