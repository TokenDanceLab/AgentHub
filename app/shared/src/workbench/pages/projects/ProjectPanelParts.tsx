/* ═══════════════════════════════════════════════════════════════════════
   Projects detail presentational panels.

   Residual extract from ProjectPanelViews for Phase 23 #626.
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
  stateDotClass,
} from './shared';
import type {
  ProjectArtifact,
  ProjectFeedItem,
  ProjectInfo,
  ProjectRun,
} from './types';

export function Announcement({
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

export function MembersCard({
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

export function ProjectProfilePill({
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

export function RunsPanel({
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

export function RunSummaryPanel({ project }: { project: ProjectInfo }) {
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

export function ArtifactsPanel({
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

export function ArtifactIndexPanel({ artifacts }: { artifacts: ProjectArtifact[] }) {
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

export function FeedPanel({ feed }: { feed: ProjectFeedItem[] }) {
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

export function ProjectPreviewPanel({
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

export function ProjectMembers({
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
