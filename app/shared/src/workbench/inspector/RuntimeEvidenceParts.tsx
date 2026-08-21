import React from 'react';
import type { RuntimeEvidenceChannel, RuntimeEvidenceSnapshot } from '../../inspector';
import type { FileDiff } from '../../types/chat';
import { DesignFileIcon, DesignNavIcon } from '../designIcons';
import styles from '../AgentHubWorkbench.module.css';
import {
  artifactWorkspaceDiffLabel,
  artifactWorkspacePreviewStatus,
  artifactWorkspaceTopic,
  artifactWorkspaceVersion,
  diffMeta,
} from './RuntimeEvidenceHelpers';

/* ═══════════════════════════════════════════════════════════════════════
   RuntimeEvidenceParts — presentational residual slices from
   RuntimeEvidencePanel (#733).

   Section chrome, empty state, and channel row lists. CSS remains on
   shared AgentHubWorkbench.module.css. No intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export function RuntimeEvidenceEmptyState({
  emptyTitle,
  emptyDetail,
}: {
  emptyTitle: string;
  emptyDetail: string;
}): React.ReactElement {
  return (
    <div className={styles.browserPreviewCard}>
      <DesignNavIcon className={styles.browserPreviewIcon} name="overview" size={24} />
      <strong>{emptyTitle}</strong>
      <span>{emptyDetail}</span>
    </div>
  );
}

export function RuntimeEvidenceSection({
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

export function ArtifactWorkspaceProjection({
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
  const topic = artifactWorkspaceTopic(artifact);
  const version = artifactWorkspaceVersion(artifact, runId);
  const diffLabel = artifactWorkspaceDiffLabel(diffCount);
  return (
    <div
      aria-label={`Artifact workspace ${artifact.path}`}
      className={styles.artifactWorkspace}
      role="group"
    >
      <span>Topic: {topic}</span>
      <span>Version: {version}</span>
      <span>Preview: {previewStatus}</span>
      <span>
        Download: unavailable — no download action; preview resolves artifact content via host port
      </span>
      <span>Export: unavailable — this panel has no export action (review-only evidence)</span>
      <span>Evidence: {evidenceSourceLabel ?? 'None'}</span>
      <span>Diff projection: {diffLabel}</span>
    </div>
  );
}

export function RuntimeEvidenceDiffSection({
  count,
  diffs,
  onOpenDiff,
  sourceLabel,
}: {
  count?: number | undefined;
  diffs: FileDiff[];
  onOpenDiff: (file: FileDiff) => void;
  sourceLabel?: string | undefined;
}): React.ReactElement {
  return (
    <RuntimeEvidenceSection
      channel="diff"
      count={count}
      sourceLabel={sourceLabel}
      title="Diff snapshot"
    >
      {diffs.map((file) => (
        <li key={`diff-${file.filePath}`}>
          <button
            type="button"
            aria-label={`打开 diff ${file.filePath}`}
            className={styles.fileRow}
            onClick={() => onOpenDiff(file)}
          >
            <DesignFileIcon className={styles.fileIcon} name={file.filePath} />
            <span className={styles.fileName}>{file.filePath}</span>
            <span className={styles.fileMeta}>{diffMeta(file)}</span>
            {file.editId && <span className={styles.fileMeta}>edit {file.editId}</span>}
            {file.reviewStatus && (
              <span className={styles.fileMeta}>review {file.reviewStatus}</span>
            )}
            {file.canApply !== undefined && (
              <span className={styles.fileMeta}>
                apply {file.canApply ? 'available' : 'unavailable'}
              </span>
            )}
            {file.canRevert !== undefined && (
              <span className={styles.fileMeta}>
                revert {file.canRevert ? 'available' : 'unavailable'}
              </span>
            )}
          </button>
        </li>
      ))}
    </RuntimeEvidenceSection>
  );
}

export function RuntimeEvidenceArtifactsSection({
  artifacts,
  count,
  diffCount,
  previews,
  runId,
  sourceLabel,
}: {
  artifacts: RuntimeEvidenceSnapshot['artifacts'];
  count?: number | undefined;
  diffCount: number;
  previews: RuntimeEvidenceSnapshot['previews'];
  runId?: string | undefined;
  sourceLabel?: string | undefined;
}): React.ReactElement {
  const previewStatus = artifactWorkspacePreviewStatus(previews);
  return (
    <RuntimeEvidenceSection
      channel="artifacts"
      count={count}
      sourceLabel={sourceLabel}
      title="Artifacts"
    >
      {artifacts.map((artifact) => (
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
            diffCount={diffCount}
            evidenceSourceLabel={sourceLabel}
            previewStatus={previewStatus}
            runId={runId}
          />
        </li>
      ))}
    </RuntimeEvidenceSection>
  );
}

export function RuntimeEvidencePreviewsSection({
  count,
  onOpenPreviewUrl,
  previews,
  sourceLabel,
}: {
  count?: number | undefined;
  onOpenPreviewUrl: (url: string) => void;
  previews: RuntimeEvidenceSnapshot['previews'];
  sourceLabel?: string | undefined;
}): React.ReactElement {
  return (
    <RuntimeEvidenceSection
      channel="previews"
      count={count}
      sourceLabel={sourceLabel}
      title="Previews"
    >
      {previews.map((preview) => {
        const canOpen = Boolean(preview.url);
        return (
          <li key={preview.id}>
            <button
              type="button"
              aria-label={`打开预览 ${preview.id}`}
              className={styles.fileRow}
              disabled={!canOpen}
              onClick={() => {
                if (preview.url) onOpenPreviewUrl(preview.url);
              }}
            >
              <DesignFileIcon
                className={styles.fileIcon}
                name={preview.url ?? preview.id}
                type="link"
              />
              <span className={styles.fileName}>{preview.url ?? preview.id}</span>
              <span className={styles.fileMeta}>{preview.status}</span>
            </button>
          </li>
        );
      })}
    </RuntimeEvidenceSection>
  );
}
