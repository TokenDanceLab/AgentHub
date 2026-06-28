import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '../i18n';
import { buildInspectorEvidenceModel, buildRuntimeEvidenceInspectorModel } from '../inspector';
import type { RuntimeEvidenceChannel, RuntimeEvidenceSnapshot } from '../inspector';
import type { EvidenceRef, ContextUsageTranscriptBlock, RouteDecisionTranscriptBlock, SubagentTranscriptBlock, SubtaskTranscriptBlock, ChildAgentTranscriptBlock } from '../transcript';
import type { FileDiff } from '../types/chat';
import {
  OverviewPanel,
  type TaskItem,
  type FileItem,
  type RunResultInfo,
  FilePreview,
  BrowserPreview,
} from './inspector';
import { AgentStreamingBar } from '../ui/AgentStreamingBar';
import { formatTokens } from '../context/breakdown';
import type { DagNode } from '../ui/DagTree';
import { buildDagNodesFromTranscript } from '../ui/DagTree';
import { SlideshowPreview } from '../ui/SlideshowPreview';
import { TablePreview } from '../ui/TablePreview';
import { DocxPreview } from '../ui/DocxPreview';
import { DiffReviewPanel, type DiffHunkDecision, type DiffReviewFile } from '../ui/DiffReviewPanel';
import { applyRunDiff, applyAllRunDiffs } from '../apiClient';
import {
  DESIGN_NAV_GLYPH_SIZE,
  DESIGN_NAV_GLYPH_STROKE_WIDTH,
  DesignFileIcon,
  DesignNavIcon,
  type DesignNavIconName,
} from './designIcons';
import styles from './AgentHubWorkbench.module.css';

type InspectorMode = 'overview' | 'browser' | 'files';
export type { RuntimeEvidenceSnapshot } from '../inspector';

type PreviewFile = FileItem & {
  content?: string | undefined;
  diffContent?: string | undefined;
  owner?: string | undefined;
  /** When present, this is an interactive diff from a run — enables accept/reject with Edge apply. */
  interactiveDiff?: {
    runId: string;
    fileDiff: FileDiff;
    workDir: string;
  } | undefined;
};

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

function evidenceOverviewTasks(evidence: EvidenceRef[]): TaskItem[] {
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

function evidenceOverviewFiles(evidence: EvidenceRef[]): PreviewFile[] {
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

function fileTypeFromName(name: string): string {
  if (name.endsWith('.md')) return 'md';
  if (name.endsWith('.ts') || name.endsWith('.tsx')) return 'ts';
  if (name.endsWith('.sql')) return 'sql';
  if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.gif')) return 'image';
  if (name.endsWith('.html') || name.endsWith('.htm')) return 'html';
  return 'txt';
}

function runtimeEvidenceOverviewTasks(runtimeEvidence: RuntimeEvidenceSnapshot): TaskItem[] {
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

function runtimeEvidenceOverviewFiles(runtimeEvidence: RuntimeEvidenceSnapshot): PreviewFile[] {
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

function runtimeEvidenceOverviewKicker(runtimeEvidence: RuntimeEvidenceSnapshot): string {
  return runtimeEvidence.runId ? `Hub replay / ${runtimeEvidence.runId}` : 'Hub replay';
}

function RuntimeEvidencePanel({
  runtimeEvidence,
  onOpenDiff,
  onOpenPreviewUrl,
}: {
  runtimeEvidence: RuntimeEvidenceSnapshot;
  onOpenDiff: (file: FileDiff) => void;
  onOpenPreviewUrl: (url: string) => void;
}): React.ReactElement {
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

/* ═══ Sub-panels ═══ */

function OverviewContextUsage({
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

function DeployStatusBar({
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

function BrowserPanelFallback({
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

function FilesPanel({
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

function canOpenEvidence(
  evidence: EvidenceRef,
  onOpenPreview: ((evidence: EvidenceRef) => Promise<void>) | undefined,
  canOpenPreview: ((evidence: EvidenceRef) => boolean) | undefined,
): boolean {
  return Boolean(onOpenPreview) && (canOpenPreview?.(evidence) ?? true);
}

function runtimeDiffPreviewFile(file: FileDiff, runId: string | undefined, workDir: string | undefined): PreviewFile {
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

function fileDiffToText(file: FileDiff): string {
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

function inspectorTabLabel(mode: InspectorMode, t: (key: string) => string): string {
  return getInspectorTabs(t).find((tab) => tab.mode === mode)?.label ?? mode;
}

/* ═══ File Preview Router ═══ */

type FilePreviewKind = 'code' | 'pptx' | 'pptx-legacy' | 'xlsx' | 'xls' | 'csv' | 'docx' | 'pdf' | 'html' | 'image' | 'text';

function detectFilePreviewKind(fileName: string): FilePreviewKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pptx')) return 'pptx';
  if (lower.endsWith('.ppt')) return 'pptx-legacy';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.xls')) return 'xls';
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (/\.(png|jpe?g|gif|svg|webp|bmp|ico|avif)$/.test(lower)) return 'image';
  if (/\.(txt|log)$/.test(lower)) return 'text';
  return 'code';
}

/** Extract a fetchable URL from a PreviewFile's content field.
 *  runtimeEvidenceOverviewFiles puts real Edge API paths (e.g. /v1/runs/…/content)
 *  or full preview URLs into `content`; fallback text starts with `#` or prose. */
function extractFileUrl(content: string | undefined): string {
  if (!content) return '';
  // Real URLs start with '/' (relative API path) or 'http'
  if (content.startsWith('/') || content.startsWith('http://') || content.startsWith('https://')) {
    return content;
  }
  return '';
}

/** Interactive diff preview with hunk accept/reject that writes back to the workdir via Edge API. */
function InteractiveDiffPreview({
  file,
  onClose,
}: {
  file: PreviewFile;
  onClose: () => void;
}): React.ReactElement {
  if (!file.interactiveDiff) return (<></>);
  const { runId, fileDiff, workDir } = file.interactiveDiff;

  const reviewFiles: DiffReviewFile[] = useMemo(() => [{
    filePath: fileDiff.filePath,
    status: fileDiff.status === 'untracked' ? 'added' : fileDiff.status,
    additions: fileDiff.additions,
    deletions: fileDiff.deletions,
    hunks: fileDiff.hunks as unknown as DiffReviewFile['hunks'],
  }], [fileDiff]);

  const handleApplyHunk = useCallback(
    async (decision: DiffHunkDecision) => {
      try {
        await applyRunDiff(runId, {
          file_path: decision.filePath,
          hunk_index: decision.hunkIndex,
          accepted: decision.accepted,
          workDir,
        });
      } catch (err) {
        console.error('RightInspector: applyRunDiff failed for hunk:', decision.filePath, decision.hunkIndex, err);
      }
    },
    [runId, workDir],
  );

  const handleApplyAllHunks = useCallback(
    async (decisions: DiffHunkDecision[]) => {
      try {
        await applyAllRunDiffs(runId, {
          decisions: decisions.map((d) => ({
            file_path: d.filePath,
            hunk_index: d.hunkIndex,
            accepted: d.accepted,
          })),
          workDir,
        });
      } catch (err) {
        console.error('RightInspector: applyAllRunDiffs failed:', decisions.length, 'hunks,', err);
      }
    },
    [runId, workDir],
  );

  return (
    <div className={styles.filePreview}>
      <div className={styles.filePreviewHeader}>
        <button className={styles.filePreviewClose} onClick={onClose} type="button">
          {'<'} 返回
        </button>
        <span className={styles.filePreviewTitle}>{fileDiff.filePath}</span>
      </div>
      <DiffReviewPanel
        files={reviewFiles}
        runId={runId}
        onApplyHunk={handleApplyHunk}
        onApplyAllHunks={handleApplyAllHunks}
      />
    </div>
  );
}

function FilePreviewRouter({
  file,
  onClose,
}: {
  file: PreviewFile;
  onClose: () => void;
}): React.ReactElement {
  // Interactive diff review with accept/reject write-back
  if (file.interactiveDiff) {
    return (
      <InteractiveDiffPreview
        file={file}
        onClose={onClose}
      />
    );
  }

  const kind = detectFilePreviewKind(file.name);
  const content = file.content ?? `${file.name}\n\n暂无文件内容。`;
  const fileUrl = extractFileUrl(file.content);

  switch (kind) {
    case 'pptx':
    case 'pptx-legacy':
      return (
        <SlideshowPreview
          fileName={file.name}
          fileUrl={fileUrl}
          onClose={onClose}
        />
      );

    case 'xlsx':
    case 'xls':
    case 'csv':
      return (
        <TablePreview
          fileName={file.name}
          fileUrl={fileUrl}
          onClose={onClose}
        />
      );

    case 'docx':
      return (
        <DocxPreview
          fileName={file.name}
          fileUrl={fileUrl}
          onClose={onClose}
        />
      );

    case 'pdf':
      return <NativePdfPreview filename={file.name} />;

    case 'html':
      return <NativeHtmlPreview content={content} />;

    case 'image':
      return <NativeImagePreview filename={file.name} />;

    case 'text':
      return <NativeTextPreview content={content} />;

    default:
      return (
        <FilePreview
          filename={file.name}
          owner={file.owner}
          language={file.type}
          content={file.content ?? `${file.name}\n\n暂无文件内容。`}
          diffContent={file.diffContent}
          onClose={onClose}
        />
      );
  }
}

/* ═══ Native File Previews (zero extra libraries) ═══ */

function NativePdfPreview({ filename }: { filename: string }): React.ReactElement {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <iframe
        title={`PDF 预览 ${filename}`}
        style={{ flex: 1, border: 0, minHeight: 0 }}
        role="document"
      />
    </div>
  );
}

function NativeHtmlPreview({ content }: { content: string }): React.ReactElement {
  return (
    <iframe
      title="HTML 预览"
      style={{ flex: 1, border: 0, minHeight: 0, width: '100%' }}
      srcDoc={content}
      sandbox="allow-scripts"
      role="document"
    />
  );
}

function NativeImagePreview({ filename }: { filename: string }): React.ReactElement {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      overflow: 'auto',
      minHeight: 0,
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        color: 'var(--text-3)',
        font: '400 0.75rem var(--font-sans)',
      }}>
        <DesignFileIcon className={styles.fileIcon} name={filename} />
        <span>图片预览: {filename}</span>
        <span style={{ fontSize: '0.6875rem' }}>图片内容将通过文件 URL 加载</span>
      </div>
    </div>
  );
}

function NativeTextPreview({ content }: { content: string }): React.ReactElement {
  return (
    <pre style={{
      flex: 1,
      margin: 0,
      padding: 16,
      overflow: 'auto',
      font: '400 0.8125rem/1.6 var(--font-mono)',
      color: 'var(--text-2)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      background: 'var(--surface)',
      minHeight: 0,
    }}>
      {content}
    </pre>
  );
}
