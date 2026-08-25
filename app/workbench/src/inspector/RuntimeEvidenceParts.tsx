import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeEvidenceChannel, RuntimeEvidenceSnapshot } from '@shared/inspector';
import type { PreviewPort } from '@shared/platform';
import type { FileDiff } from '@shared/types/chat';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import { useToastStore } from '@shared/ui/toast/toastStore';
import { DesignFileIcon, DesignNavIcon } from '../designIcons';
import styles from '../AgentHubWorkbench.module.css';
import {
  artifactDownloadName,
  artifactDownloadRef,
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
  previewPort,
  previewStatus,
  runId,
}: {
  artifact: RuntimeEvidenceSnapshot['artifacts'][number];
  diffCount: number;
  evidenceSourceLabel?: string | undefined;
  previewPort?: PreviewPort | undefined;
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
      <ArtifactDownloadControl artifact={artifact} previewPort={previewPort} runId={runId} />
      <span>Export: unavailable — this panel has no export action (review-only evidence)</span>
      <span>Evidence: {evidenceSourceLabel ?? 'None'}</span>
      <span>Diff projection: {diffLabel}</span>
    </div>
  );
}

/* ═══ Artifact download action (#1945) ═══════════════════════════════════
   Goes through the platform PreviewPort: surfaces that own the backing
   runtime (Desktop → Local Edge) implement `downloadArtifactContent` and get
   a real download button; surfaces without a reachable artifact content
   endpoint (Web — Hub-only, no Hub content route) omit the port method and
   render the consistent "download unavailable" notice. The renderer never
   constructs a host REST path — the endpoint mapping stays in the port.
   ═══════════════════════════════════════════════════════════════════════ */
function ArtifactDownloadControl({
  artifact,
  previewPort,
  runId,
}: {
  artifact: RuntimeEvidenceSnapshot['artifacts'][number];
  previewPort?: PreviewPort | undefined;
  runId?: string | undefined;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const showToast = useToastStore((state) => state.showToast);
  const [downloading, setDownloading] = useState(false);
  const downloadArtifactContent = previewPort?.downloadArtifactContent;

  // Hub-only surfaces (Web) omit the port method — degrade to the consistent
  // unavailable notice instead of a silent no-op (#1945).
  if (!downloadArtifactContent) {
    return (
      <span className={styles.artifactDownloadNotice} role="status">
        {t('inspector.artifactDownloadUnavailable')}
      </span>
    );
  }

  const ref = artifactDownloadRef(artifact, runId);
  const handleDownload = async (): Promise<void> => {
    if (!ref || downloading) return;
    setDownloading(true);
    try {
      await downloadArtifactContent({ ref, suggestedName: artifactDownloadName(artifact) });
    } catch (err) {
      console.error('[RuntimeEvidenceParts] artifact download failed:', err);
      showToast('error', t('toast.artifactDownloadFailed'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      type="button"
      aria-label={t('ui.downloadArtifact')}
      className={styles.artifactDownloadButton}
      disabled={downloading || !ref}
      onClick={handleDownload}
    >
      {t('ui.downloadArtifact')}
    </button>
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
  previewPort,
  previews,
  runId,
  sourceLabel,
}: {
  artifacts: RuntimeEvidenceSnapshot['artifacts'];
  count?: number | undefined;
  diffCount: number;
  previewPort?: PreviewPort | undefined;
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
            previewPort={previewPort}
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
