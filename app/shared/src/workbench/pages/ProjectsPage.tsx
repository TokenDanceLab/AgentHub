import React from 'react';
import styles from './ProjectsPage.module.css';
import {
  DEFAULT_PROJECTS,
  ProjectMain,
  ProjectNav,
  useProjectEditor,
} from './projects';
import type { ProjectsPageProps } from './projects';

/* ═══════════════════════════════════════════════════════════════════════
   ProjectsPage — pure presentational workbench page

   Detail/chrome subviews extracted under ./projects for Phase 17 #562.
   Residual nav/main/editor shell extracted for Phase 20 #595.
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
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null;
  const {
    editorMode,
    draft,
    localActionError,
    canCreateProject,
    canUpdateProject,
    startProjectCreate,
    startProjectUpdate,
    cancelProjectEdit,
    updateProjectDraft,
    submitProjectEdit,
  } = useProjectEditor({
    activeProject,
    onNewProject,
    onProjectCreate,
    onProjectUpdate,
    onProjectSelect,
  });

  const visibleProjectActionError = projectActionError ?? localActionError;

  return (
    <section className={`${styles.page} workbench projects-page`}>
      <ProjectNav
        projects={projects}
        projectsLoading={projectsLoading}
        projectsError={projectsError}
        activeProjectId={activeProjectId}
        onProjectSelect={onProjectSelect}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        activeFilter={activeFilter}
        onFilterChange={onFilterChange}
        canCreateProject={canCreateProject}
        onStartCreate={startProjectCreate}
      />
      <ProjectMain
        activeProject={activeProject}
        activeTab={activeTab}
        onTabChange={onTabChange}
        canCreateProject={canCreateProject}
        canUpdateProject={canUpdateProject}
        editorMode={editorMode}
        draft={draft}
        projectSaving={projectSaving}
        visibleProjectActionError={visibleProjectActionError}
        onDraftChange={updateProjectDraft}
        onCancelEdit={cancelProjectEdit}
        onSubmitEdit={() => {
          void submitProjectEdit();
        }}
        onStartCreate={startProjectCreate}
        onStartUpdate={startProjectUpdate}
        profiles={profiles}
        activePreview={activePreview}
        onClosePreview={onClosePreview}
        onEditAnnouncement={onEditAnnouncement}
        onRunClick={onRunClick}
        onArtifactClick={onArtifactClick}
      />
    </section>
  );
}
