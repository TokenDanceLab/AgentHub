import { describe, expect, it } from 'vitest';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import { createTestI18n } from '@shared/testing/i18n';
import type { RuntimeEvidenceSnapshot } from '@shared/inspector';
import type { Artifact, Preview } from '@shared/types';
import type { FileDiff } from '@shared/types/chat';
import {
  artifactDownloadName,
  artifactDownloadRef,
  artifactWorkspaceDiffLabel,
  artifactWorkspacePreviewStatus,
  artifactWorkspaceTopic,
  artifactWorkspaceVersion,
  diffLinePrefix,
  diffMeta,
  fileDiffToText,
  runtimeDiffPreviewFile,
  runtimeEvidenceOverviewFiles,
  runtimeEvidenceOverviewKicker,
  runtimeEvidenceOverviewTasks,
} from './RuntimeEvidenceHelpers';

/** Real zh bundle keeps historical copy expectations honest (#2032). */
const tZh = createTestI18n({ lng: 'zh' }).getFixedT('zh', SHARED_WORKBENCH_I18N_NAMESPACE);

function sampleDiff(overrides: Partial<FileDiff> = {}): FileDiff {
  return {
    filePath: 'src/app.ts',
    status: 'modified',
    additions: 2,
    deletions: 1,
    hunks: [
      {
        header: '@@ -1,2 +1,3 @@',
        lines: [
          { type: 'context', content: 'const a = 1' },
          { type: 'deleted', content: 'const b = 2' },
          { type: 'added', content: 'const b = 3' },
          { type: 'added', content: 'const c = 4' },
        ],
      },
    ],
    ...overrides,
  };
}

function sampleArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'a1',
    runId: 'run-1',
    threadId: 'thread-1',
    kind: 'markdown',
    path: 'out/report.md',
    sizeBytes: 12,
    createdAt: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

function samplePreview(overrides: Partial<Preview> = {}): Preview {
  return {
    id: 'p1',
    runId: 'run-1',
    threadId: 'thread-1',
    status: 'ready',
    createdAt: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

function emptyEvidence(overrides: Partial<RuntimeEvidenceSnapshot> = {}): RuntimeEvidenceSnapshot {
  return {
    diffs: [],
    artifacts: [],
    previews: [],
    ...overrides,
  };
}

describe('RuntimeEvidenceHelpers', () => {
  it('builds overview tasks for empty and populated evidence', () => {
    expect(runtimeEvidenceOverviewTasks(tZh, emptyEvidence())).toEqual([
      { label: '等待 Hub replay evidence', status: 'todo' },
    ]);

    const tasks = runtimeEvidenceOverviewTasks(
      tZh,
      emptyEvidence({
        runId: 'run-1',
        artifacts: [sampleArtifact()],
        diffs: [sampleDiff()],
        previews: [
          samplePreview({
            url: 'https://example.test/preview',
          }),
        ],
      })
    );

    expect(tasks).toEqual([
      { label: '跟随 run-1', status: 'active' },
      { label: 'Hub replay artifact index: 1', status: 'done' },
      { label: 'Diff snapshot: 1', status: 'done' },
      { label: 'Preview index: 1', status: 'done' },
    ]);
  });

  it('maps overview files for artifacts, diffs, and previews', () => {
    const files = runtimeEvidenceOverviewFiles(
      tZh,
      emptyEvidence({
        runId: 'run-9',
        artifacts: [
          sampleArtifact({
            id: 'art-1',
            path: 'dist/app.js',
            kind: 'bundle',
            runId: 'run-9',
            threadId: 'thread-1',
            createdAt: '2026-07-02T00:00:00Z',
          }),
        ],
        diffs: [sampleDiff({ filePath: 'src/x.ts' })],
        previews: [
          samplePreview({
            id: 'prev-1',
            status: 'starting',
            runId: 'run-9',
            createdAt: '2026-07-02T00:00:00Z',
          }),
        ],
      })
    );

    expect(files).toHaveLength(3);
    expect(files[0]).toMatchObject({
      name: 'dist/app.js',
      type: 'bundle',
      isPrimary: true,
      owner: 'Hub replay',
      contentRef: { kind: 'artifact', runId: 'run-9', id: 'art-1' },
    });
    expect(files[0]?.content).toContain('# dist/app.js');
    expect(files[1]?.name).toBe('src/x.ts');
    expect(files[1]?.type).toBe('diff');
    expect(files[1]?.diffContent).toContain('diff --git a/src/x.ts b/src/x.ts');
    expect(files[2]).toMatchObject({
      name: 'prev-1',
      type: 'preview',
      contentRef: { kind: 'preview', runId: 'run-9', id: 'prev-1' },
    });
  });

  it('keeps displayable preview URLs in content and skips the endpoint ref', () => {
    const files = runtimeEvidenceOverviewFiles(
      tZh,
      emptyEvidence({
        runId: 'run-9',
        previews: [
          samplePreview({
            id: 'prev-3',
            status: 'ready',
            runId: 'run-9',
            url: 'https://preview.example.test/app',
            createdAt: '2026-07-02T00:00:00Z',
          }),
        ],
      })
    );

    expect(files[0]).toMatchObject({
      name: 'https://preview.example.test/app',
      type: 'preview',
      content: 'https://preview.example.test/app',
    });
    expect(files[0]?.contentRef).toBeUndefined();
  });

  it('falls back to markdown metadata when artifact/preview content URLs are unavailable', () => {
    const files = runtimeEvidenceOverviewFiles(
      tZh,
      emptyEvidence({
        artifacts: [
          sampleArtifact({
            id: 'art-2',
            path: 'notes.md',
            kind: 'markdown',
            runId: '',
            threadId: 't-2',
            createdAt: '2026-07-03T00:00:00Z',
          }),
        ],
        previews: [
          samplePreview({
            id: 'prev-2',
            status: 'stopped',
            runId: '',
            createdAt: '2026-07-03T00:00:00Z',
          }),
        ],
      })
    );

    expect(files[0]?.content).toContain('# notes.md');
    expect(files[0]?.content).toContain('- Thread: t-2');
    expect(files[1]?.content).toContain('# Preview prev-2');
    expect(files[1]?.content).toContain('- Status: stopped');
  });

  it('builds overview kicker labels from run id', () => {
    expect(runtimeEvidenceOverviewKicker(emptyEvidence())).toBe('Hub replay');
    expect(runtimeEvidenceOverviewKicker(emptyEvidence({ runId: 'run-42' }))).toBe(
      'Hub replay / run-42'
    );
  });

  it('serializes file diffs with git-style prefixes', () => {
    const text = fileDiffToText(sampleDiff());
    expect(text).toContain('diff --git a/src/app.ts b/src/app.ts');
    expect(text).toContain('@@ -1,2 +1,3 @@');
    expect(text).toContain(' const a = 1');
    expect(text).toContain('-const b = 2');
    expect(text).toContain('+const b = 3');
    expect(text).toContain('+const c = 4');
    expect(diffLinePrefix('added')).toBe('+');
    expect(diffLinePrefix('deleted')).toBe('-');
    expect(diffLinePrefix('context')).toBe(' ');
    expect(diffMeta(sampleDiff({ additions: 5, deletions: 3 }))).toBe('+5 -3');
  });

  it('builds runtime diff preview files with optional interactive payload', () => {
    const withInteractive = runtimeDiffPreviewFile(sampleDiff(), 'run-1', '/work');
    expect(withInteractive).toMatchObject({
      name: 'src/app.ts',
      type: 'modified',
      owner: 'Edge evidence',
      interactiveDiff: {
        runId: 'run-1',
        workDir: '/work',
      },
    });
    expect(withInteractive.diffContent).toContain('diff --git a/src/app.ts b/src/app.ts');

    const readonly = runtimeDiffPreviewFile(sampleDiff(), undefined, '/work');
    expect(readonly.interactiveDiff).toBeUndefined();
  });

  it('projects artifact workspace labels and preview status', () => {
    expect(artifactWorkspaceDiffLabel(1)).toBe('1 file');
    expect(artifactWorkspaceDiffLabel(3)).toBe('3 files');
    expect(artifactWorkspaceTopic(sampleArtifact({ threadId: 'topic-1' }))).toBe('topic-1');
    expect(artifactWorkspaceTopic(sampleArtifact({ threadId: '' }))).toBe('unknown');
    expect(
      artifactWorkspaceVersion(sampleArtifact({ runId: 'artifact-run' }), 'fallback-run')
    ).toBe('artifact-run');
    expect(artifactWorkspaceVersion(sampleArtifact({ runId: '' }), 'fallback-run')).toBe(
      'fallback-run'
    );
    expect(artifactWorkspaceVersion(sampleArtifact({ runId: '' }), undefined)).toBe('unknown');

    expect(artifactWorkspacePreviewStatus([])).toBe('none');
    expect(
      artifactWorkspacePreviewStatus([
        samplePreview({ id: 'p1', status: 'starting' }),
        samplePreview({ id: 'p2', status: 'ready' }),
      ])
    ).toBe('ready');
    expect(artifactWorkspacePreviewStatus([samplePreview({ id: 'p1', status: 'starting' })])).toBe(
      'starting'
    );
  });

  it('builds the artifact download ref with run id fallback (#1945)', () => {
    expect(artifactDownloadRef(sampleArtifact({ id: 'art-1', runId: 'run-1' }), 'fallback')).toEqual({
      kind: 'artifact',
      runId: 'run-1',
      id: 'art-1',
    });
    // Empty artifact run id falls back to the snapshot run id.
    expect(artifactDownloadRef(sampleArtifact({ id: 'art-1', runId: '' }), 'fallback')).toEqual({
      kind: 'artifact',
      runId: 'fallback',
      id: 'art-1',
    });
    // No resolvable run id means no downloadable ref (renderer disables the action).
    expect(artifactDownloadRef(sampleArtifact({ id: 'art-1', runId: '' }), undefined)).toBeUndefined();
    expect(artifactDownloadRef(sampleArtifact({ id: 'art-1', runId: '' }), '')).toBeUndefined();
    // A missing artifact id also yields no ref.
    expect(artifactDownloadRef(sampleArtifact({ id: '', runId: 'run-1' }), 'run-1')).toBeUndefined();
  });

  it('derives a bare download name from the artifact path basename (#1945)', () => {
    expect(artifactDownloadName(sampleArtifact({ path: 'out/report.md', id: 'a1' }))).toBe(
      'report.md'
    );
    expect(artifactDownloadName(sampleArtifact({ path: 'dist\\bundle/app.js', id: 'a1' }))).toBe(
      'app.js'
    );
    // No usable basename falls back to the artifact id.
    expect(artifactDownloadName(sampleArtifact({ path: '', id: 'a1' }))).toBe('a1');
    expect(artifactDownloadName(sampleArtifact({ path: '   ', id: 'a1' }))).toBe('a1');
  });
});

describe('runtime evidence overview labels en convergence (#2032)', () => {
  const tEn = createTestI18n({ lng: 'en' }).getFixedT('en', SHARED_WORKBENCH_I18N_NAMESPACE);

  it('renders natural English task labels for empty and populated evidence', () => {
    expect(runtimeEvidenceOverviewTasks(tEn, emptyEvidence())).toEqual([
      { label: 'Waiting for Hub replay evidence', status: 'todo' },
    ]);

    const tasks = runtimeEvidenceOverviewTasks(
      tEn,
      emptyEvidence({ runId: 'run-7', artifacts: [sampleArtifact()] }),
    );
    expect(tasks).toEqual([
      { label: 'Following run-7', status: 'active' },
      { label: 'Hub replay artifact index: 1', status: 'done' },
    ]);
  });

  it('maps overview files with the en translator without copy drift', () => {
    const files = runtimeEvidenceOverviewFiles(
      tEn,
      emptyEvidence({ runId: 'run-7', artifacts: [sampleArtifact({ id: 'art-en' })] }),
    );
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ name: 'out/report.md', owner: 'Hub replay' });
  });
});
