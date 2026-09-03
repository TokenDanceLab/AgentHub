/* ═══════════════════════════════════════════════════════════════════════
   Projects detail presentational panels.

   Residual extract from ProjectPanelViews for Phase 23 #626.
   Residual thin (#696): Announcement / FeedPanel / ProjectMembers moved
   to their own files; SectionHead + MemberChip shared via helpers.
   CSS remains on shared ProjectsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import { DesignFileIcon } from '../../designIcons';
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
  ProjectInfo,
  ProjectRun,
} from './types';
import { ProjectMemberChip, ProjectSectionHead } from './ProjectPanelHelpers';

export function MembersCard({
  members,
  profiles = [],
}: {
  members: string[];
  profiles?: WorkbenchProfileSource[] | undefined;
}) {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <section className={`${styles.membersCard} project-members-card`} data-card-surface>
      <ProjectSectionHead icon="users" title={t("projects.section.members")} meta={`${members.length} people`} />
      <div className={`${styles.memberChips} project-members`}>
        {members.map((name) => (
          <ProjectMemberChip key={name} name={name} profiles={profiles} />
        ))}
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
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <section className={`${styles.detailPanel} ${styles.runsPanel} project-detail-panel project-runs-panel`} data-card-surface>
      <ProjectSectionHead icon="running" title={t("projects.section.projectRuns")} meta={meta} />
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
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const running = runCount(project.runs, ['running', 'thinking']);
  const completed = runCount(project.runs, ['completed']);
  const waiting = runCount(project.runs, ['waiting']);

  return (
    <section className={`${styles.detailPanel} project-detail-panel`} data-card-surface>
      <ProjectSectionHead icon="grid" title={t("projects.section.runSummary")} meta={`${project.runs.length} total`} />
      <div className={styles.summaryRows}>
        <div className={styles.summaryRow}>
          <span className={`${styles.stateDot} ${styles.stateRunning}`} />
          <strong>{t('projects.activeRuns')}</strong>
          <em>{running}</em>
        </div>
        <div className={styles.summaryRow}>
          <span className={`${styles.stateDot} ${styles.stateCompleted}`} />
          <strong>{t('projects.completed')}</strong>
          <em>{completed}</em>
        </div>
        <div className={styles.summaryRow}>
          <span className={`${styles.stateDot} ${styles.stateWaiting}`} />
          <strong>{t('projects.queue')}</strong>
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
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <section className={`${styles.detailPanel} project-detail-panel`} data-card-surface>
      <ProjectSectionHead icon="package" title={t("projects.section.artifacts")} meta={`${artifacts.length} files`} />
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
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <section className={`${styles.detailPanel} project-detail-panel`} data-card-surface>
      <ProjectSectionHead icon="notes" title={t("projects.section.artifactIndex")} meta={`${artifacts.length} entries`} />
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

export function ProjectPreviewPanel({
  preview,
  onClosePreview,
}: {
  preview?: WorkbenchDocumentPreview | null | undefined;
  onClosePreview?: (() => void) | undefined;
}) {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  if (!preview) return null;

  return (
    <section className={`${styles.previewPanel} project-preview-panel`} data-card-surface>
      <div className={styles.previewHead}>
        <div>
          <span>{preview.sourceLabel}</span>
          <strong>{preview.name}</strong>
        </div>
        <em>{t('projects.artifactsPreview')}</em>
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
