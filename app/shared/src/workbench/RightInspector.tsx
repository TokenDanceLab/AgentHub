import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  demoOverviewFiles,
  demoOverviewTasks,
  getDemoFileContent,
  getDemoFileDiff,
} from '../demo/workbenchDemoData';
import { buildInspectorEvidenceModel } from '../inspector';
import type { EvidenceRef } from '../transcript';
import {
  OverviewPanel,
  type TaskItem,
  type FileItem,
  FilePreview,
  BrowserPreview,
} from './inspector';
import {
  DESIGN_NAV_GLYPH_SIZE,
  DESIGN_NAV_GLYPH_STROKE_WIDTH,
  DesignFileIcon,
  DesignNavIcon,
  type DesignNavIconName,
} from './designIcons';
import styles from './AgentHubWorkbench.module.css';

type InspectorMode = 'overview' | 'browser' | 'files';

function TabMark({
  char,
  children,
  mode,
  onClose,
}: {
  char: string;
  children: React.ReactElement;
  mode: InspectorMode;
  onClose: (mode: InspectorMode) => void;
}) {
  return (
    <span
      aria-label={`关闭 ${inspectorTabLabel(mode)}`}
      className={styles.inspectorTabMark}
      data-inspector-close
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose(mode);
      }}
      role="button"
      tabIndex={-1}
      title={`关闭 ${inspectorTabLabel(mode)}`}
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

const inspectorTabs: InspectorTabDef[] = [
  { mode: 'overview', label: '概览', markChar: '×', icon: 'overview' },
  { mode: 'browser', label: '浏览器', markChar: '×', icon: 'browser' },
  { mode: 'files', label: '文件', markChar: '×', icon: 'fileText' },
];

const defaultVisibleTabs = new Set<InspectorMode>(['overview', 'browser', 'files']);

const quickOpenItems = [
  { id: 'files', label: '文件', shortcut: 'Ctrl+P', mode: 'files' as InspectorMode },
  { id: 'chat', label: '侧边聊天', shortcut: '', mode: null },
  { id: 'browser', label: '浏览器', shortcut: 'Ctrl+T', mode: 'browser' as InspectorMode },
  { id: 'terminal', label: '终端', shortcut: 'Ctrl+`', mode: null },
];

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
  onResizeBy,
  onResizeStart,
  width,
}: RightInspectorProps): React.ReactElement {
  const [activeMode, setActiveMode] = useState<InspectorMode>('overview');
  const [visibleTabs, setVisibleTabs] = useState<Set<InspectorMode>>(() => new Set(defaultVisibleTabs));
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);

  const model = buildInspectorEvidenceModel(evidence);

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
    return demoOverviewTasks;
  }, []);

  const overviewFiles = useMemo<FileItem[]>(() => {
    return demoOverviewFiles.map((file) => ({
      ...file,
      isOpen: previewFile?.name === file.name,
    }));
  }, [previewFile?.name]);

  const handleFileClick = useCallback((file: FileItem) => {
    setPreviewFile(file);
    setActiveMode('files');
  }, []);

  const closePreview = useCallback(() => {
    setPreviewFile(null);
    setBrowserUrl(null);
    setActiveMode('overview');
  }, []);

  const browserPreviewUrl = browserUrl ?? defaultBrowserUrl;

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
                <TabMark char={tab.markChar} mode={tab.mode} onClose={closeInspectorTab}>
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
          <OverviewPanel
            tasks={overviewTasks}
            files={overviewFiles}
            taskSectionTitle="B0 SQLite 迁移"
            kicker="Builder 工作目录"
            primaryFileLabel="最终文件"
            onFileClick={handleFileClick}
          />
        )}

        {activeMode === 'browser' && visibleTabs.has('browser') && (
          browserPreviewEnabled ? (
            <BrowserPreview
              url={browserPreviewUrl}
              onClose={closePreview}
            />
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
            <FilePreview
              filename={previewFile.name}
              language={previewFile.type}
              content={getDemoFileContent(previewFile)}
              diffContent={getDemoFileDiff(previewFile)}
              onClose={closePreview}
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
        )}
      </div>
    </aside>
  );
}

/* ═══ Sub-panels ═══ */

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
                      void onOpenPreview?.(artifact).catch(() => {});
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
                void onOpenPreview?.(file).catch(() => {});
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

function inspectorTabLabel(mode: InspectorMode): string {
  return inspectorTabs.find((tab) => tab.mode === mode)?.label ?? mode;
}
