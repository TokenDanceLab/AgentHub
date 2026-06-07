import React, { useState, useCallback, useMemo } from 'react';
import { buildInspectorEvidenceModel } from '../inspector';
import type { EvidenceRef } from '../transcript';
import {
  OverviewPanel,
  type TaskItem,
  type FileItem,
  FilePreview,
  BrowserPreview,
} from './inspector';
import { DesignFileIcon, DesignNavIcon, type DesignNavIconName } from './designIcons';
import styles from './AgentHubWorkbench.module.css';

type InspectorMode = 'overview' | 'browser' | 'files';

function TabMark({ char, children }: { char: string; children: React.ReactElement }) {
  return (
    <span className={styles.inspectorTabMark}>
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

const prototypeTasks: TaskItem[] = [
  { label: '梳理现有会话表与消息索引', status: 'done' },
  { label: '确认 FTS5 搜索字段边界', status: 'done' },
  { label: '生成迁移顺序与回滚脚本', status: 'active' },
  { label: '补充性能验证清单', status: 'todo' },
];

const prototypeFiles: FileItem[] = [
  { name: 'sqlite-migration-plan.md', type: 'sql', isPrimary: true },
  { name: 'migrations/0007_chat_threads.sql', type: 'db' },
  { name: 'hooks/useThreadNavigation.ts', type: 'ts' },
  { name: 'B0-SQLITE-RISKS.md', type: 'md' },
];

const prototypeFileContent: Record<string, string> = {
  'sqlite-migration-plan.md': `# B0 SQLite 迁移方案

## 目标
- 新增 thread/message 索引，保持现有会话可回滚。
- 使用 FTS5 支持本地消息搜索。
- 迁移脚本必须可以重复执行并输出校验摘要。

## 顺序
1. 备份当前 SQLite 数据库。
2. 创建 chat_threads 与 message_search 虚表。
3. 回填历史消息索引。
4. 写入 migration_state 并生成校验报告。`,
  'migrations/0007_chat_threads.sql': `BEGIN;

CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS message_search
USING fts5(thread_id, author, body);

COMMIT;`,
  'hooks/useThreadNavigation.ts': `export function useThreadNavigation(threadId: string) {
  return {
    activeThreadId: threadId,
    openThread: (next: string) => next,
  };
}`,
  'B0-SQLITE-RISKS.md': `# B0 SQLite 风险

- 回滚脚本必须覆盖索引表与迁移状态。
- FTS5 字段只保存可搜索摘要。
- 导航 hook 不能改变现有 thread id。`,
};

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
  onResizeBy,
  onResizeStart,
  width,
}: RightInspectorProps): React.ReactElement {
  const [activeMode, setActiveMode] = useState<InspectorMode>('overview');
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);

  const model = buildInspectorEvidenceModel(evidence);

  const overviewTasks = useMemo<TaskItem[]>(() => {
    return prototypeTasks;
  }, []);

  const overviewFiles = useMemo<FileItem[]>(() => {
    return prototypeFiles.map((file) => ({
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

  const openNewInspectorWindow = useCallback(() => {
    setPreviewFile(null);
    setBrowserUrl(defaultBrowserUrl);
    setActiveMode('browser');
  }, [defaultBrowserUrl]);

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
          {inspectorTabs.map((tab) => {
            const disabled = tab.mode === 'browser' && !browserPreviewEnabled;
            return (
              <button
                aria-selected={activeMode === tab.mode}
                className={styles.inspectorTab}
                data-inspector-tab={tab.mode}
                disabled={disabled}
                key={tab.mode}
                onClick={() => setActiveMode(tab.mode)}
                role="tab"
                type="button"
              >
                <TabMark char={tab.markChar}>
                  <DesignNavIcon className={styles.inspectorTabIcon} name={tab.icon} size={16} />
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
            onClick={openNewInspectorWindow}
          >
            <DesignNavIcon name="plus" size={15} />
          </button>
        </div>
      </div>

      <div className={styles.inspectorPanel} role="tabpanel">
        {activeMode === 'overview' && (
          <OverviewPanel
            tasks={overviewTasks}
            files={overviewFiles}
            taskSectionTitle="B0 SQLite 迁移"
            kicker="Builder 工作目录"
            primaryFileLabel="最终文件"
            onFileClick={handleFileClick}
          />
        )}

        {activeMode === 'browser' && (
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

        {activeMode === 'files' && (
          previewFile ? (
            <FilePreview
              filename={previewFile.name}
              language={previewFile.type}
              content={filePreviewContent(previewFile)}
              onClose={closePreview}
            />
          ) : (
            <FilesPanel
              canOpenPreview={canOpenPreview}
              files={model.files}
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
  files,
  onOpenPreview,
}: {
  canOpenPreview?: ((evidence: EvidenceRef) => boolean) | undefined;
  files: EvidenceRef[];
  onOpenPreview?: ((evidence: EvidenceRef) => Promise<void>) | undefined;
}): React.ReactElement {
  if (files.length === 0) {
    return <p className={styles.inspectorEmpty}>暂无变更文件</p>;
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

function filePreviewContent(file: FileItem): string {
  return prototypeFileContent[file.name] ?? `${file.name}\n\n只读预览内容等待平台 adapter 提供。`;
}
