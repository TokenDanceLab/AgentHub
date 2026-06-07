import React, { useState } from 'react';
import { Activity, FileText, Globe, Package, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { buildInspectorEvidenceModel, evidenceStatusLabel } from '../inspector';
import type { EvidenceRef, EvidenceRefStatus } from '../transcript';
import styles from './AgentHubWorkbench.module.css';

type InspectorMode = 'overview' | 'browser' | 'files';

const inspectorTabs: Array<{ mode: InspectorMode; label: string; icon: LucideIcon }> = [
  { mode: 'overview', label: '概览', icon: Activity },
  { mode: 'browser', label: '浏览器', icon: Globe },
  { mode: 'files', label: '文件', icon: FileText },
];

export interface RightInspectorProps {
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
  const model = buildInspectorEvidenceModel(evidence);

  return (
    <aside
      aria-hidden={collapsed}
      aria-label="Right inspector"
      className={styles.inspector}
      data-collapsed={collapsed ? 'true' : 'false'}
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
      <div aria-label="Inspector tabs" className={styles.inspectorTabs} role="tablist">
        {inspectorTabs.map((tab) => {
          const disabled = tab.mode === 'browser' && !browserPreviewEnabled;
          const Icon = tab.icon;
          return (
            <button
              aria-selected={activeMode === tab.mode}
              className={styles.inspectorTab}
              disabled={disabled}
              key={tab.mode}
              onClick={() => setActiveMode(tab.mode)}
              role="tab"
              type="button"
            >
              <Icon aria-hidden="true" className={styles.inspectorTabIcon} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className={styles.inspectorPanel} role="tabpanel">
        {activeMode === 'overview' ? (
          <OverviewPanel model={model} />
        ) : null}
        {activeMode === 'browser' ? (
          <BrowserPanel
            artifacts={model.artifacts}
            canOpenPreview={canOpenPreview}
            onOpenPreview={onOpenPreview}
          />
        ) : null}
        {activeMode === 'files' ? (
          <FilesPanel
            canOpenPreview={canOpenPreview}
            files={model.files}
            onOpenPreview={onOpenPreview}
          />
        ) : null}
      </div>
    </aside>
  );
}

interface InspectorModelProps {
  model: ReturnType<typeof buildInspectorEvidenceModel>;
}

function OverviewPanel({ model }: InspectorModelProps): React.ReactElement {
  if (model.total === 0) {
    return <p className={styles.inspectorEmpty}>暂无运行证据</p>;
  }

  return (
    <>
      <dl aria-label="Evidence summary" className={styles.inspectorSummary}>
        <div>
          <dt>证据</dt>
          <dd>{model.total}</dd>
        </div>
        <div>
          <dt>运行中</dt>
          <dd>{model.statuses.running + model.statuses.pending}</dd>
        </div>
        <div>
          <dt>文件</dt>
          <dd>{model.files.length}</dd>
        </div>
      </dl>

      <EvidenceSection
        emptyText="暂无运行记录"
        icon={Activity}
        items={model.runs}
        title="运行"
      />
      <EvidenceSection
        emptyText="暂无工具调用"
        icon={Wrench}
        items={model.tools}
        title="工具"
      />
      <EvidenceSection
        emptyText="暂无产物"
        icon={Package}
        items={model.artifacts}
        title="产物"
      />
    </>
  );
}

interface EvidenceSectionProps {
  emptyText: string;
  icon: LucideIcon;
  items: EvidenceRef[];
  title: string;
}

function EvidenceSection({
  emptyText,
  icon: Icon,
  items,
  title,
}: EvidenceSectionProps): React.ReactElement {
  return (
    <section className={styles.inspectorSection}>
      <div className={styles.inspectorSectionHeader}>
        <h3>{title}</h3>
        <span>{items.length}</span>
      </div>
      {items.length > 0 ? (
        <ul aria-label={`${title} evidence`} className={styles.evidenceList}>
          {items.map((item) => (
            <li className={styles.evidenceItem} key={item.id}>
              <Icon aria-hidden="true" className={styles.evidenceIcon} />
              {renderEvidence(item)}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.inspectorEmpty}>{emptyText}</p>
      )}
    </section>
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
              <FileText aria-hidden="true" className={styles.fileIcon} />
              <span className={styles.fileName}>{file.label}</span>
              <span className={styles.fileMeta}>{canOpen ? '打开' : '待接入'}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function BrowserPanel({
  artifacts,
  canOpenPreview,
  onOpenPreview,
}: {
  artifacts: EvidenceRef[];
  canOpenPreview?: ((evidence: EvidenceRef) => boolean) | undefined;
  onOpenPreview?: ((evidence: EvidenceRef) => Promise<void>) | undefined;
}): React.ReactElement {
  if (artifacts.length > 0) {
    return (
      <div className={styles.browserPreviewCard}>
        <Globe aria-hidden="true" className={styles.browserPreviewIcon} />
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
                    if (!canOpen) return;
                    void onOpenPreview?.(artifact).catch(() => {});
                  }}
                  type="button"
                >
                  <Package aria-hidden="true" className={styles.fileIcon} />
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
      <Globe aria-hidden="true" className={styles.browserPreviewIcon} />
      <strong>浏览器预览已启用</strong>
      <span>等待 run 产出可预览地址或 artifact。</span>
    </div>
  );
}

function canOpenEvidence(
  evidence: EvidenceRef,
  onOpenPreview: ((evidence: EvidenceRef) => Promise<void>) | undefined,
  canOpenPreview: ((evidence: EvidenceRef) => boolean) | undefined,
): boolean {
  return Boolean(onOpenPreview) && (canOpenPreview?.(evidence) ?? true);
}

function renderEvidence(item: EvidenceRef): React.ReactElement {
  return (
    <>
      <span className={styles.evidenceCopy}>
        <span className={styles.evidenceLabel}>{item.label}</span>
        <span className={styles.blockMeta}>{item.kind}</span>
      </span>
      <StatusBadge status={item.status} />
    </>
  );
}

function StatusBadge({ status }: { status: EvidenceRefStatus | undefined }): React.ReactElement {
  return (
    <span className={`${styles.statusBadge} ${statusClassName(status)}`}>
      {evidenceStatusLabel(status)}
    </span>
  );
}

function statusClassName(status: EvidenceRefStatus | undefined): string {
  switch (status) {
    case 'pending':
      return styles.status_pending ?? styles.status_neutral ?? '';
    case 'running':
      return styles.status_running ?? styles.status_neutral ?? '';
    case 'completed':
      return styles.status_completed ?? styles.status_neutral ?? '';
    case 'failed':
      return styles.status_failed ?? styles.status_neutral ?? '';
    default:
      return styles.status_neutral ?? '';
  }
}
