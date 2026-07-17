/* ═══════════════════════════════════════════════════════════════════════
   Projects main pane shell — detail head, editor, tabs, empty state.

   Extracted from ProjectsPage as Phase 20 residual thin #595.
   CSS remains on shared ProjectsPage.module.css.
   EmptyState contracts preserved (titleLevel, optional class spreads, CTA).
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '../../../i18n';
import { EmptyState } from '../../../ui';
import type { WorkbenchDocumentPreview } from '../../documentPreview';
import type { WorkbenchProfileSource } from '../../profileRegistry';
import styles from '../ProjectsPage.module.css';
import { ProjectDetail, ProjectEditor, ProjectTabs } from './ProjectDetailViews';
import type {
  ProjectArtifact,
  ProjectDraft,
  ProjectInfo,
  ProjectRun,
  ProjectTab,
} from './types';

export type ProjectMainProps = {
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
                  编辑项目
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
