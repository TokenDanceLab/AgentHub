/* ═══════════════════════════════════════════════════════════════════════
   Projects detail panels + tab bodies.

   Residual extract from ProjectDetailViews for Phase 22 #618.
   CSS remains on shared ProjectsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import {
  DesignFileIcon,
  DesignNavIcon,
} from '../../designIcons';
import type { WorkbenchDocumentPreview } from '../../documentPreview';
import { FilePreview } from '../../inspector';
import {
  resolveWorkbenchProfile,
  type WorkbenchProfileSource,
} from '../../profileRegistry';
import styles from '../ProjectsPage.module.css';
import {
  artifactTypeLabel,
  runCount,
  runStatusLabel,
  stateDotClass,
} from './shared';
import type {
  ProjectArtifact,
  ProjectFeedItem,
  ProjectInfo,
  ProjectRun,
  ProjectTab,
} from './types';

function Announcement({
  text,
  onEdit,
}: {
  text: string;
  onEdit?: (() => void) | undefined;
}) {
  return (
    <section className={`${styles.announcement} project-announcement`} data-card-surface>
      <span className={styles.announcementMark} />
      <div className={styles.announcementBody}>
        <strong className={styles.announcementLabel}>
          <DesignNavIcon name="notes" size={15} />项目公告
        </strong>
        <p className={styles.announcementText}>{text}</p>
      </div>
      {onEdit ? (
        <button
          type="button"
          className={styles.announcementEditBtn}
          onClick={onEdit}
        >
          编辑
        </button>
      ) : null}
    </section>
  );
}

function MembersCard({
  members,
  profiles = [],
}: {
  members: string[];
  profiles?: WorkbenchProfileSource[] | undefined;
}) {
  return (
    <section className={`${styles.membersCard} project-members-card`} data-card-surface>
      <div className={styles.sectionHead}>
        <h2>
          <DesignNavIcon name="users" size={15} />成员
        </h2>
        <span>{members.length} people</span>
      </div>
      <div className={`${styles.memberChips} project-members`}>
        {members.map((name) => {
          const profile = resolveWorkbenchProfile(name, profiles);
          return (
            <span
              key={name}
              className={styles.memberChip}
              data-profile-kind={profile.kind}
              title={`${profile.name} · ${profile.label}`}
            >
              <span
                className={styles.memberAvatar}
                style={{ '--member-avatar-color': profile.color } as React.CSSProperties}
              >
                {profile.initials}
              </span>
              <span className={styles.memberName}>{profile.name}</span>
              <em className={styles.memberKind}>{profile.label}</em>
            </span>
          );
        })}
      </div>
    </section>
  );
}

function ProjectProfilePill({
  name,
  profiles = [],
}: {
  name: string;
  profiles?: WorkbenchProfileSource[] | undefined;
}) {
  const profile = resolveWorkbenchProfile(name, profiles);
  return (
    <span className={styles.profilePill} data-profile-kind={profile.kind}>
      <span
        className={styles.profileAvatar}
        style={{ '--profile-avatar-color': profile.color } as React.CSSProperties}
      >
        {profile.initials}
      </span>
      <span className={styles.profileName}>{profile.name}</span>
    </span>
  );
}

function RunsPanel({
  runs,
  meta,
  onRunClick,
  profiles = [],
}: {
  runs: ProjectRun[];
  meta: string;
  onRunClick?: ((run: ProjectRun) => void) | undefined;
  profiles?: WorkbenchProfileSource[] | undefined;
}) {
  return (
    <section className={`${styles.detailPanel} ${styles.runsPanel} project-detail-panel project-runs-panel`} data-card-surface>
      <div className={styles.sectionHead}>
        <h2>
          <DesignNavIcon name="running" size={15} />项目运行
        </h2>
        <span>{meta}</span>
      </div>
      {runs.map((run) => (
        <button
          key={run.id}
          type="button"
          className={`${styles.runRow} project-run`}
          data-card-surface
          onClick={() => onRunClick?.(run)}
        >
          <span className={`${styles.stateDot} ${stateDotClass(run.status)}`} />
          <strong className={styles.runName}>{run.name}</strong>
          <ProjectProfilePill name={run.owner} profiles={profiles} />
          <em className={styles.runMeta}>{run.meta}</em>
        </button>
      ))}
    </section>
  );
}

function RunSummaryPanel({ project }: { project: ProjectInfo }) {
  const running = runCount(project.runs, ['running', 'thinking']);
  const completed = runCount(project.runs, ['completed']);
  const waiting = runCount(project.runs, ['waiting']);

  return (
    <section className={`${styles.detailPanel} project-detail-panel`} data-card-surface>
      <div className={styles.sectionHead}>
        <h2>
          <DesignNavIcon name="grid" size={15} />运行摘要
        </h2>
        <span>{project.runs.length} total</span>
      </div>
      <div className={styles.summaryRows}>
        <div className={styles.summaryRow}>
          <span className={`${styles.stateDot} ${styles.stateRunning}`} />
          <strong>活跃运行</strong>
          <em>{running}</em>
        </div>
        <div className={styles.summaryRow}>
          <span className={`${styles.stateDot} ${styles.stateCompleted}`} />
          <strong>已完成</strong>
          <em>{completed}</em>
        </div>
        <div className={styles.summaryRow}>
          <span className={`${styles.stateDot} ${styles.stateWaiting}`} />
          <strong>等待队列</strong>
          <em>{waiting}</em>
        </div>
      </div>
    </section>
  );
}

function ArtifactsPanel({
  artifacts,
  onArtifactClick,
}: {
  artifacts: ProjectArtifact[];
  onArtifactClick?: ((artifact: ProjectArtifact) => void) | undefined;
}) {
  return (
    <section className={`${styles.detailPanel} project-detail-panel`} data-card-surface>
      <div className={styles.sectionHead}>
        <h2>
          <DesignNavIcon name="package" size={15} />产物
        </h2>
        <span>{artifacts.length} files</span>
      </div>
      {artifacts.map((a) => (
        <button
          key={a.id}
          type="button"
          className={`${styles.artifactRow} project-artifact`}
          data-card-surface
          onClick={() => onArtifactClick?.(a)}
        >
          <DesignFileIcon className={styles.fileIcon} name={a.name} type={a.type} />
          <span className={styles.artifactName}>{a.name}</span>
        </button>
      ))}
    </section>
  );
}

function ArtifactIndexPanel({ artifacts }: { artifacts: ProjectArtifact[] }) {
  return (
    <section className={`${styles.detailPanel} project-detail-panel`} data-card-surface>
      <div className={styles.sectionHead}>
        <h2>
          <DesignNavIcon name="notes" size={15} />产物索引
        </h2>
        <span>{artifacts.length} entries</span>
      </div>
      {artifacts.map((artifact, index) => (
        <div key={artifact.id} className={styles.metaRow}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <strong>{artifactTypeLabel(artifact.type)}</strong>
          <em>{artifact.name}</em>
        </div>
      ))}
    </section>
  );
}

function FeedPanel({ feed }: { feed: ProjectFeedItem[] }) {
  return (
    <section className={`${styles.detailPanel} ${styles.feedPanel} project-detail-panel`} data-card-surface>
      <div className={styles.sectionHead}>
        <h2>
          <DesignNavIcon name="notes" size={15} />最近动态
        </h2>
        <span>Today</span>
      </div>
      {feed.map((item) => (
        <div key={item.id} className={styles.feedRow}>
          <time className={styles.feedTime}>{item.time}</time>
          <span>{item.text}</span>
        </div>
      ))}
    </section>
  );
}

function ProjectPreviewPanel({
  preview,
  onClosePreview,
}: {
  preview?: WorkbenchDocumentPreview | null | undefined;
  onClosePreview?: (() => void) | undefined;
}) {
  if (!preview) return null;

  return (
    <section className={`${styles.previewPanel} project-preview-panel`} data-card-surface>
      <div className={styles.previewHead}>
        <div>
          <span>{preview.sourceLabel}</span>
          <strong>{preview.name}</strong>
        </div>
        <em>项目产物预览</em>
      </div>
      <FilePreview
        filename={preview.name}
        owner={preview.owner}
        language={preview.type}
        content={preview.content}
        diffContent={preview.diffContent}
        onClose={onClosePreview ?? (() => {})}
      />
    </section>
  );
}

function RunsTab({
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

function ArtifactsTab({
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

function ArchiveTab({ project }: { project: ProjectInfo }) {
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

function ProjectMembers({
  members,
  profiles = [],
}: {
  members: string[];
  profiles?: WorkbenchProfileSource[] | undefined;
}) {
  return (
    <div className={`${styles.memberChips} project-members`}>
      {members.map((name) => {
        const profile = resolveWorkbenchProfile(name, profiles);
        return (
          <span
            key={name}
            className={styles.memberChip}
            data-profile-kind={profile.kind}
            title={`${profile.name} · ${profile.label}`}
          >
            <span
              className={styles.memberAvatar}
              style={{ '--member-avatar-color': profile.color } as React.CSSProperties}
            >
              {profile.initials}
            </span>
            <span className={styles.memberName}>{profile.name}</span>
            <em className={styles.memberKind}>{profile.label}</em>
          </span>
        );
      })}
    </div>
  );
}

function SettingsTab({
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

export function ProjectDetail({
  project,
  activeTab,
  onEditAnnouncement,
  onRunClick,
  onArtifactClick,
  profiles,
  activePreview,
  onClosePreview,
}: {
  project: ProjectInfo;
  activeTab: ProjectTab;
  onEditAnnouncement?: ((projectId: string) => void) | undefined;
  onRunClick?: ((projectId: string, run: ProjectRun) => void) | undefined;
  onArtifactClick?: ((projectId: string, artifact: ProjectArtifact) => void) | undefined;
  profiles?: WorkbenchProfileSource[] | undefined;
  activePreview?: WorkbenchDocumentPreview | null | undefined;
  onClosePreview?: (() => void) | undefined;
}) {
  switch (activeTab) {
    case 'runs':
      return <RunsTab project={project} profiles={profiles} onRunClick={onRunClick} />;
    case 'artifacts':
      return (
        <ArtifactsTab
          project={project}
          activePreview={activePreview}
          onArtifactClick={onArtifactClick}
          onClosePreview={onClosePreview}
        />
      );
    case 'archive':
      return <ArchiveTab project={project} />;
    case 'settings':
      return <SettingsTab project={project} profiles={profiles} />;
    case 'overview':
    default:
      break;
  }

  return (
    <div className={styles.detailLayout}>
      <Announcement
        text={project.announcement}
        onEdit={() => onEditAnnouncement?.(project.id)}
      />
      <MembersCard members={project.members} profiles={profiles} />
      <RunsPanel
        runs={project.runs}
        meta={project.meta}
        profiles={profiles}
        onRunClick={(run) => onRunClick?.(project.id, run)}
      />
      <ArtifactsPanel
        artifacts={project.artifacts}
        onArtifactClick={(a) => onArtifactClick?.(project.id, a)}
      />
      <FeedPanel feed={project.feed} />
      <ProjectPreviewPanel preview={activePreview} onClosePreview={onClosePreview} />
    </div>
  );
}
