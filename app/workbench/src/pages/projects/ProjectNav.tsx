/* ═══════════════════════════════════════════════════════════════════════
   Projects left-nav shell — header, search, status, rows, filters.

   Extracted from ProjectsPage as Phase 20 residual thin #595.
   CSS remains on shared ProjectsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import { StatusNotice } from '@shared/ui';
import { DesignNavIcon } from '../../designIcons';
import styles from '../ProjectsPage.module.css';
import { ProjectNavRow } from './ProjectChromeViews';
import type { ProjectInfo } from './types';

export type ProjectNavProps = {
  projects: ProjectInfo[];
  projectsLoading?: boolean | undefined;
  projectsError?: string | undefined;
  activeProjectId: string | null;
  onProjectSelect: (projectId: string) => void;
  searchQuery?: string | undefined;
  onSearchChange?: ((query: string) => void) | undefined;
  canCreateProject: boolean;
  onStartCreate: () => void;
};

export function ProjectNav({
  projects,
  projectsLoading,
  projectsError,
  activeProjectId,
  onProjectSelect,
  searchQuery = '',
  onSearchChange,
  canCreateProject,
  onStartCreate,
}: ProjectNavProps): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);

  return (
    <aside className={`${styles.nav} workbench-nav project-nav`}>
      <div className={styles.navHeader}>
        <div className={`${styles.navTitle} workbench-title`}>{t('nav.projects')}</div>
        {canCreateProject ? (
          <button
            type="button"
            className={`${styles.newProjectBtn} ${styles.navNewProjectBtn} outline-action`}
            onClick={onStartCreate}
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
    </aside>
  );
}
