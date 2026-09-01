import { beforeAll, describe, expect, it } from 'vitest';
import { getI18n } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';
import { useTestI18nLanguage } from '../testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});
import {
  buildInspectorEvidenceModel,
  buildDiffProposalEvidenceManifest,
  buildDiffProposalEvidenceModel,
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
    expect(model.counts).toEqual({ approval: 0, artifact: 1, file: 1, preview: 0, run: 1, tool: 1 });
    expect(model.statuses).toEqual({ completed: 2, failed: 0, pending: 0, running: 1 });
    expect(model.runs.map((item) => item.id)).toEqual(['run-1']);
    expect(model.tools.map((item) => item.id)).toEqual(['tool-rg']);
    expect(model.files.map((item) => item.id)).toEqual(['file-app']);
    expect(model.artifacts.map((item) => item.id)).toEqual(['artifact-smoke']);
  });

  it('models a diff proposal as review-only evidence with export metadata', () => {
    const model = buildDiffProposalEvidenceModel({
      diff: {
        filePath: 'src/a.go',
        status: 'modified',
        additions: 1,
        deletions: 1,
        hunks: [],
        editId: 'edit-1',
        hash: 'sha256:diff-abc',
        reviewStatus: 'allow',
        canApply: false,
        canRevert: true,
      },
      artifactId: 'artifact-1',
      approvalId: 'approval-1',
      correlationId: 'corr-1',
    });

    expect(model).toEqual({
      filePath: 'src/a.go',
      reviewStatus: 'approved',
      canApply: false,
      canRevert: true,
      editId: 'edit-1',
      hash: 'sha256:diff-abc',
      artifactId: 'artifact-1',
      approvalId: 'approval-1',
      correlationId: 'corr-1',
      exportLabel: 'Export approved evidence',
      exportMode: 'review-only',
      safeToExport: false,
      guardReasons: ['revert-capability-exposed'],
    });
  });

  it('exports diff proposal evidence manifest with approval correlation', () => {
    const proposal = buildDiffProposalEvidenceModel({
      diff: {
        filePath: 'src/review.ts',
        status: 'modified',
        additions: 2,
        deletions: 0,
        hunks: [],
        editId: 'edit-2',
        hash: 'sha256:diff-def',
        reviewStatus: 'rejected',
        canApply: false,
        canRevert: false,
      },
      artifactId: 'artifact-2',
      approvalId: 'approval-2',
      correlationId: 'corr-2',
    });

    expect(buildDiffProposalEvidenceManifest([proposal], '2026-06-09T00:00:00.000Z')).toEqual({
      schema: 'agenthub-diff-proposal-evidence-manifest-v1',
      export_mode: 'review-only',
      real_apply_supported: false,
      generatedAt: '2026-06-09T00:00:00.000Z',
      proposals: [{
        file_path: 'src/review.ts',
        review_status: 'rejected',
        can_apply: false,
        can_revert: false,
        edit_id: 'edit-2',
        hash: 'sha256:diff-def',
        artifact_id: 'artifact-2',
        approval_id: 'approval-2',
        correlation_id: 'corr-2',
      }],
    });
  });

  it('rejects unsafe diff proposal evidence export before any real apply path exists', () => {
    const proposal = buildDiffProposalEvidenceModel({
      diff: {
        filePath: 'src/unsafe.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
        hunks: [],
        hash: 'diff-without-prefix',
        reviewStatus: 'review',
        canApply: true,
      },
      artifactId: 'artifact-unsafe',
      approvalId: 'approval-unsafe',
    });

    expect(proposal.safeToExport).toBe(false);
    expect(proposal.guardReasons).toEqual([
      'unreviewed-diff',
      'apply-capability-exposed',
      'missing-sha256-hash',
      'missing-correlation-id',
    ]);
    expect(() => buildDiffProposalEvidenceManifest([proposal], '2026-06-09T00:00:00.000Z'))
      .toThrow('Unsafe diff proposal evidence export');
  });

  it('keeps approval refs visible for side-panel evidence grouping', () => {
    const model = buildInspectorEvidenceModel([
      { id: 'approval-1', kind: 'approval', label: 'Bash approval', status: 'pending' },
    ]);

    expect(model.counts.approval).toBe(1);
    expect(model.approvals.map((item) => item.id)).toEqual(['approval-1']);
    expect(model.statuses.pending).toBe(1);
  });

  it('formats v4 inspector status labels in Chinese', () => {
    const t = getI18n()!.getFixedT('zh', CHATVIEW_I18N_NAMESPACE);
    expect(evidenceStatusLabel(t, 'pending')).toBe('等待');
    expect(evidenceStatusLabel(t, 'running')).toBe('运行中');
    expect(evidenceStatusLabel(t, 'completed')).toBe('完成');
    expect(evidenceStatusLabel(t, 'failed')).toBe('失败');
    expect(evidenceStatusLabel(t, undefined)).toBe('记录');
  });

  it('summarizes runtime evidence state for the right inspector', () => {
    const t = getI18n()!.getFixedT('zh', CHATVIEW_I18N_NAMESPACE);
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
    }, t);

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
    const t = getI18n()!.getFixedT('zh', CHATVIEW_I18N_NAMESPACE);
    const model = buildRuntimeEvidenceInspectorModel({
      diffs: [],
      artifacts: [],
      previews: [],
      sources: { diff: 'none', artifacts: 'none', previews: 'none' },
    }, t);

    expect(model.hasEvidence).toBe(false);
    expect(model.emptyTitle).toBe('暂无运行证据');
    expect(model.emptyDetail).toContain('Edge 已返回空 diff、artifact 和 preview snapshot。');
    expect(model.emptyDetail).toContain('Diff snapshot: None');
    expect(model.stateItems).toEqual([]);
  });
});
