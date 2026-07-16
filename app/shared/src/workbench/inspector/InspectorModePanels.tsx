import React from 'react';
import type { EvidenceRef, ContextUsageTranscriptBlock } from '../../transcript';
import { formatTokens } from '../../context/breakdown';
import {
  DesignFileIcon,
  DesignNavIcon,
} from '../designIcons';
import styles from '../AgentHubWorkbench.module.css';
import type { FileItem, TaskItem } from './OverviewPanel';
import type { PreviewFile } from './FilePreviewRouter';

/* ═══════════════════════════════════════════════════════════════════════
   InspectorModePanels — evidence overview mappers + mode-specific sub-panels
   for RightInspector (context usage, deploy status, browser fallback, files).

   Extracted from RightInspector as Phase 16 strangler slice #550.
   CSS remains on shared AgentHubWorkbench.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

export function evidenceOverviewTasks(evidence: EvidenceRef[]): TaskItem[] {
  const tasks: TaskItem[] = [];
  const artifactCount = evidence.filter((ref) => ref.kind === 'artifact').length;
  const fileCount = evidence.filter((ref) => ref.kind === 'file').length;
  const toolCount = evidence.filter((ref) => ref.kind === 'tool').length;
  const runRef = evidence.find((ref) => ref.kind === 'run');

  if (runRef) {
    tasks.push({ label: runRef.label || `运行 ${runRef.id}`, status: runRef.status === 'completed' ? 'done' : 'active' });
  }
  if (artifactCount > 0) {
    tasks.push({ label: `产物索引: ${artifactCount}`, status: 'done' });
  }
  if (fileCount > 0) {
    tasks.push({ label: `变更文件: ${fileCount}`, status: 'done' });
  }
  if (toolCount > 0) {
    tasks.push({ label: `工具调用: ${toolCount}`, status: 'done' });
  }
  return tasks.length > 0
    ? tasks
    : [{ label: '等待 transcript evidence', status: 'todo' }];
}

export function evidenceOverviewFiles(evidence: EvidenceRef[]): PreviewFile[] {
  const files: PreviewFile[] = [];

  for (const ref of evidence) {
    if (ref.kind === 'file') {
      files.push({
        name: ref.label || ref.id,
        type: fileTypeFromName(ref.label || ref.id),
        isPrimary: true,
        owner: 'transcript',
        content: `# ${ref.label || ref.id}\n\n${ref.uri || '暂无文件内容。'}`,
      });
    } else if (ref.kind === 'artifact') {
      files.push({
        name: ref.label || ref.id,
        type: fileTypeFromName(ref.label || ref.id),
        isPrimary: false,
        owner: 'transcript',
        content: `# ${ref.label || ref.id}\n\n产物来自 transcript evidence。`,
      });
    }
  }

  return files;
}

export function fileTypeFromName(name: string): string {
  if (name.endsWith('.md')) return 'md';
  if (name.endsWith('.ts') || name.endsWith('.tsx')) return 'ts';
  if (name.endsWith('.sql')) return 'sql';
  if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.gif')) return 'image';
  if (name.endsWith('.html') || name.endsWith('.htm')) return 'html';
  return 'txt';
}

/* ═══ Sub-panels ═══ */

export function OverviewContextUsage({
  blocks,
}: {
  blocks: ContextUsageTranscriptBlock[];
}): React.ReactElement {
  // Use the latest block (most recent context usage snapshot).
  const latest = blocks[blocks.length - 1];
  if (!latest || (!latest.inputTokens && !latest.outputTokens)) {
    return <></>;
  }

  const totalTokens = latest.inputTokens + latest.outputTokens;
  const usagePercent = latest.usagePercent ?? (
    latest.contextLimit && latest.contextLimit > 0
      ? Math.round((totalTokens / latest.contextLimit) * 100)
      : null
  );

  const isWarning = usagePercent != null && usagePercent >= 70 && usagePercent < 90;
  const isDanger = usagePercent != null && usagePercent >= 90;

  const barVariant = isDanger
    ? styles.contextBarDanger
    : isWarning
      ? styles.contextBarWarning
      : '';

  return (
    <div className={styles.contextSection} role="status" aria-label="Context usage">
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
            style={{ width: `${Math.min(usagePercent, 100)}%` }}
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

/* ═══ Deploy Status Indicator ═══ */

export function DeployStatusBar({
  status,
  url,
}: {
  status: 'pending' | 'building' | 'deploying' | 'deployed' | 'failed';
  url?: string | undefined;
}): React.ReactElement {
  const isReady = status === 'deployed';
  const isFailed = status === 'failed';
  const isDeploying = status === 'building' || status === 'deploying';

  const statusLabel = DEPLOY_STATUS_LABEL[status] ?? status;
  const dotColor = isReady ? 'var(--success)' : isFailed ? 'var(--danger)' : 'var(--primary)';

  return (
    <div
      className={styles.deployStatusBar}
      data-deploy-status={status}
      role="status"
      aria-label={`部署状态: ${statusLabel}`}
    >
      <span
        className={styles.deployStatusDot}
        style={{ background: dotColor }}
        aria-hidden="true"
      />
      <span className={styles.deployStatusLabel}>{statusLabel}</span>
      {isDeploying && <span className={styles.deploySpinner} aria-hidden="true" />}
      {url && isReady && (
        <span className={styles.deployUrl} title={url}>{url.replace(/^https?:\/\//, '')}</span>
      )}
    </div>
  );
}

const DEPLOY_STATUS_LABEL: Record<string, string> = {
  pending: '待部署',
  building: '构建中',
  deploying: '部署中',
  deployed: '已就绪',
  failed: '部署失败',
};

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
  if (artifacts.length > 0) {
    return (
      <div className={styles.browserPreviewCard}>
        <DesignNavIcon className={styles.browserPreviewIcon} name="browser" size={24} />
        <strong>浏览器预览已启用</strong>
        <span>{`检测到 ${artifacts.length} 个可预览产物。`}</span>
        <ul aria-label="Preview artifacts" className={styles.browserArtifactList}>
          {artifacts.map((artifact) => {
            const canOpen = canOpenEvidence(artifact, onOpenPreview, canOpenPreview);
            return (
              <li key={artifact.id}>
                <button
                  aria-label={`打开产物 ${artifact.label}`}
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
                  type="button"
                >
                  <DesignFileIcon
                    className={styles.fileIcon}
                    name={artifact.label}
                    type={artifact.uri ? 'link' : undefined}
                  />
                  <span className={styles.fileName}>{artifact.label}</span>
                  <span className={styles.fileMeta}>{canOpen ? '打开' : '待接入'}</span>
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
      <strong>浏览器预览已启用</strong>
      <span>等待 run 产出可预览地址或 artifact。</span>
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
  if (files.length === 0 && fallbackFiles && fallbackFiles.length > 0) {
    return (
      <ul aria-label="Changed files" className={styles.fileList}>
        {fallbackFiles.map((file) => (
          <li key={file.name}>
            <button
              aria-label={`打开文件 ${file.name}`}
              className={styles.fileRow}
              onClick={() => onFallbackFileClick?.(file)}
              type="button"
            >
              <DesignFileIcon className={styles.fileIcon} name={file.name} type={file.type} />
              <span className={styles.fileName}>{file.name}</span>
              <span className={styles.fileMeta}>预览</span>
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
        <strong>暂无变更文件</strong>
        <span>等待 run 产出文件、diff 或 artifact evidence。</span>
      </div>
    );
  }

  return (
    <ul aria-label="Changed files" className={styles.fileList}>
      {files.map((file) => {
        const canOpen = canOpenEvidence(file, onOpenPreview, canOpenPreview);
        return (
          <li key={file.id}>
            <button
              aria-label={`打开文件 ${file.label}`}
              className={styles.fileRow}
              disabled={!canOpen}
              onClick={() => {
                if (!canOpen) return;
                void onOpenPreview?.(file).catch((err) => {
                  console.error('RightInspector: onOpenPreview file failed:', err);
                });
              }}
              type="button"
            >
              <DesignFileIcon className={styles.fileIcon} name={file.label} />
              <span className={styles.fileName}>{file.label}</span>
              <span className={styles.fileMeta}>{canOpen ? '打开' : '待接入'}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ═══ Helpers ═══ */

export function canOpenEvidence(
  evidence: EvidenceRef,
  onOpenPreview: ((evidence: EvidenceRef) => Promise<void>) | undefined,
  canOpenPreview: ((evidence: EvidenceRef) => boolean) | undefined,
): boolean {
  return Boolean(onOpenPreview) && (canOpenPreview?.(evidence) ?? true);
}
