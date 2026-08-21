import { describe, expect, it, vi } from 'vitest';
import type { ContextUsageTranscriptBlock, EvidenceRef } from '@shared/transcript';
import {
  canOpenEvidence,
  contextBarFillWidth,
  contextBarVariantClass,
  DEPLOY_STATUS_LABEL,
  deployDotColor,
  deployStatusLabel,
  evidenceOverviewFiles,
  evidenceOverviewTasks,
  fileTypeFromName,
  formatDeployUrlDisplay,
  isContextUsageDanger,
  isContextUsageWarning,
  isDeployFailed,
  isDeployInProgress,
  isDeployReady,
  resolveContextUsagePercent,
  resolveLatestContextUsage,
} from './InspectorModePanelHelpers';

function ref(partial: Partial<EvidenceRef> & Pick<EvidenceRef, 'id' | 'kind' | 'label'>): EvidenceRef {
  return partial;
}

function contextBlock(
  partial: Partial<ContextUsageTranscriptBlock> & Pick<ContextUsageTranscriptBlock, 'id' | 'inputTokens' | 'outputTokens'>,
): ContextUsageTranscriptBlock {
  return {
    kind: 'context_usage',
    author: { id: 'a', name: 'agent', role: 'agent' },
    ...partial,
  };
}

describe('InspectorModePanelHelpers', () => {
  it('maps evidence into overview tasks with empty fallback', () => {
    expect(evidenceOverviewTasks([])).toEqual([
      { label: '等待 transcript evidence', status: 'todo' },
    ]);

    const tasks = evidenceOverviewTasks([
      ref({ id: 'r1', kind: 'run', label: 'Run A', status: 'completed' }),
      ref({ id: 'a1', kind: 'artifact', label: 'Art' }),
      ref({ id: 'f1', kind: 'file', label: 'f.ts' }),
      ref({ id: 't1', kind: 'tool', label: 'bash' }),
    ]);
    expect(tasks).toEqual([
      { label: 'Run A', status: 'done' },
      { label: '产物索引: 1', status: 'done' },
      { label: '变更文件: 1', status: 'done' },
      { label: '工具调用: 1', status: 'done' },
    ]);
  });

  it('maps file/artifact evidence into overview preview files', () => {
    const files = evidenceOverviewFiles([
      ref({ id: 'f1', kind: 'file', label: 'readme.md', uri: 'file://readme.md' }),
      ref({ id: 'a1', kind: 'artifact', label: 'out.ts' }),
      ref({ id: 't1', kind: 'tool', label: 'ignored' }),
    ]);
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({
      name: 'readme.md',
      type: 'md',
      isPrimary: true,
      owner: 'transcript',
    });
    expect(files[0]?.content).toContain('file://readme.md');
    expect(files[1]).toMatchObject({
      name: 'out.ts',
      type: 'ts',
      isPrimary: false,
      owner: 'transcript',
    });
    expect(files[1]?.content).toContain('产物来自 transcript evidence');
  });

  it('detects file types from extension', () => {
    expect(fileTypeFromName('a.md')).toBe('md');
    expect(fileTypeFromName('a.ts')).toBe('ts');
    expect(fileTypeFromName('a.tsx')).toBe('ts');
    expect(fileTypeFromName('q.sql')).toBe('sql');
    expect(fileTypeFromName('x.png')).toBe('image');
    expect(fileTypeFromName('x.jpg')).toBe('image');
    expect(fileTypeFromName('x.gif')).toBe('image');
    expect(fileTypeFromName('i.html')).toBe('html');
    expect(fileTypeFromName('i.htm')).toBe('html');
    expect(fileTypeFromName('notes')).toBe('txt');
  });

  it('gates openability on onOpenPreview and optional canOpenPreview', () => {
    const evidence = ref({ id: 'e1', kind: 'file', label: 'a.ts' });
    const open = vi.fn(async () => undefined);
    expect(canOpenEvidence(evidence, undefined, undefined)).toBe(false);
    expect(canOpenEvidence(evidence, open, undefined)).toBe(true);
    expect(canOpenEvidence(evidence, open, () => false)).toBe(false);
    expect(canOpenEvidence(evidence, open, () => true)).toBe(true);
  });

  it('resolves latest context usage and percent/bar variants', () => {
    expect(resolveLatestContextUsage([])).toBeNull();
    expect(resolveLatestContextUsage([
      contextBlock({ id: 'c0', inputTokens: 0, outputTokens: 0 }),
    ])).toBeNull();

    const latest = contextBlock({
      id: 'c1',
      inputTokens: 70,
      outputTokens: 30,
      contextLimit: 100,
      modelLabel: 'gpt',
    });
    expect(resolveLatestContextUsage([
      contextBlock({ id: 'c0', inputTokens: 1, outputTokens: 1 }),
      latest,
    ])).toBe(latest);

    expect(resolveContextUsagePercent(latest)).toBe(100);
    expect(resolveContextUsagePercent(
      contextBlock({ id: 'c2', inputTokens: 10, outputTokens: 0, usagePercent: 42 }),
    )).toBe(42);
    expect(resolveContextUsagePercent(
      contextBlock({ id: 'c3', inputTokens: 5, outputTokens: 5 }),
    )).toBeNull();

    expect(isContextUsageWarning(70)).toBe(true);
    expect(isContextUsageWarning(90)).toBe(false);
    expect(isContextUsageDanger(90)).toBe(true);
    expect(isContextUsageDanger(89)).toBe(false);

    expect(contextBarVariantClass(95, {
      contextBarDanger: 'danger',
      contextBarWarning: 'warn',
    })).toBe('danger');
    expect(contextBarVariantClass(75, {
      contextBarDanger: 'danger',
      contextBarWarning: 'warn',
    })).toBe('warn');
    expect(contextBarVariantClass(10, {
      contextBarDanger: 'danger',
      contextBarWarning: 'warn',
    })).toBe('');
    expect(contextBarFillWidth(150)).toBe('100%');
    expect(contextBarFillWidth(40)).toBe('40%');
  });

  it('keeps deploy status labels and colors stable', () => {
    expect(DEPLOY_STATUS_LABEL.deployed).toBe('已就绪');
    expect(deployStatusLabel('building')).toBe('构建中');
    expect(deployStatusLabel('unknown-status')).toBe('unknown-status');
    expect(isDeployReady('deployed')).toBe(true);
    expect(isDeployFailed('failed')).toBe(true);
    expect(isDeployInProgress('building')).toBe(true);
    expect(isDeployInProgress('deploying')).toBe(true);
    expect(isDeployInProgress('pending')).toBe(false);
    expect(deployDotColor('deployed')).toBe('var(--td-moss)');
    expect(deployDotColor('failed')).toBe('var(--td-danger)');
    expect(deployDotColor('pending')).toBe('var(--td-plum)');
    expect(formatDeployUrlDisplay('https://example.com/app')).toBe('example.com/app');
    expect(formatDeployUrlDisplay('http://localhost:5173')).toBe('localhost:5173');
  });
});
