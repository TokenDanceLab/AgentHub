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
}

export function RightInspector({
  evidence,
  browserPreviewEnabled,
}: RightInspectorProps): React.ReactElement {
  const [activeMode, setActiveMode] = useState<InspectorMode>('overview');
  const model = buildInspectorEvidenceModel(evidence);

  return (
    <aside aria-label="Right inspector" className={styles.inspector}>
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
          <BrowserPanel artifactCount={model.artifacts.length} />
        ) : null}
        {activeMode === 'files' ? (
          <FilesPanel files={model.files} />
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

function FilesPanel({ files }: { files: EvidenceRef[] }): React.ReactElement {
  if (files.length === 0) {
    return <p className={styles.inspectorEmpty}>暂无变更文件</p>;
  }

  return (
    <ul aria-label="Changed files" className={styles.fileList}>
      {files.map((file) => (
        <li key={file.id}>
          <button className={styles.fileRow} type="button">
            <FileText aria-hidden="true" className={styles.fileIcon} />
            <span className={styles.fileName}>{file.label}</span>
            <span className={styles.fileMeta}>变更</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function BrowserPanel({ artifactCount }: { artifactCount: number }): React.ReactElement {
  return (
    <div className={styles.browserPreviewCard}>
      <Globe aria-hidden="true" className={styles.browserPreviewIcon} />
      <strong>浏览器预览已启用</strong>
      <span>
        {artifactCount > 0
          ? `检测到 ${artifactCount} 个产物，后续由 platform adapter 打开预览。`
          : '等待 run 产出可预览地址或 artifact。'}
      </span>
    </div>
  );
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
