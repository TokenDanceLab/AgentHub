import React from 'react';
import { buildRuntimeEvidenceInspectorModel } from '../../inspector';
import type { RuntimeEvidenceChannel, RuntimeEvidenceSnapshot } from '../../inspector';
import type { FileDiff } from '../../types/chat';
import {
  DesignFileIcon,
  DesignNavIcon,
} from '../designIcons';
import styles from '../AgentHubWorkbench.module.css';
import type { PreviewFile } from './FilePreviewRouter';
import type { TaskItem } from './OverviewPanel';

/* ═══════════════════════════════════════════════════════════════════════
   RuntimeEvidencePanel — Hub-replay runtime evidence overview mappers,
   files-mode panel UI, and diff/preview helpers.

   Extracted from RightInspector as Phase 15 strangler slice #539.
   CSS remains on shared AgentHubWorkbench.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

export function runtimeEvidenceOverviewTasks(runtimeEvidence: RuntimeEvidenceSnapshot): TaskItem[] {
  const tasks: TaskItem[] = [];
  if (runtimeEvidence.runId) {
    tasks.push({ label: `跟随 ${runtimeEvidence.runId}`, status: 'active' });
  }
  if (runtimeEvidence.artifacts.length > 0) {
    tasks.push({ label: `Hub replay artifact index: ${runtimeEvidence.artifacts.length}`, status: 'done' });
  }
  if (runtimeEvidence.diffs.length > 0) {
    tasks.push({ label: `Diff snapshot: ${runtimeEvidence.diffs.length}`, status: 'done' });
  }
  if (runtimeEvidence.previews.length > 0) {
    tasks.push({ label: `Preview index: ${runtimeEvidence.previews.length}`, status: 'done' });
  }
  return tasks.length > 0
    ? tasks
    : [{ label: '等待 Hub replay evidence', status: 'todo' }];
}

export function runtimeEvidenceOverviewFiles(runtimeEvidence: RuntimeEvidenceSnapshot): PreviewFile[] {
  return [
    ...runtimeEvidence.artifacts.map((artifact) => {
      const artifactRunId = artifact.runId || runtimeEvidence.runId;
      const artifactContentUrl = artifactRunId
        ? `/v1/runs/${artifactRunId}/artifacts/${artifact.id}/content`
        : undefined;
      return {
        name: artifact.path,
        type: artifact.kind,
        isPrimary: true,
        owner: 'Hub replay',
        content: artifactContentUrl ?? [
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
      const previewContentUrl = preview.url || (previewRunId
        ? `/v1/runs/${previewRunId}/previews/${preview.id}/content`
        : undefined);
      return {
        name: preview.url || preview.id,
        type: 'preview',
        owner: 'Hub replay',
        content: previewContentUrl ?? [
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

export interface RuntimeEvidencePanelProps {
  runtimeEvidence: RuntimeEvidenceSnapshot;
  onOpenDiff: (file: FileDiff) => void;
  onOpenPreviewUrl: (url: string) => void;
}

export function RuntimeEvidencePanel({
  runtimeEvidence,
  onOpenDiff,
  onOpenPreviewUrl,
}: RuntimeEvidencePanelProps): React.ReactElement {
  const evidenceModel = buildRuntimeEvidenceInspectorModel(runtimeEvidence);
  const diffSummary = evidenceModel.channels.find((channel) => channel.channel === 'diff');
  const artifactSummary = evidenceModel.channels.find((channel) => channel.channel === 'artifacts');
  const previewSummary = evidenceModel.channels.find((channel) => channel.channel === 'previews');

  return (
    <div className={styles.runtimeEvidence}>
      <div className={styles.runtimeEvidenceHead}>
        <strong>运行证据</strong>
        <span>{evidenceModel.runLabel}</span>
      </div>

      {evidenceModel.stateItems.length > 0 && (
        <ul className={styles.runtimeEvidenceStateList} aria-label="Runtime evidence state">
          {evidenceModel.stateItems.map((item) => (
            <li key={`${item.kind}-${item.channel}`} className={styles.runtimeEvidenceState} data-state={item.kind}>{item.label}</li>
          ))}
        </ul>
      )}

      {!evidenceModel.hasEvidence && evidenceModel.stateItems.length === 0 && (
        <div className={styles.browserPreviewCard}>
          <DesignNavIcon className={styles.browserPreviewIcon} name="overview" size={24} />
          <strong>{evidenceModel.emptyTitle}</strong>
          <span>{evidenceModel.emptyDetail}</span>
        </div>
      )}

      {runtimeEvidence.diffs.length > 0 && (
        <RuntimeEvidenceSection channel="diff" count={diffSummary?.count} sourceLabel={diffSummary?.sourceLabel} title="Diff snapshot">
          {runtimeEvidence.diffs.map((file) => (
            <li key={`diff-${file.filePath}`}>
              <button
                aria-label={`打开 diff ${file.filePath}`}
                className={styles.fileRow}
                onClick={() => onOpenDiff(file)}
                type="button"
              >
                <DesignFileIcon className={styles.fileIcon} name={file.filePath} />
                <span className={styles.fileName}>{file.filePath}</span>
                <span className={styles.fileMeta}>{diffMeta(file)}</span>
                {file.editId && <span className={styles.fileMeta}>edit {file.editId}</span>}
                {file.reviewStatus && <span className={styles.fileMeta}>review {file.reviewStatus}</span>}
                {file.canApply !== undefined && (
                  <span className={styles.fileMeta}>apply {file.canApply ? 'available' : 'unavailable'}</span>
                )}
                {file.canRevert !== undefined && (
                  <span className={styles.fileMeta}>revert {file.canRevert ? 'available' : 'unavailable'}</span>
                )}
              </button>
            </li>
          ))}
        </RuntimeEvidenceSection>
      )}

      {runtimeEvidence.artifacts.length > 0 && (
        <RuntimeEvidenceSection channel="artifacts" count={artifactSummary?.count} sourceLabel={artifactSummary?.sourceLabel} title="Artifacts">
          {runtimeEvidence.artifacts.map((artifact) => (
            <li key={artifact.id}>
              <div
                aria-label={`产物 metadata ${artifact.path}`}
                className={`${styles.fileRow} ${styles.readonlyEvidenceRow}`}
              >
                <DesignFileIcon className={styles.fileIcon} name={artifact.path} />
                <span className={styles.fileName}>{artifact.path}</span>
                <span className={styles.fileMeta}>{artifact.kind}</span>
              </div>
              <ArtifactWorkspaceProjection
                artifact={artifact}
                diffCount={runtimeEvidence.diffs.length}
                evidenceSourceLabel={artifactSummary?.sourceLabel}
                previewStatus={artifactWorkspacePreviewStatus(runtimeEvidence.previews)}
                runId={runtimeEvidence.runId}
              />
            </li>
          ))}
        </RuntimeEvidenceSection>
      )}

      {runtimeEvidence.previews.length > 0 && (
        <RuntimeEvidenceSection channel="previews" count={previewSummary?.count} sourceLabel={previewSummary?.sourceLabel} title="Previews">
          {runtimeEvidence.previews.map((preview) => {
            const canOpen = Boolean(preview.url);
            return (
              <li key={preview.id}>
                <button
                  aria-label={`打开预览 ${preview.id}`}
                  className={styles.fileRow}
                  disabled={!canOpen}
                  onClick={() => {
                    if (preview.url) onOpenPreviewUrl(preview.url);
                  }}
                  type="button"
                >
                  <DesignFileIcon className={styles.fileIcon} name={preview.url ?? preview.id} type="link" />
                  <span className={styles.fileName}>{preview.url ?? preview.id}</span>
                  <span className={styles.fileMeta}>{preview.status}</span>
                </button>
              </li>
            );
          })}
        </RuntimeEvidenceSection>
      )}
    </div>
  );
}

function ArtifactWorkspaceProjection({
  artifact,
  diffCount,
  evidenceSourceLabel,
  previewStatus,
  runId,
}: {
  artifact: RuntimeEvidenceSnapshot['artifacts'][number];
  diffCount: number;
  evidenceSourceLabel?: string | undefined;
  previewStatus: string;
  runId?: string | undefined;
}): React.ReactElement {
  const topic = artifact.threadId || 'unknown';
  const version = artifact.runId || runId || 'unknown';
  const diffLabel = diffCount === 1 ? '1 file' : `${diffCount} files`;
  return (
    <div
      aria-label={`Artifact workspace ${artifact.path}`}
      className={styles.artifactWorkspace}
      role="group"
    >
      <span>Topic: {topic}</span>
      <span>Version: {version}</span>
      <span>Preview: {previewStatus}</span>
      <span>Download: metadata only</span>
      <span>Export: evidence bundle ready</span>
      <span>Evidence: {evidenceSourceLabel ?? 'None'}</span>
      <span>Diff projection: {diffLabel}</span>
    </div>
  );
}

function RuntimeEvidenceSection({
  channel,
  children,
  count,
  sourceLabel,
  title,
}: {
  channel: RuntimeEvidenceChannel;
  children: React.ReactNode;
  count?: number | undefined;
  sourceLabel?: string | undefined;
  title: string;
}): React.ReactElement {
  const meta = [sourceLabel, typeof count === 'number' ? `${count}` : undefined]
    .filter(Boolean)
    .join(' / ');
  return (
    <section className={styles.runtimeEvidenceSection}>
      <div className={styles.runtimeEvidenceSectionTitle} data-channel={channel}>
        <span>{title}</span>
        {meta && <em>{meta}</em>}
      </div>
      <ul className={styles.fileList}>{children}</ul>
    </section>
  );
}

export function runtimeDiffPreviewFile(file: FileDiff, runId: string | undefined, workDir: string | undefined): PreviewFile {
  return {
    name: file.filePath,
    type: file.status,
    owner: 'Edge evidence',
    content: [
      `Read-only runtime diff evidence for ${file.filePath}.`,
      'Artifact content/apply/discard are not available in this inspector slice.',
    ].join('\n'),
    diffContent: fileDiffToText(file),
    interactiveDiff: (runId && workDir) ? { runId, fileDiff: file, workDir } : undefined,
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

function diffLinePrefix(type: FileDiff['hunks'][number]['lines'][number]['type']): string {
  if (type === 'added') return '+';
  if (type === 'deleted') return '-';
  return ' ';
}

function diffMeta(file: FileDiff): string {
  return `+${file.additions} -${file.deletions}`;
}

function artifactWorkspacePreviewStatus(previews: RuntimeEvidenceSnapshot['previews']): string {
  const readyPreview = previews.find((preview) => preview.status === 'ready');
  return readyPreview?.status ?? previews[0]?.status ?? 'none';
}
