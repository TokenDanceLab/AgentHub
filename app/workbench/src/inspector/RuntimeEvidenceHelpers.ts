import type { RuntimeEvidenceSnapshot } from '@shared/inspector';
import type { RuntimeEvidenceContentRef } from '@shared/platform';
import type { FileDiff } from '@shared/types/chat';
import type { PreviewFile } from './FilePreviewRouter';
import type { InspectorTranslator } from './InspectorModePanelHelpers';
import type { TaskItem } from './OverviewPanel';

/* ═══════════════════════════════════════════════════════════════════════
   RuntimeEvidenceHelpers — pure residual slices from RuntimeEvidencePanel
   (#733).

   Overview mappers, diff text builders, and workspace status helpers.
   No React / no intentional UX change.

   i18n note (#2032): overview task labels resolve through the
   sharedWorkbench bundle via a passed-in translator.
   ═══════════════════════════════════════════════════════════════════════ */

export function runtimeEvidenceOverviewTasks(
  t: InspectorTranslator,
  runtimeEvidence: RuntimeEvidenceSnapshot,
): TaskItem[] {
  const tasks: TaskItem[] = [];
  if (runtimeEvidence.runId) {
    tasks.push({ label: t('inspector.followRun', { runId: runtimeEvidence.runId }), status: 'active' });
  }
  if (runtimeEvidence.artifacts.length > 0) {
    tasks.push({
      label: `Hub replay artifact index: ${runtimeEvidence.artifacts.length}`,
      status: 'done',
    });
  }
  if (runtimeEvidence.diffs.length > 0) {
    tasks.push({ label: `Diff snapshot: ${runtimeEvidence.diffs.length}`, status: 'done' });
  }
  if (runtimeEvidence.previews.length > 0) {
    tasks.push({ label: `Preview index: ${runtimeEvidence.previews.length}`, status: 'done' });
  }
  return tasks.length > 0 ? tasks : [{ label: t('inspector.waitingReplay'), status: 'todo' }];
}

export function runtimeEvidenceOverviewFiles(
  _t: InspectorTranslator,
  runtimeEvidence: RuntimeEvidenceSnapshot
): PreviewFile[] {
  return [
    ...runtimeEvidence.artifacts.map((artifact) => {
      const artifactRunId = artifact.runId || runtimeEvidence.runId;
      return {
        name: artifact.path,
        type: artifact.kind,
        isPrimary: true,
        owner: 'Hub replay',
        // Known artifact size feeds the media preview size caps (#1939).
        sizeBytes: artifact.sizeBytes,
        // Host-owned content endpoint ref (Desktop resolves it against the
        // Local Edge); shared never constructs host REST paths.
        contentRef: artifactRunId
          ? ({
              kind: 'artifact',
              runId: artifactRunId,
              id: artifact.id,
            } satisfies RuntimeEvidenceContentRef)
          : undefined,
        content: [
          `# ${artifact.path}`,
          '',
          `- Run: ${artifact.runId || runtimeEvidence.runId || 'unknown'}`,
          `- Thread: ${artifact.threadId || 'unknown'}`,
          `- Kind: ${artifact.kind}`,
          `- Created: ${artifact.createdAt || 'unknown'}`,
        ].join('\n'),
      };
    }),
    ...runtimeEvidence.diffs.map((file) => ({
      name: file.filePath,
      type: 'diff',
      owner: 'Hub replay',
      content: [
        `Read-only runtime diff evidence for ${file.filePath}.`,
        'Artifact content/apply/discard are not available in this inspector slice.',
      ].join('\n'),
      diffContent: fileDiffToText(file),
    })),
    ...runtimeEvidence.previews.map((preview) => {
      const previewRunId = preview.runId || runtimeEvidence.runId;
      const hasDisplayableUrl = Boolean(preview.url);
      return {
        name: preview.url || preview.id,
        type: 'preview',
        owner: 'Hub replay',
        // Same host-owned ref contract as artifacts; previews with their own
        // URL display that URL directly and need no endpoint resolution.
        contentRef:
          !hasDisplayableUrl && previewRunId
            ? ({
                kind: 'preview',
                runId: previewRunId,
                id: preview.id,
              } satisfies RuntimeEvidenceContentRef)
            : undefined,
        content:
          preview.url ??
          [
            `# Preview ${preview.id}`,
            '',
            `- Run: ${preview.runId || runtimeEvidence.runId || 'unknown'}`,
            `- Status: ${preview.status}`,
            `- URL: ${preview.url || 'not available'}`,
            `- Created: ${preview.createdAt || 'unknown'}`,
          ].join('\n'),
      };
    }),
  ];
}

export function runtimeEvidenceOverviewKicker(runtimeEvidence: RuntimeEvidenceSnapshot): string {
  return runtimeEvidence.runId ? `Hub replay / ${runtimeEvidence.runId}` : 'Hub replay';
}

export function runtimeDiffPreviewFile(
  file: FileDiff,
  runId: string | undefined,
  workDir: string | undefined
): PreviewFile {
  return {
    name: file.filePath,
    type: file.status,
    owner: 'Edge evidence',
    content: [
      `Read-only runtime diff evidence for ${file.filePath}.`,
      'Artifact content/apply/discard are not available in this inspector slice.',
    ].join('\n'),
    diffContent: fileDiffToText(file),
    interactiveDiff: runId && workDir ? { runId, fileDiff: file, workDir } : undefined,
  };
}

export function fileDiffToText(file: FileDiff): string {
  const chunks = [`diff --git a/${file.filePath} b/${file.filePath}`];
  for (const hunk of file.hunks) {
    chunks.push(hunk.header);
    for (const line of hunk.lines) {
      chunks.push(`${diffLinePrefix(line.type)}${line.content}`);
    }
  }
  return chunks.join('\n');
}

export function diffLinePrefix(type: FileDiff['hunks'][number]['lines'][number]['type']): string {
  if (type === 'added') return '+';
  if (type === 'deleted') return '-';
  return ' ';
}

export function diffMeta(file: FileDiff): string {
  return `+${file.additions} -${file.deletions}`;
}

export function artifactWorkspacePreviewStatus(
  previews: RuntimeEvidenceSnapshot['previews']
): string {
  const readyPreview = previews.find((preview) => preview.status === 'ready');
  return readyPreview?.status ?? previews[0]?.status ?? 'none';
}

export function artifactWorkspaceDiffLabel(diffCount: number): string {
  return diffCount === 1 ? '1 file' : `${diffCount} files`;
}

export function artifactWorkspaceTopic(
  artifact: RuntimeEvidenceSnapshot['artifacts'][number]
): string {
  return artifact.threadId || 'unknown';
}

export function artifactWorkspaceVersion(
  artifact: RuntimeEvidenceSnapshot['artifacts'][number],
  runId: string | undefined
): string {
  return artifact.runId || runId || 'unknown';
}

/**
 * Build the neutral content ref used for an artifact download (#1945).
 * Mirrors the artifact `contentRef` mapping in `runtimeEvidenceOverviewFiles`:
 * the run id falls back to the snapshot run id, and a missing run id yields
 * `undefined` so the renderer can disable the action instead of resolving a
 * malformed host endpoint.
 */
export function artifactDownloadRef(
  artifact: RuntimeEvidenceSnapshot['artifacts'][number],
  fallbackRunId: string | undefined
): RuntimeEvidenceContentRef | undefined {
  const runId = artifact.runId || fallbackRunId;
  if (!runId || !artifact.id) return undefined;
  return { kind: 'artifact', runId, id: artifact.id };
}

/**
 * Derive a display file name for a downloaded artifact from its workspace
 * path basename; falls back to the artifact id. Returns a bare file name —
 * never a host path — so it is safe to use as a download `suggestedName`.
 */
export function artifactDownloadName(
  artifact: RuntimeEvidenceSnapshot['artifacts'][number]
): string {
  const base = artifact.path.split(/[\\/]/).pop()?.trim();
  return base || artifact.id;
}
