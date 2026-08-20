import React from 'react';
import type { EvidenceRef, ContextUsageTranscriptBlock } from '../../transcript';
import type { RuntimeEvidenceSnapshot } from '../../inspector';
import type { PreviewPort } from '../../platform';
import type { FileDiff } from '../../types/chat';
import { AgentStreamingBar } from '../../ui/AgentStreamingBar';
import type { DagNode } from '../../ui/DagTree';
import styles from '../AgentHubWorkbench.module.css';
import { BrowserPreview } from './BrowserPreview';
import { FilePreviewRouter, type PreviewFile } from './FilePreviewRouter';
import {
  BrowserPanelFallback,
  DeployStatusBar,
  FilesPanel,
  OverviewContextUsage,
} from './InspectorModePanels';
import { OverviewPanel, type FileItem, type RunResultInfo, type TaskItem } from './OverviewPanel';
import {
  RuntimeEvidencePanel,
  runtimeEvidenceOverviewKicker,
} from './RuntimeEvidencePanel';

/* ═══════════════════════════════════════════════════════════════════════
   InspectorModeBodies — overview / browser / files mode panel bodies
   for RightInspector.

   Extracted from RightInspector as Phase 19 residual thin #584.
   CSS remains on shared AgentHubWorkbench.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

export interface OverviewModeBodyProps {
  contextBlocks?: ContextUsageTranscriptBlock[] | undefined;
  dagNodes: DagNode[];
  overviewFiles: PreviewFile[];
  overviewTasks: TaskItem[];
  runResult?: RunResultInfo | undefined;
  runtimeEvidence?: RuntimeEvidenceSnapshot | undefined;
  onFileClick: (file: FileItem) => void;
}

export function OverviewModeBody({
  contextBlocks,
  dagNodes,
  overviewFiles,
  overviewTasks,
  runResult,
  runtimeEvidence,
  onFileClick,
}: OverviewModeBodyProps): React.ReactElement {
  return (
    <div className={styles.overviewContent}>
      <AgentStreamingBar />
      {contextBlocks && contextBlocks.length > 0 && (
        <OverviewContextUsage blocks={contextBlocks} />
      )}
      <OverviewPanel
        tasks={overviewTasks}
        files={overviewFiles}
        runResult={runResult}
        taskSectionTitle={runtimeEvidence ? '运行证据' : '概览'}
        {...(runtimeEvidence ? { kicker: runtimeEvidenceOverviewKicker(runtimeEvidence) } : {})}
        primaryFileLabel={runtimeEvidence ? 'Hub replay 产物' : '文件'}
        {...(runtimeEvidence ? { workingFileLabel: '运行快照' } : {})}
        dagNodes={dagNodes}
        onFileClick={onFileClick}
      />
    </div>
  );
}

export interface BrowserModeBodyProps {
  artifacts: EvidenceRef[];
  browserPreviewEnabled: boolean;
  browserPreviewUrl: string;
  canOpenPreview?: ((evidence: EvidenceRef) => boolean) | undefined;
  deployPreviewUrl?: string | undefined;
  deployStatus?: 'pending' | 'building' | 'deploying' | 'deployed' | 'failed' | undefined;
  onClose: () => void;
  onOpenPreview?: ((evidence: EvidenceRef) => Promise<void>) | undefined;
  onOpenUrl: (url: string) => void;
}

export function BrowserModeBody({
  artifacts,
  browserPreviewEnabled,
  browserPreviewUrl,
  canOpenPreview,
  deployPreviewUrl,
  deployStatus,
  onClose,
  onOpenPreview,
  onOpenUrl,
}: BrowserModeBodyProps): React.ReactElement {
  if (!browserPreviewEnabled) {
    return (
      <BrowserPanelFallback
        artifacts={artifacts}
        canOpenPreview={canOpenPreview}
        onOpenPreview={onOpenPreview}
        onOpenUrl={onOpenUrl}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {deployStatus && (
        <DeployStatusBar status={deployStatus} url={deployPreviewUrl} />
      )}
      <BrowserPreview
        url={browserPreviewUrl}
        onClose={onClose}
      />
    </div>
  );
}

export interface FilesModeBodyProps {
  canOpenPreview?: ((evidence: EvidenceRef) => boolean) | undefined;
  files: EvidenceRef[];
  overviewFiles: PreviewFile[];
  previewFile: PreviewFile | null;
  /** Platform preview port forwarded to FilePreviewRouter (#1817). */
  previewPort?: PreviewPort | undefined;
  runtimeEvidence?: RuntimeEvidenceSnapshot | undefined;
  onClose: () => void;
  onFallbackFileClick: (file: FileItem) => void;
  onOpenDiff: (file: FileDiff) => void;
  onOpenPreview?: ((evidence: EvidenceRef) => Promise<void>) | undefined;
  onOpenPreviewUrl: (url: string) => void;
}

export function FilesModeBody({
  canOpenPreview,
  files,
  overviewFiles,
  previewFile,
  previewPort,
  runtimeEvidence,
  onClose,
  onFallbackFileClick,
  onOpenDiff,
  onOpenPreview,
  onOpenPreviewUrl,
}: FilesModeBodyProps): React.ReactElement {
  if (previewFile) {
    return (
      <FilePreviewRouter
        file={previewFile}
        onClose={onClose}
        previewPort={previewPort}
      />
    );
  }

  if (runtimeEvidence) {
    return (
      <RuntimeEvidencePanel
        runtimeEvidence={runtimeEvidence}
        onOpenDiff={onOpenDiff}
        onOpenPreviewUrl={onOpenPreviewUrl}
      />
    );
  }

  return (
    <FilesPanel
      canOpenPreview={canOpenPreview}
      fallbackFiles={overviewFiles}
      files={files}
      onFallbackFileClick={onFallbackFileClick}
      onOpenPreview={onOpenPreview}
    />
  );
}
