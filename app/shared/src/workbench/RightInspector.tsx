import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '../i18n';
import { buildInspectorEvidenceModel } from '../inspector';
import type { RuntimeEvidenceSnapshot } from '../inspector';
import type { EvidenceRef, ContextUsageTranscriptBlock, RouteDecisionTranscriptBlock, SubagentTranscriptBlock, SubtaskTranscriptBlock, ChildAgentTranscriptBlock } from '../transcript';
import type { FileDiff } from '../types/chat';
import {
  type TaskItem,
  type FileItem,
  type RunResultInfo,
  type PreviewFile,
  BrowserModeBody,
  FilesModeBody,
  InspectorMonitorHead,
  OverviewModeBody,
  defaultVisibleTabs,
  evidenceOverviewFiles,
  evidenceOverviewTasks,
  getInspectorTabs,
  runtimeDiffPreviewFile,
  runtimeEvidenceOverviewFiles,
  runtimeEvidenceOverviewTasks,
  type InspectorMode,
} from './inspector';
import type { DagNode } from '../ui/DagTree';
import { buildDagNodesFromTranscript } from '../ui/DagTree';
import styles from './AgentHubWorkbench.module.css';

export type { RuntimeEvidenceSnapshot } from '../inspector';

/* ═══ Component ═══ */

export interface RightInspectorProps {
  defaultBrowserUrl: string;
  evidence: EvidenceRef[];
  browserPreviewEnabled: boolean;
  canOpenPreview?: ((evidence: EvidenceRef) => boolean) | undefined;
  collapsed: boolean;
  maxWidth: number;
  minWidth: number;
  onOpenPreview?: ((evidence: EvidenceRef) => Promise<void>) | undefined;
  reviewFileRequest?: FileItem | null | undefined;
  runtimeEvidence?: RuntimeEvidenceSnapshot | undefined;
  /** Workspace directory for the active run — required for diff apply write-back. */
  workDir?: string | undefined;
  /** Context usage blocks from the transcript, used for the compact context bar in Overview. */
  contextBlocks?: ContextUsageTranscriptBlock[] | undefined;
  /** Route decision / sub-agent blocks for DagTree visualization. */
  routeBlocks?: Array<RouteDecisionTranscriptBlock | SubagentTranscriptBlock | SubtaskTranscriptBlock | ChildAgentTranscriptBlock> | undefined;
  /** Deploy preview URL to auto-load in the browser tab. When set, switches to browser. */
  deployPreviewUrl?: string | undefined;
  /** Deploy status indicator for the browser tab. */
  deployStatus?: 'pending' | 'building' | 'deploying' | 'deployed' | 'failed' | undefined;
  /** Run result from the transcript, displayed as a banner in the overview tab. */
  runResult?: RunResultInfo | undefined;
  onResizeBy: (delta: number) => void;
  onResizeStart: (clientX: number) => void;
  width: number;
}

export function RightInspector({
  defaultBrowserUrl,
  evidence,
  browserPreviewEnabled,
  canOpenPreview,
  collapsed,
  maxWidth,
  minWidth,
  onOpenPreview,
  reviewFileRequest,
  runtimeEvidence,
  workDir,
  contextBlocks,
  routeBlocks,
  deployPreviewUrl,
  deployStatus,
  runResult,
  onResizeBy,
  onResizeStart,
  width,
}: RightInspectorProps): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const inspectorTabs = getInspectorTabs(t);
  const [activeMode, setActiveMode] = useState<InspectorMode>('overview');
  const [visibleTabs, setVisibleTabs] = useState<Set<InspectorMode>>(() => new Set(defaultVisibleTabs));
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);

  const model = buildInspectorEvidenceModel(evidence);

  // ── DagTree nodes from route decision blocks ──
  const dagNodes = useMemo<DagNode[]>(() => {
    if (!routeBlocks || routeBlocks.length === 0) return [];
    return buildDagNodesFromTranscript(routeBlocks);
  }, [routeBlocks]);

  // ── Deploy auto-switch: when a deploy preview URL appears, switch to browser tab ──
  const lastAutoSwitchedUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!deployPreviewUrl || !browserPreviewEnabled) return;
    // Only auto-switch on NEW deploy URLs (not on re-renders of the same URL)
    if (lastAutoSwitchedUrl.current === deployPreviewUrl) return;
    lastAutoSwitchedUrl.current = deployPreviewUrl;

    setVisibleTabs((current) => {
      const next = new Set(current);
      next.add('browser');
      return next;
    });
    setBrowserUrl(deployPreviewUrl);
    setActiveMode('browser');
  }, [deployPreviewUrl, browserPreviewEnabled]);

  useEffect(() => {
    if (!reviewFileRequest) return;
    setVisibleTabs((current) => {
      const next = new Set(current);
      next.add('files');
      return next;
    });
    setPreviewFile(reviewFileRequest);
    setActiveMode('files');
  }, [reviewFileRequest]);

  const overviewTasks = useMemo<TaskItem[]>(() => {
    if (runtimeEvidence) return runtimeEvidenceOverviewTasks(runtimeEvidence);
    return evidenceOverviewTasks(evidence);
  }, [evidence, runtimeEvidence]);

  const overviewFiles = useMemo<PreviewFile[]>(() => {
    const files = runtimeEvidence
      ? runtimeEvidenceOverviewFiles(runtimeEvidence)
      : evidenceOverviewFiles(evidence);
    return files.map((file) => ({
      ...file,
      isOpen: previewFile?.name === file.name,
    }));
  }, [evidence, previewFile?.name, runtimeEvidence]);

  const handleFileClick = useCallback((file: FileItem) => {
    // Look up the full PreviewFile (with content/URL data) from overviewFiles,
    // since FileItem from the OverviewPanel only has name/type/isPrimary/isOpen.
    const richFile = overviewFiles.find((f) => f.name === file.name);
    setPreviewFile(richFile ?? file);
    setActiveMode('files');
  }, [overviewFiles]);

  const closePreview = useCallback(() => {
    setPreviewFile(null);
    setBrowserUrl(null);
    setActiveMode('overview');
  }, []);

  const runtimePreviewUrl = runtimeEvidence?.previews.find((preview) => (
    preview.status === 'ready' && Boolean(preview.url)
  ))?.url;
  const browserPreviewUrl = browserUrl ?? runtimePreviewUrl ?? defaultBrowserUrl;

  const closeInspectorTab = useCallback((mode: InspectorMode) => {
    setVisibleTabs((current) => {
      const next = new Set(current);
      next.delete(mode);
      return next;
    });
    setPreviewFile((current) => (mode === 'files' ? null : current));
    setBrowserUrl((current) => (mode === 'browser' ? null : current));
    setActiveMode((current) => {
      if (current !== mode) return current;
      const fallback = inspectorTabs.find((tab) => tab.mode !== mode && visibleTabs.has(tab.mode));
      return fallback?.mode ?? 'overview';
    });
  }, [visibleTabs]);

  const restoreInspectorTab = useCallback((mode: InspectorMode) => {
    setVisibleTabs((current) => {
      const next = new Set(current);
      next.add(mode);
      return next;
    });
    setActiveMode(mode);
    setQuickOpenVisible(false);
  }, []);

  const openNewInspectorWindow = useCallback(() => {
    setQuickOpenVisible((value) => !value);
  }, []);

  const handleOpenDiff = useCallback((file: FileDiff) => {
    setPreviewFile(runtimeDiffPreviewFile(file, runtimeEvidence?.runId, workDir));
    setActiveMode('files');
  }, [runtimeEvidence?.runId, workDir]);

  const handleOpenPreviewUrl = useCallback((url: string) => {
    setVisibleTabs((current) => {
      const next = new Set(current);
      next.add('browser');
      return next;
    });
    setBrowserUrl(url);
    setActiveMode('browser');
  }, []);

  return (
    <aside
      aria-hidden={collapsed}
      aria-label="Right inspector"
      className={styles.inspector}
      data-preview={activeMode === 'overview' ? 'false' : 'true'}
    >
      <div
        aria-label="调整右侧栏宽度"
        aria-orientation="vertical"
        aria-valuemax={maxWidth}
        aria-valuemin={minWidth}
        aria-valuenow={width}
        className={styles.inspectorResizer}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const step = event.shiftKey ? 40 : 16;
          onResizeBy(event.key === 'ArrowLeft' ? step : -step);
        }}
        onPointerDown={(event) => {
          if (collapsed) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          onResizeStart(event.clientX);
        }}
        role="separator"
        tabIndex={collapsed ? -1 : 0}
      />

      <InspectorMonitorHead
        activeMode={activeMode}
        browserPreviewEnabled={browserPreviewEnabled}
        quickOpenVisible={quickOpenVisible}
        visibleTabs={visibleTabs}
        onCloseTab={closeInspectorTab}
        onRestoreTab={restoreInspectorTab}
        onSelectMode={setActiveMode}
        onToggleQuickOpen={openNewInspectorWindow}
        t={t}
      />

      <div className={styles.inspectorPanel} role="tabpanel">
        {visibleTabs.size === 0 && (
          <p className={styles.inspectorEmpty}>右侧窗口已关闭。使用 + 重新打开概览、浏览器或文件。</p>
        )}

        {activeMode === 'overview' && visibleTabs.has('overview') && (
          <OverviewModeBody
            contextBlocks={contextBlocks}
            dagNodes={dagNodes}
            overviewFiles={overviewFiles}
            overviewTasks={overviewTasks}
            runResult={runResult}
            runtimeEvidence={runtimeEvidence}
            onFileClick={handleFileClick}
          />
        )}

        {activeMode === 'browser' && visibleTabs.has('browser') && (
          <BrowserModeBody
            artifacts={model.artifacts}
            browserPreviewEnabled={browserPreviewEnabled}
            browserPreviewUrl={browserPreviewUrl}
            canOpenPreview={canOpenPreview}
            deployPreviewUrl={deployPreviewUrl}
            deployStatus={deployStatus}
            onClose={closePreview}
            onOpenPreview={onOpenPreview}
            onOpenUrl={setBrowserUrl}
          />
        )}

        {activeMode === 'files' && visibleTabs.has('files') && (
          <FilesModeBody
            canOpenPreview={canOpenPreview}
            files={model.files}
            overviewFiles={overviewFiles}
            previewFile={previewFile}
            runtimeEvidence={runtimeEvidence}
            onClose={closePreview}
            onFallbackFileClick={handleFileClick}
            onOpenDiff={handleOpenDiff}
            onOpenPreview={onOpenPreview}
            onOpenPreviewUrl={handleOpenPreviewUrl}
          />
        )}
      </div>
    </aside>
  );
}
