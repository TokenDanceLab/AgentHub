import React from 'react';
import { useTranslation } from 'react-i18next';
import type { EvidenceRef, ContextUsageTranscriptBlock } from '@shared/transcript';
import { formatTokens } from '@shared/context/breakdown';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import {
  DesignFileIcon,
  DesignNavIcon,
} from '../designIcons';
import styles from '../AgentHubWorkbench.module.css';
import type { FileItem } from './OverviewPanel';
import {
  canOpenEvidence,
  contextBarFillWidth,
  contextBarVariantClass,
  type DeployStatus,
  deployDotColor,
  deployStatusLabel,
  formatDeployUrlDisplay,
  isDeployInProgress,
  isDeployReady,
  resolveContextUsagePercent,
  resolveLatestContextUsage,
} from './InspectorModePanelHelpers';

/* ═══════════════════════════════════════════════════════════════════════
   InspectorModePanelParts — presentational residual slices from
   InspectorModePanels (#731).

   Context usage, deploy status, browser fallback, and files panels.
   CSS remains on shared AgentHubWorkbench.module.css.
   No intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export function OverviewContextUsage({
  blocks,
}: {
  blocks: ContextUsageTranscriptBlock[];
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  // Use the latest block (most recent context usage snapshot).
  const latest = resolveLatestContextUsage(blocks);
  if (!latest) {
    return <></>;
  }

  const usagePercent = resolveContextUsagePercent(latest);
  const barVariant = contextBarVariantClass(usagePercent, styles);

  return (
    <div className={styles.contextSection} role="status" aria-label={t('aria.contextUsage')}>
      <div className={styles.contextHead}>
        <span>{latest.modelLabel || 'Context'}</span>
        {usagePercent != null && (
          <span className={styles.contextPercent}>{usagePercent}%</span>
        )}
      </div>
      {usagePercent != null && (
        <div className={`${styles.contextBar} ${barVariant}`}>
          <div
            className={styles.contextBarFill}
            style={{ width: contextBarFillWidth(usagePercent) }}
          />
        </div>
      )}
      <div className={styles.contextStats}>
        <span>{formatTokens(latest.inputTokens)} in</span>
        <span>{formatTokens(latest.outputTokens)} out</span>
        {latest.cost && <span className={styles.contextCost}>{latest.cost}</span>}
      </div>
    </div>
  );
}

export function DeployStatusBar({
  status,
  url,
}: {
  status: DeployStatus;
  url?: string | undefined;
}): React.ReactElement {
  const { t: tWorkbench } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const isReady = isDeployReady(status);
  const isDeploying = isDeployInProgress(status);
  const statusLabel = deployStatusLabel(tWorkbench, status);
  const dotColor = deployDotColor(status);

  return (
    <div
      className={styles.deployStatusBar}
      data-deploy-status={status}
      role="status"
      aria-label={tWorkbench('inspector.deployStatusAria', { label: statusLabel })}
    >
      <span
        className={styles.deployStatusDot}
        style={{ background: dotColor }}
        aria-hidden="true"
      />
      <span className={styles.deployStatusLabel}>{statusLabel}</span>
      {isDeploying && <span className={styles.deploySpinner} aria-hidden="true" />}
      {url && isReady && (
        <span className={styles.deployUrl} title={url}>{formatDeployUrlDisplay(url)}</span>
      )}
    </div>
  );
}

export function BrowserPanelFallback({
  artifacts,
  canOpenPreview,
  onOpenPreview,
  onOpenUrl,
}: {
  artifacts: EvidenceRef[];
  canOpenPreview?: ((evidence: EvidenceRef) => boolean) | undefined;
  onOpenPreview?: ((evidence: EvidenceRef) => Promise<void>) | undefined;
  onOpenUrl: (url: string) => void;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const { t: tWorkbench } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  if (artifacts.length > 0) {
    return (
      <div className={styles.browserPreviewCard}>
        <DesignNavIcon className={styles.browserPreviewIcon} name="browser" size={24} />
        <strong>{tWorkbench('inspector.browserReady')}</strong>
        <span>{tWorkbench('inspector.detectedArtifacts', { count: artifacts.length })}</span>
        <ul aria-label={t('aria.previewArtifacts')} className={styles.browserArtifactList}>
          {artifacts.map((artifact) => {
            const canOpen = canOpenEvidence(artifact, onOpenPreview, canOpenPreview);
            return (
              <li key={artifact.id}>
                <button type="button"
                  aria-label={tWorkbench('inspector.openArtifact', { name: artifact.label })}
                  className={styles.browserArtifactButton}
                  disabled={!canOpen}
                  onClick={() => {
                    if (artifact.uri) {
                      onOpenUrl(artifact.uri);
                    } else if (canOpen) {
                      void onOpenPreview?.(artifact).catch((err) => {
                        console.error('RightInspector: onOpenPreview artifact failed:', err);
                      });
                    }
                  }}
                >
                  <DesignFileIcon
                    className={styles.fileIcon}
                    name={artifact.label}
                    type={artifact.uri ? 'link' : undefined}
                  />
                  <span className={styles.fileName}>{artifact.label}</span>
                  <span className={styles.fileMeta}>{canOpen ? tWorkbench('inspector.open') : tWorkbench('inspector.pendingIntegration')}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className={styles.browserPreviewCard}>
      <DesignNavIcon className={styles.browserPreviewIcon} name="browser" size={24} />
      <strong>{tWorkbench('inspector.browserReady')}</strong>
      <span>{tWorkbench('inspector.browserWaiting')}</span>
    </div>
  );
}

export function FilesPanel({
  canOpenPreview,
  fallbackFiles,
  files,
  onFallbackFileClick,
  onOpenPreview,
}: {
  canOpenPreview?: ((evidence: EvidenceRef) => boolean) | undefined;
  fallbackFiles?: FileItem[] | undefined;
  files: EvidenceRef[];
  onFallbackFileClick?: ((file: FileItem) => void) | undefined;
  onOpenPreview?: ((evidence: EvidenceRef) => Promise<void>) | undefined;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const { t: tWorkbench } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  if (files.length === 0 && fallbackFiles && fallbackFiles.length > 0) {
    return (
      <ul aria-label={t('aria.changedFiles')} className={styles.fileList}>
        {fallbackFiles.map((file) => (
          <li key={file.name}>
            <button type="button"
              aria-label={tWorkbench('inspector.openFile', { name: file.name })}
              className={styles.fileRow}
              onClick={() => onFallbackFileClick?.(file)}
            >
              <DesignFileIcon className={styles.fileIcon} name={file.name} type={file.type} />
              <span className={styles.fileName}>{file.name}</span>
              <span className={styles.fileMeta}>{tWorkbench('inspector.previewLabel')}</span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  if (files.length === 0) {
    return (
      <div className={styles.browserPreviewCard}>
        <DesignNavIcon className={styles.browserPreviewIcon} name="fileText" size={24} />
        <strong>{tWorkbench('inspector.emptyFiles')}</strong>
        <span>{tWorkbench('inspector.waitingFiles')}</span>
      </div>
    );
  }

  return (
    <ul aria-label={t('aria.changedFiles')} className={styles.fileList}>
      {files.map((file) => {
        const canOpen = canOpenEvidence(file, onOpenPreview, canOpenPreview);
        return (
          <li key={file.id}>
            <button type="button"
              aria-label={tWorkbench('inspector.openFile', { name: file.label })}
              className={styles.fileRow}
              disabled={!canOpen}
              onClick={() => {
                if (!canOpen) return;
                void onOpenPreview?.(file).catch((err) => {
                  console.error('RightInspector: onOpenPreview file failed:', err);
                });
              }}
            >
              <DesignFileIcon className={styles.fileIcon} name={file.label} />
              <span className={styles.fileName}>{file.label}</span>
              <span className={styles.fileMeta}>{canOpen ? tWorkbench('inspector.open') : tWorkbench('inspector.pendingIntegration')}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
