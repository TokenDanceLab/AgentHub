import { describe, expect, it } from 'vitest';
import {
  buildInspectorEvidenceModel,
  buildRuntimeEvidenceInspectorModel,
  evidenceStatusLabel,
} from './inspectorEvidence';
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

  it('summarizes runtime evidence state for the right inspector', () => {
    const model = buildRuntimeEvidenceInspectorModel({
      runId: 'run-edge-1',
      diffs: [{
        filePath: 'src/runtime.ts',
        status: 'modified',
        additions: 2,
        deletions: 1,
        hunks: [],
      }],
      artifacts: [{
        id: 'artifact-1',
        runId: 'run-edge-1',
        threadId: 'thread-1',
        kind: 'patch',
        path: 'reports/runtime.patch',
        sizeBytes: 1024,
        createdAt: '2026-06-08T08:00:00.000Z',
      }],
      previews: [],
      loading: { previews: true },
      errors: { diff: true },
      sources: { diff: 'event', artifacts: 'edge', previews: 'none' },
    });

    expect(model.runLabel).toBe('Run run-edge-1');
    expect(model.hasEvidence).toBe(true);
    expect(model.channels.map((channel) => ({
      channel: channel.channel,
      count: channel.count,
      sourceLabel: channel.sourceLabel,
      loading: channel.loading,
      error: channel.error,
    }))).toEqual([
      { channel: 'diff', count: 1, sourceLabel: 'Event', loading: false, error: true },
      { channel: 'artifacts', count: 1, sourceLabel: 'Edge', loading: false, error: false },
      { channel: 'previews', count: 0, sourceLabel: 'None', loading: true, error: false },
    ]);
    expect(model.errorItems.map((item) => item.label)).toEqual(['Diff snapshot 读取失败']);
    expect(model.loadingItems.map((item) => item.label)).toEqual(['正在读取 preview index']);
  });

  it('keeps an explicit empty runtime evidence detail', () => {
    const model = buildRuntimeEvidenceInspectorModel({
      diffs: [],
      artifacts: [],
      previews: [],
      sources: { diff: 'none', artifacts: 'none', previews: 'none' },
    });

    expect(model.hasEvidence).toBe(false);
    expect(model.emptyTitle).toBe('暂无运行证据');
    expect(model.emptyDetail).toContain('Edge 已返回空 diff、artifact 和 preview snapshot。');
    expect(model.emptyDetail).toContain('Diff snapshot: None');
    expect(model.stateItems).toEqual([]);
  });
});
