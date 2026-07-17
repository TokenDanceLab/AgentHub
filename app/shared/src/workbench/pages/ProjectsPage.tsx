import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '../../i18n';
import { EmptyState, StatusNotice } from '../../ui';
import { DesignNavIcon } from '../designIcons';
import styles from './ProjectsPage.module.css';
import {
  DEFAULT_PROJECTS,
  FilterList,
  ProjectDetail,
  ProjectEditor,
  ProjectNavRow,
  ProjectTabs,
  projectSubmitErrorMessage,
} from './projects';
import type {
  ProjectDraft,
  ProjectInfo,
  ProjectsPageProps,
} from './projects';

/* ═══════════════════════════════════════════════════════════════════════
   ProjectsPage — pure presentational workbench page

   Detail/chrome subviews extracted under ./projects for Phase 17 #562.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Public re-exports (preserve external consumers) ── */

export { DEFAULT_PROJECTS } from './projects';

export type {
  ProjectRunStatus,
  ProjectRun,
  ProjectArtifact,
  ProjectFeedItem,
  ProjectInfo,
  ProjectDraft,
  ProjectFilter,
  ProjectTab,
  ProjectsPageProps,
} from './projects';

// ── Main component ──

export function ProjectsPage({
  projects,
  projectsLoading,
  projectsError,
  projectSaving,
  projectActionError,
  activeProjectId,
  onProjectSelect,
  searchQuery = '',
  onSearchChange,
  activeFilter,
  onFilterChange,
  activeTab,
  onTabChange,
  onNewProject,
  profiles,
  activePreview,
  onClosePreview,
  onEditAnnouncement,
  onProjectCreate,
  onProjectUpdate,
  onRunClick,
  onArtifactClick,
}: ProjectsPageProps): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null;
  const [editorMode, setEditorMode] = useState<'create' | 'update' | null>(null);
  const [draft, setDraft] = useState<ProjectDraft>({ name: '', description: '' });
  const [localActionError, setLocalActionError] = useState<string | undefined>();
  const canCreateProject = Boolean(onProjectCreate);
  const canUpdateProject = Boolean(onProjectUpdate);

  useEffect(() => {
    if (editorMode !== 'update' || !activeProject) return;
    setDraft({
      name: activeProject.name,
      description: activeProject.description,
    });
  }, [activeProject, editorMode]);

  function startProjectCreate(): void {
    if (!onProjectCreate) return;
    onNewProject?.();
    setDraft({ name: '', description: '' });
    setLocalActionError(undefined);
    setEditorMode('create');
  }

  function startProjectUpdate(project: ProjectInfo): void {
    if (!onProjectUpdate) return;
    setDraft({
      name: project.name,
      description: project.description,
    });
    setLocalActionError(undefined);
    setEditorMode('update');
  }

  function cancelProjectEdit(): void {
    setLocalActionError(undefined);
    setEditorMode(null);
  }

  function updateProjectDraft(nextDraft: ProjectDraft): void {
    setDraft(nextDraft);
    setLocalActionError(undefined);
  }

  async function submitProjectEdit(): Promise<void> {
    const nextDraft = {
      name: draft.name.trim(),
      description: draft.description.trim(),
    };
    if (!nextDraft.name) return;

    setLocalActionError(undefined);

    try {
      if (editorMode === 'create') {
        if (!onProjectCreate) return;
        const created = await onProjectCreate(nextDraft);
        if (created?.id) onProjectSelect(created.id);
        setEditorMode(null);
        return;
      }

      if (editorMode === 'update' && activeProject) {
        if (!onProjectUpdate) return;
        const updated = await onProjectUpdate(activeProject.id, nextDraft);
        if (updated?.id) onProjectSelect(updated.id);
        setEditorMode(null);
      }
    } catch (error) {
      setLocalActionError(projectSubmitErrorMessage(error));
    }
  }

  const visibleProjectActionError = projectActionError ?? localActionError;

  return (
    <section className={`${styles.page} workbench projects-page`}>
      {/* ── Left nav ── */}
      <aside className={`${styles.nav} workbench-nav project-nav`}>
        <div className={styles.navHeader}>
          <div className={`${styles.navTitle} workbench-title`}>{t('nav.projects')}</div>
          {canCreateProject ? (
            <button
              type="button"
              className={`${styles.newProjectBtn} ${styles.navNewProjectBtn} outline-action`}
              onClick={startProjectCreate}
            >
              {t('projects.newProject')}
            </button>
          ) : null}
        </div>
        <input
          className={`${styles.search} workbench-search`}
          placeholder={t('header.search')}
          value={searchQuery}
          onChange={(e) => onSearchChange?.(e.target.value)}
        />
        <div className={styles.navCaption}>{t('nav.projects')}</div>
        {projectsLoading || projectsError ? (
          <div className={styles.statusStack}>
            {projectsLoading ? (
              <StatusNotice
                {...(styles.statusNotice ? { className: styles.statusNotice } : {})}
                icon={<DesignNavIcon name="running" size={14} />}
                role="status"
              >
                {t('projects.loading')}
              </StatusNotice>
            ) : null}
            {projectsError ? (
              <StatusNotice
                {...(styles.statusNotice ? { className: styles.statusNotice } : {})}
                icon={<DesignNavIcon name="error404" size={14} />}
                role="alert"
              >
                {projectsError}
              </StatusNotice>
            ) : null}
          </div>
        ) : null}
        {projects.map((project) => (
          <ProjectNavRow
            key={project.id}
            project={project}
            isActive={project.id === activeProjectId}
            onSelect={onProjectSelect}
          />
        ))}
        <div className={styles.navCaption}>视图</div>
        <FilterList activeFilter={activeFilter} onFilterChange={onFilterChange} />
      </aside>

      {/* ── Right main ── */}
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
                    onClick={() => startProjectUpdate(activeProject)}
                  >
                    编辑项目
                  </button>
                ) : null}
                <span className={styles.statusBadge}>
                  {activeProject.status}
                </span>
              </div>
            </div>
            {editorMode ? (
              <ProjectEditor
                mode={editorMode}
                draft={draft}
                saving={projectSaving}
                error={visibleProjectActionError}
                onDraftChange={updateProjectDraft}
                onCancel={cancelProjectEdit}
                onSubmit={() => {
                  void submitProjectEdit();
                }}
              />
            ) : null}
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
                      onClick: startProjectCreate,
                    },
                  }
                : {})}
            />
            {editorMode ? (
              <ProjectEditor
                mode={editorMode}
                draft={draft}
                saving={projectSaving}
                error={visibleProjectActionError}
                onDraftChange={updateProjectDraft}
                onCancel={cancelProjectEdit}
                onSubmit={() => {
                  void submitProjectEdit();
                }}
              />
            ) : null}
          </div>
        )}
      </main>
    </section>
  );
}
