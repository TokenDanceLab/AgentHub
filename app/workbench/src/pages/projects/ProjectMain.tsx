/* ═══════════════════════════════════════════════════════════════════════
   Projects main pane shell — detail head, editor, tabs, empty state.

   Extracted from ProjectsPage as Phase 20 residual thin #595.
   CSS remains on shared ProjectsPage.module.css.
   EmptyState contracts preserved (titleLevel, optional class spreads, CTA).
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import { EmptyState } from '@shared/ui';
import { SkeletonBar } from '@shared/ui/SkeletonBar';
import type { WorkbenchDocumentPreview } from '../../documentPreview';
import type { WorkbenchProfileSource } from '../../profileRegistry';
import styles from '../ProjectsPage.module.css';
import { ProjectEditor, ProjectTabs } from './ProjectChromeViews';
import { ProjectDetail } from './ProjectPanelViews';
import type {
  ProjectArtifact,
  ProjectDraft,
  ProjectInfo,
  ProjectRun,
  ProjectTab,
} from './types';

export type ProjectMainProps = {
  /** First-load flag: renders a detail skeleton in place of the empty state
   *  while the project list is still loading (wire from the parent page). */
  loading?: boolean | undefined;
  activeProject: ProjectInfo | null;
  activeTab: ProjectTab;
  onTabChange: (tab: ProjectTab) => void;
  canCreateProject: boolean;
  canUpdateProject: boolean;
  editorMode: 'create' | 'update' | null;
  draft: ProjectDraft;
  projectSaving?: boolean | undefined;
  visibleProjectActionError?: string | undefined;
  onDraftChange: (draft: ProjectDraft) => void;
  onCancelEdit: () => void;
  onSubmitEdit: () => void;
  onStartCreate: () => void;
  onStartUpdate: (project: ProjectInfo) => void;
  profiles?: WorkbenchProfileSource[] | undefined;
  activePreview?: WorkbenchDocumentPreview | null | undefined;
  onClosePreview?: (() => void) | undefined;
  onEditAnnouncement?: ((projectId: string) => void) | undefined;
  onRunClick?: ((projectId: string, run: ProjectRun) => void) | undefined;
  onArtifactClick?: ((projectId: string, artifact: ProjectArtifact) => void) | undefined;
};

export function ProjectMain({
  loading = false,
  activeProject,
  activeTab,
  onTabChange,
  canCreateProject,
  canUpdateProject,
  editorMode,
  draft,
  projectSaving,
  visibleProjectActionError,
  onDraftChange,
  onCancelEdit,
  onSubmitEdit,
  onStartCreate,
  onStartUpdate,
  profiles,
  activePreview,
  onClosePreview,
  onEditAnnouncement,
  onRunClick,
  onArtifactClick,
}: ProjectMainProps): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);

  const editor = editorMode ? (
    <ProjectEditor
      mode={editorMode}
      draft={draft}
      saving={projectSaving}
      error={visibleProjectActionError}
      onDraftChange={onDraftChange}
      onCancel={onCancelEdit}
      onSubmit={onSubmitEdit}
    />
  ) : null;

  return (
    <main className={`${styles.main} workbench-main`}>
      {activeProject ? (
        <>
          <div className={`${styles.detailHead} workbench-head`}>
            <div>
              <h1>{activeProject.name}</h1>
              <p>
                {activeProject.description} · {activeProject.meta}
              </p>
            </div>
            <div className={styles.headActions}>
              {canUpdateProject ? (
                <button
                  type="button"
                  className={styles.newProjectBtn}
                  onClick={() => onStartUpdate(activeProject)}
                >
                  {t('projects.edit')}
                </button>
              ) : null}
              <span className={styles.statusBadge}>{activeProject.status}</span>
            </div>
          </div>
          {editor}
          <ProjectTabs activeTab={activeTab} onTabChange={onTabChange} />
          <ProjectDetail
            project={activeProject}
            activeTab={activeTab}
            onEditAnnouncement={onEditAnnouncement}
            onRunClick={onRunClick}
            onArtifactClick={onArtifactClick}
            profiles={profiles}
            activePreview={activePreview}
            onClosePreview={onClosePreview}
          />
        </>
      ) : loading ? (
        <>
          <ProjectDetailSkeleton />
          {editor}
        </>
      ) : (
        <div className={styles.emptyMain}>
          <EmptyState
            title={t('projects.empty.title')}
            description={t('projects.empty.description')}
            titleLevel={1}
            {...(styles['projects-empty'] ? { className: styles['projects-empty'] } : {})}
            {...(styles['projects-empty-content']
              ? { contentClassName: styles['projects-empty-content'] }
              : {})}
            {...(styles['projects-empty-title']
              ? { titleClassName: styles['projects-empty-title'] }
              : {})}
            {...(styles['projects-empty-description']
              ? { descriptionClassName: styles['projects-empty-description'] }
              : {})}
            {...(styles['projects-empty-action']
              ? { actionClassName: styles['projects-empty-action'] }
              : {})}
            {...(canCreateProject
              ? {
                  action: {
                    label: t('projects.empty.createFirst'),
                    onClick: onStartCreate,
                  },
                }
              : {})}
          />
          {editor}
        </div>
      )}
    </main>
  );
}

/* ── First-load detail skeleton (project list still loading) ── */

function ProjectDetailSkeleton(): React.ReactElement {
  return (
    <div
      aria-hidden="true"
      data-testid="project-detail-skeleton"
      style={{ display: 'grid', gap: 'var(--sp-10)', padding: 'var(--td-space-5) 0' }}
    >
      <SkeletonBar width="38%" height="26px" />
      <SkeletonBar width="62%" height="12px" />
      <SkeletonBar variant="block" width="100%" height="120px" />
      <SkeletonBar variant="block" width="100%" height="88px" />
    </div>
  );
}
