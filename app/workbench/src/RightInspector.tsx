import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import { buildInspectorEvidenceModel } from '@shared/inspector';
import type { FileDiff } from '@shared/types/chat';
import {
  type FileItem,
  type PreviewFile,
  InspectorMonitorHead,
  defaultVisibleTabs,
  getInspectorTabs,
  type InspectorMode,
} from './inspector';
import { WORKBENCH_INSPECTOR_QUICK_OPEN_EVENT } from './desktopChromeEvents';
import styles from './AgentHubWorkbench.module.css';
import { RightInspectorModePanel } from './RightInspectorModePanel';
import { RightInspectorResizer } from './RightInspectorResizer';
import {
  createInspectorResizerKeyDownHandler,
  createInspectorResizerPointerDownHandler,
  inspectorDataPreviewAttr,
  planOpenDiffPreview,
  resolveBrowserPreviewUrl,
  resolveDagNodesFromRouteBlocks,
  resolveFallbackInspectorMode,
  resolveFileClickTarget,
  resolveOverviewFiles,
  resolveOverviewTasks,
  shouldAutoSwitchDeployPreview,
  withInspectorTab,
  withoutInspectorTab,
} from './rightInspectorHelpers';
import type { RightInspectorProps } from './rightInspectorTypes';

export type { RuntimeEvidenceSnapshot } from '@shared/inspector';
export type { RightInspectorProps } from './rightInspectorTypes';

/* ═══ Component ═══ */

export function RightInspector({
  defaultBrowserUrl,
  evidence,
  browserPreviewEnabled,
  canOpenPreview,
  collapsed,
  maxWidth,
  minWidth,
  onOpenPreview,
  previewPort,
  reviewFileRequest,
  runtimeEvidence,
  workDir,
  contextBlocks,
  routeBlocks,
  deployPreviewUrl,
  browserFocusRequest,
  deployStatus,
  runResult,
  onResizeBy,
  onResizeStart,
  width,
}: RightInspectorProps): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const { t: tChatview } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const inspectorTabs = getInspectorTabs(t);
  const [activeMode, setActiveMode] = useState<InspectorMode>('overview');
  const [visibleTabs, setVisibleTabs] = useState<Set<InspectorMode>>(() => new Set(defaultVisibleTabs));
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);
  const [browserFocusPending, setBrowserFocusPending] = useState(false);

  // #1822: Ctrl+P quick-open from the workbench keyboard dispatcher. The
  // event targets the inspector because tab visibility is owned here; the
  // dispatcher expands the inspector first (openInspector), so the detail
  // only needs the mode.
  useEffect(() => {
    function handleQuickOpen(event: Event): void {
      const mode = (event as CustomEvent<{ mode?: string }>).detail?.mode;
      if (mode !== 'files' && mode !== 'browser') return;
      setQuickOpenVisible(false);
      setVisibleTabs((current) => withInspectorTab(current, mode));
      setActiveMode(mode);
    }
    window.addEventListener(WORKBENCH_INSPECTOR_QUICK_OPEN_EVENT, handleQuickOpen);
    return () => window.removeEventListener(WORKBENCH_INSPECTOR_QUICK_OPEN_EVENT, handleQuickOpen);
  }, []);

  const model = buildInspectorEvidenceModel(evidence);
  const dagNodes = useMemo(() => resolveDagNodesFromRouteBlocks(routeBlocks), [routeBlocks]);
  const lastAutoSwitchedUrl = useRef<string | null>(null);
  const lastBrowserFocusSequence = useRef(0);
  const inspectorRef = useRef<HTMLElement | null>(null);
  const tablistRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!shouldAutoSwitchDeployPreview(
      deployPreviewUrl,
      browserPreviewEnabled,
      lastAutoSwitchedUrl.current,
    )) {
      return;
    }
    // Only auto-switch on NEW real deploy URLs (not about:blank demo placeholders).
    lastAutoSwitchedUrl.current = deployPreviewUrl!;
    setVisibleTabs((current) => withInspectorTab(current, 'browser'));
    setBrowserUrl(deployPreviewUrl!);
    setActiveMode('browser');
  }, [deployPreviewUrl, browserPreviewEnabled]);

  useEffect(() => {
    if (
      !browserFocusRequest
      || browserFocusRequest.sequence <= lastBrowserFocusSequence.current
    ) {
      return;
    }
    // Consume every explicit request exactly once. Unsupported surfaces must
    // not replay an old request if capabilities change later.
    lastBrowserFocusSequence.current = browserFocusRequest.sequence;
    if (!browserPreviewEnabled) return;
    setVisibleTabs((current) => withInspectorTab(current, 'browser'));
    setBrowserUrl(browserFocusRequest.url);
    setActiveMode('browser');
    setBrowserFocusPending(true);
  }, [browserFocusRequest, browserPreviewEnabled]);

  useEffect(() => {
    if (!browserFocusPending || activeMode !== 'browser') return;
    const focusTarget = inspectorRef.current?.querySelector<HTMLElement>(
      '[data-browser-preview-focus-target]',
    );
    if (!focusTarget) return;
    focusTarget.focus({ preventScroll: true });
    setBrowserFocusPending(false);
  }, [activeMode, browserFocusPending, browserUrl]);

  useEffect(() => {
    if (!reviewFileRequest) return;
    setVisibleTabs((current) => withInspectorTab(current, 'files'));
    setPreviewFile(reviewFileRequest);
    setActiveMode('files');
  }, [reviewFileRequest]);

  const overviewTasks = useMemo(
    () => resolveOverviewTasks(evidence, runtimeEvidence),
    [evidence, runtimeEvidence],
  );

  const overviewFiles = useMemo(
    () => resolveOverviewFiles(evidence, runtimeEvidence, previewFile?.name),
    [evidence, previewFile?.name, runtimeEvidence],
  );

  const handleFileClick = useCallback((file: FileItem) => {
    setPreviewFile(resolveFileClickTarget(overviewFiles, file));
    /* P76: files tab is on-demand — restore it when opening a file from overview. */
    setVisibleTabs((current) => withInspectorTab(current, 'files'));
    setActiveMode('files');
  }, [overviewFiles]);

  const closePreview = useCallback(() => {
    setPreviewFile(null);
    setBrowserUrl(null);
    setActiveMode('overview');
    // #1922 item 3: return focus to the overview tab after closing the
    // preview so keyboard users are not stranded when the close button
    // unmounts. Tab selection via arrow keys already keeps focus on the tab
    // (roving-tabindex), so this only handles the explicit close path.
    tablistRef.current
      ?.querySelector<HTMLButtonElement>('[data-inspector-tab="overview"]')
      ?.focus();
  }, []);

  const browserPreviewUrl = resolveBrowserPreviewUrl(browserUrl, runtimeEvidence, defaultBrowserUrl);

  const closeInspectorTab = useCallback((mode: InspectorMode) => {
    setVisibleTabs((current) => withoutInspectorTab(current, mode));
    setPreviewFile((current) => (mode === 'files' ? null : current));
    setBrowserUrl((current) => (mode === 'browser' ? null : current));
    setActiveMode((current) => resolveFallbackInspectorMode(current, mode, inspectorTabs, visibleTabs));
  }, [inspectorTabs, visibleTabs]);

  const restoreInspectorTab = useCallback((mode: InspectorMode) => {
    setVisibleTabs((current) => withInspectorTab(current, mode));
    setActiveMode(mode);
    setQuickOpenVisible(false);
  }, []);

  const openNewInspectorWindow = useCallback(() => {
    setQuickOpenVisible((value) => !value);
  }, []);

  const handleOpenDiff = useCallback((file: FileDiff) => {
    setPreviewFile(planOpenDiffPreview(file, runtimeEvidence?.runId, workDir));
    setVisibleTabs((current) => withInspectorTab(current, 'files'));
    setActiveMode('files');
  }, [runtimeEvidence?.runId, workDir]);

  const handleOpenPreviewUrl = useCallback((url: string) => {
    setVisibleTabs((current) => withInspectorTab(current, 'browser'));
    setBrowserUrl(url);
    setActiveMode('browser');
    if (browserPreviewEnabled) setBrowserFocusPending(true);
  }, [browserPreviewEnabled]);

  const onResizerKeyDown = useMemo(
    () => createInspectorResizerKeyDownHandler(onResizeBy),
    [onResizeBy],
  );
  const onResizerPointerDown = useMemo(
    () => createInspectorResizerPointerDownHandler(collapsed, onResizeStart),
    [collapsed, onResizeStart],
  );

  return (
    <aside
      ref={inspectorRef}
      aria-hidden={collapsed}
      aria-label={tChatview('aria.rightInspector')}
      className={styles.inspector}
      data-preview={inspectorDataPreviewAttr(activeMode)}
      /* #1823: `aria-hidden` must never wrap focusable content. `inert`
         removes the collapsed inspector's tabs / resizer / preview controls
         from the focus order (CSS adds the visibility gate). */
      inert={collapsed}
    >
      <RightInspectorResizer
        collapsed={collapsed}
        maxWidth={maxWidth}
        minWidth={minWidth}
        width={width}
        onKeyDown={onResizerKeyDown}
        onPointerDown={onResizerPointerDown}
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
        tablistRef={tablistRef}
      />

      <RightInspectorModePanel
        activeMode={activeMode}
        artifacts={model.artifacts}
        browserPreviewEnabled={browserPreviewEnabled}
        browserPreviewUrl={browserPreviewUrl}
        canOpenPreview={canOpenPreview}
        contextBlocks={contextBlocks}
        dagNodes={dagNodes}
        deployPreviewUrl={deployPreviewUrl}
        deployStatus={deployStatus}
        files={model.files}
        overviewFiles={overviewFiles}
        overviewTasks={overviewTasks}
        previewFile={previewFile}
        previewPort={previewPort}
        runResult={runResult}
        runtimeEvidence={runtimeEvidence}
        visibleTabs={visibleTabs}
        onClosePreview={closePreview}
        onFileClick={handleFileClick}
        onOpenDiff={handleOpenDiff}
        onOpenPreview={onOpenPreview}
        onOpenPreviewUrl={handleOpenPreviewUrl}
        onOpenUrl={setBrowserUrl}
      />
    </aside>
  );
}
