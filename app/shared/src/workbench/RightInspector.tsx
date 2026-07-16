import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '../i18n';
import { buildInspectorEvidenceModel } from '../inspector';
import type { RuntimeEvidenceSnapshot } from '../inspector';
import type { EvidenceRef, ContextUsageTranscriptBlock, RouteDecisionTranscriptBlock, SubagentTranscriptBlock, SubtaskTranscriptBlock, ChildAgentTranscriptBlock } from '../transcript';
import {
  OverviewPanel,
  type TaskItem,
  type FileItem,
  type RunResultInfo,
  type PreviewFile,
  BrowserPreview,
  BrowserPanelFallback,
  DeployStatusBar,
  FilesPanel,
  FilePreviewRouter,
  OverviewContextUsage,
  RuntimeEvidencePanel,
  evidenceOverviewFiles,
  evidenceOverviewTasks,
  runtimeDiffPreviewFile,
  runtimeEvidenceOverviewFiles,
  runtimeEvidenceOverviewKicker,
  runtimeEvidenceOverviewTasks,
} from './inspector';
import { AgentStreamingBar } from '../ui/AgentStreamingBar';
import type { DagNode } from '../ui/DagTree';
import { buildDagNodesFromTranscript } from '../ui/DagTree';
import {
  DESIGN_NAV_GLYPH_SIZE,
  DESIGN_NAV_GLYPH_STROKE_WIDTH,
  DesignNavIcon,
  type DesignNavIconName,
} from './designIcons';
import styles from './AgentHubWorkbench.module.css';

type InspectorMode = 'overview' | 'browser' | 'files';
export type { RuntimeEvidenceSnapshot } from '../inspector';

function TabMark({
  char,
  children,
  mode,
  onClose,
  t,
}: {
  char: string;
  children: React.ReactElement;
  mode: InspectorMode;
  onClose: (mode: InspectorMode) => void;
  t: (key: string) => string;
}) {
  return (
    <span
      aria-label={t('inspector.closeTab').replace('{{label}}', inspectorTabLabel(mode, t))}
      className={styles.inspectorTabMark}
      data-inspector-close
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose(mode);
      }}
      role="button"
      tabIndex={-1}
      title={t('inspector.closeTab').replace('{{label}}', inspectorTabLabel(mode, t))}
    >
      {children}
      <b>{char}</b>
    </span>
  );
}

/* ═══ Inspector tabs config ═══ */

interface InspectorTabDef {
  mode: InspectorMode;
  label: string;
  markChar: string;
  icon: DesignNavIconName;
}

function getInspectorTabs(t: (key: string) => string): InspectorTabDef[] {
  return [
    { mode: 'overview', label: t('inspector.overview'), markChar: '×', icon: 'overview' },
    { mode: 'browser', label: t('inspector.browser'), markChar: '×', icon: 'browser' },
    { mode: 'files', label: t('inspector.files'), markChar: '×', icon: 'fileText' },
  ];
}

const defaultVisibleTabs = new Set<InspectorMode>(['overview', 'browser', 'files']);

function getQuickOpenItems(t: (key: string) => string) {
  return [
    { id: 'files', label: t('inspector.quickOpenFiles'), shortcut: 'Ctrl+P', mode: 'files' as InspectorMode },
    { id: 'chat', label: t('inspector.quickOpenChat'), shortcut: '', mode: null },
    { id: 'browser', label: t('inspector.quickOpenBrowser'), shortcut: 'Ctrl+T', mode: 'browser' as InspectorMode },
    { id: 'terminal', label: t('inspector.quickOpenTerminal'), shortcut: 'Ctrl+`', mode: null },
  ];
}

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
  const quickOpenItems = getQuickOpenItems(t);
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

  const visibleInspectorTabs = useMemo(() => (
    inspectorTabs.filter((tab) => visibleTabs.has(tab.mode))
  ), [visibleTabs]);

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

      <div className={styles.monitorHead}>
        <div aria-label="右侧工作区" className={styles.inspectorTabs} role="tablist">
          {visibleInspectorTabs.map((tab) => {
            const disabled = tab.mode === 'browser' && !browserPreviewEnabled;
            return (
              <button
                aria-selected={activeMode === tab.mode}
                className={styles.inspectorTab}
                data-inspector-tab={tab.mode}
                disabled={disabled}
                key={tab.mode}
                onClick={() => setActiveMode(tab.mode)}
                onKeyDown={(event) => {
                  if (event.key !== 'Delete' && event.key !== 'Backspace') return;
                  event.preventDefault();
                  closeInspectorTab(tab.mode);
                }}
                role="tab"
                type="button"
              >
                <TabMark char={tab.markChar} mode={tab.mode} onClose={closeInspectorTab} t={t}>
                  <DesignNavIcon
                    className={styles.inspectorTabIcon}
                    name={tab.icon}
                    size={DESIGN_NAV_GLYPH_SIZE}
                    strokeWidth={DESIGN_NAV_GLYPH_STROKE_WIDTH}
                  />
                </TabMark>
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className={styles.inspectorWindowActions}>
          <button
            type="button"
            title="新建右侧窗口"
            aria-label="新建右侧窗口"
            aria-expanded={quickOpenVisible}
            aria-haspopup="menu"
            onClick={openNewInspectorWindow}
          >
            <DesignNavIcon name="plus" size={15} />
          </button>
          {quickOpenVisible && (
            <div className={styles.inspectorAddMenu} role="menu" aria-label="右侧窗口菜单">
              {quickOpenItems.map((item) => (
                <button
                  key={item.id}
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    if (item.mode) restoreInspectorTab(item.mode);
                  }}
                >
                  <DesignNavIcon name={item.mode === 'browser' ? 'browser' : item.mode === 'files' ? 'fileText' : 'tools'} size={15} />
                  <span>{item.label}</span>
                  {item.shortcut && <em>{item.shortcut}</em>}
                </button>
              ))}
              {inspectorTabs.some((tab) => !visibleTabs.has(tab.mode)) && (
                <div className={styles.inspectorAddMenuDivider} />
              )}
              {inspectorTabs.filter((tab) => !visibleTabs.has(tab.mode)).map((tab) => (
                <button
                  key={tab.mode}
                  role="menuitem"
                  type="button"
                  onClick={() => restoreInspectorTab(tab.mode)}
                >
                  <DesignNavIcon name={tab.icon} size={15} />
                  <span>{`恢复 ${tab.label}`}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={styles.inspectorPanel} role="tabpanel">
        {visibleTabs.size === 0 && (
          <p className={styles.inspectorEmpty}>右侧窗口已关闭。使用 + 重新打开概览、浏览器或文件。</p>
        )}

        {activeMode === 'overview' && visibleTabs.has('overview') && (
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
              onFileClick={handleFileClick}
            />
          </div>
        )}

        {activeMode === 'browser' && visibleTabs.has('browser') && (
          browserPreviewEnabled ? (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              {deployStatus && (
                <DeployStatusBar status={deployStatus} url={deployPreviewUrl} />
              )}
              <BrowserPreview
                url={browserPreviewUrl}
                onClose={closePreview}
              />
            </div>
          ) : (
            <BrowserPanelFallback
              artifacts={model.artifacts}
              canOpenPreview={canOpenPreview}
              onOpenPreview={onOpenPreview}
              onOpenUrl={setBrowserUrl}
            />
          )
        )}

        {activeMode === 'files' && visibleTabs.has('files') && (
          previewFile ? (
            <FilePreviewRouter
              file={previewFile}
              onClose={closePreview}
            />
          ) : (
            runtimeEvidence ? (
              <RuntimeEvidencePanel
                runtimeEvidence={runtimeEvidence}
                onOpenDiff={(file) => {
                  setPreviewFile(runtimeDiffPreviewFile(file, runtimeEvidence?.runId, workDir));
                  setActiveMode('files');
                }}
                onOpenPreviewUrl={(url) => {
                  setVisibleTabs((current) => {
                    const next = new Set(current);
                    next.add('browser');
                    return next;
                  });
                  setBrowserUrl(url);
                  setActiveMode('browser');
                }}
              />
            ) : (
              <FilesPanel
                canOpenPreview={canOpenPreview}
                fallbackFiles={overviewFiles}
                files={model.files}
                onFallbackFileClick={handleFileClick}
                onOpenPreview={onOpenPreview}
              />
            )
          )
        )}
      </div>
    </aside>
  );
}

function inspectorTabLabel(mode: InspectorMode, t: (key: string) => string): string {
  return getInspectorTabs(t).find((tab) => tab.mode === mode)?.label ?? mode;
}
