/* ═══════════════════════════════════════════════════════════════════════
   Projects detail tab bodies (runs / artifacts / archive / settings).

   Residual extract from ProjectPanelViews for Phase 23 #626.
   CSS remains on shared ProjectsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import {
  DesignFileIcon,
  DesignNavIcon,
} from '../../designIcons';
import type { WorkbenchDocumentPreview } from '../../documentPreview';
import type { WorkbenchProfileSource } from '../../profileRegistry';
import styles from '../ProjectsPage.module.css';
import {
  Announcement,
  ArtifactIndexPanel,
  ArtifactsPanel,
  FeedPanel,
  ProjectMembers,
  ProjectPreviewPanel,
  RunsPanel,
  RunSummaryPanel,
} from './ProjectPanelParts';
import {
  runCount,
  runStatusLabel,
} from './shared';
import type {
  ProjectArtifact,
  ProjectInfo,
  ProjectRun,
} from './types';

export function RunsTab({
  project,
  onRunClick,
  profiles = [],
}: {
  project: ProjectInfo;
  onRunClick?: ((projectId: string, run: ProjectRun) => void) | undefined;
  profiles?: WorkbenchProfileSource[] | undefined;
}) {
  return (
    <div className={styles.detailLayout}>
      <RunsPanel
        runs={project.runs}
        meta={project.meta}
        profiles={profiles}
        onRunClick={(run) => onRunClick?.(project.id, run)}
      />
      <RunSummaryPanel project={project} />
      <section className={`${styles.detailPanel} ${styles.feedPanel} project-detail-panel project-feed`} data-card-surface>
        <div className={styles.sectionHead}>
          <h2>
            <DesignNavIcon name="notes" size={15} />运行记录
          </h2>
          <span>Recent</span>
        </div>
        {project.runs.map((run) => (
          <div key={run.id} className={styles.feedRow}>
            <time className={styles.feedTime}>{runStatusLabel(run.status)}</time>
            <span>
              {run.owner} 负责 {run.name}，当前进度 {run.meta}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}

export function ArtifactsTab({
  project,
  onArtifactClick,
  activePreview,
  onClosePreview,
}: {
  project: ProjectInfo;
  onArtifactClick?: ((projectId: string, artifact: ProjectArtifact) => void) | undefined;
  activePreview?: WorkbenchDocumentPreview | null | undefined;
  onClosePreview?: (() => void) | undefined;
}) {
  return (
    <div className={styles.detailLayout}>
      <ArtifactsPanel
        artifacts={project.artifacts}
        onArtifactClick={(artifact) => onArtifactClick?.(project.id, artifact)}
      />
      <ArtifactIndexPanel artifacts={project.artifacts} />
      <section className={`${styles.detailPanel} ${styles.feedPanel} project-detail-panel project-feed`} data-card-surface>
        <div className={styles.sectionHead}>
          <h2>
            <DesignNavIcon name="package" size={15} />交付动态
          </h2>
          <span>{project.artifacts.length} files</span>
        </div>
        {project.artifacts.map((artifact) => (
          <div key={artifact.id} className={styles.feedRow}>
            <time className={styles.feedTime}>{artifact.type}</time>
            <span>{artifact.name} 已进入当前项目产物列表</span>
          </div>
        ))}
      </section>
      <ProjectPreviewPanel preview={activePreview} onClosePreview={onClosePreview} />
    </div>
  );
}

export function ArchiveTab({ project }: { project: ProjectInfo }) {
  const completed = runCount(project.runs, ['completed']);
  const active = runCount(project.runs, ['running', 'thinking', 'waiting']);
  const archiveItems = [
    { id: 'runs', label: '运行记录', value: `${completed}/${project.runs.length} 完成`, status: active > 0 ? '待确认' : '可归档' },
    { id: 'artifacts', label: '产物索引', value: `${project.artifacts.length} files`, status: '已整理' },
    { id: 'members', label: '成员确认', value: `${project.members.length} people`, status: project.status },
  ];

  return (
    <div className={styles.detailLayout}>
      <section className={`${styles.detailPanel} project-detail-panel`} data-card-surface>
        <div className={styles.sectionHead}>
          <h2>
            <DesignNavIcon name="archive" size={15} />归档检查
          </h2>
          <span>{archiveItems.length} checks</span>
        </div>
        {archiveItems.map((item) => (
          <div key={item.id} className={styles.archiveRow}>
            <span className={`${styles.stateDot} ${item.status === '可归档' || item.status === '已整理' ? styles.stateCompleted : styles.stateWaiting}`} />
            <strong>{item.label}</strong>
            <small>{item.value}</small>
            <em>{item.status}</em>
          </div>
        ))}
      </section>
      <section className={`${styles.detailPanel} project-detail-panel`} data-card-surface>
        <div className={styles.sectionHead}>
          <h2>
            <DesignNavIcon name="package" size={15} />归档包
          </h2>
          <span>Draft</span>
        </div>
        <button type="button" className={`${styles.artifactRow} project-artifact`} data-card-surface>
          <DesignFileIcon className={styles.fileIcon} name={`${project.id}-handoff.md`} type="md" />
          <span className={styles.artifactName}>{project.id}-handoff.md</span>
        </button>
        <button type="button" className={`${styles.artifactRow} project-artifact`} data-card-surface>
          <DesignFileIcon className={styles.fileIcon} name={`${project.id}-manifest.xlsx`} type="xlsx" />
          <span className={styles.artifactName}>{project.id}-manifest.xlsx</span>
        </button>
      </section>
      <FeedPanel feed={project.feed} />
    </div>
  );
}

export function SettingsTab({
  project,
  profiles = [],
}: {
  project: ProjectInfo;
  profiles?: WorkbenchProfileSource[] | undefined;
}) {
  const settings = [
    { label: '项目名称', value: project.name, meta: project.id },
    { label: '当前状态', value: project.status, meta: project.meta },
    { label: '默认 Agent', value: project.runs[0]?.owner ?? 'Orchestrator', meta: '运行入口' },
    { label: '成员策略', value: `${project.members.length} 人协作`, meta: '项目空间' },
    { label: '归档策略', value: project.status.includes('归档') ? '归档确认' : '运行完成后归档', meta: '自动整理' },
  ];

  return (
    <div className={styles.detailLayout}>
      <Announcement
        text={project.announcement}
        onEdit={undefined}
      />
      <section className={`${styles.detailPanel} ${styles.settingsPanel} project-detail-panel`} data-card-surface>
        <div className={styles.sectionHead}>
          <h2>
            <DesignNavIcon name="tools" size={15} />项目设置
          </h2>
          <span>{settings.length} 项</span>
        </div>
        {settings.map((item) => (
          <div key={item.label} className={styles.settingRow}>
            <div>
              <strong>{item.label}</strong>
              <small>{item.meta}</small>
            </div>
            <span>{item.value}</span>
          </div>
        ))}
      </section>
      <section className={`${styles.detailPanel} ${styles.settingsSidePanel} project-detail-panel`} data-card-surface>
        <div className={styles.sectionHead}>
          <h2>
            <DesignNavIcon name="users" size={15} />成员策略
          </h2>
          <span>{project.members.length} people</span>
        </div>
        <ProjectMembers members={project.members} profiles={profiles} />
      </section>
    </div>
  );
}
