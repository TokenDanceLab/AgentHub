/* ═══════════════════════════════════════════════════════════════════════
   Projects left-nav shell — header, search, status, rows, filters.

   Extracted from ProjectsPage as Phase 20 residual thin #595.
   CSS remains on shared ProjectsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import { StatusNotice } from '@shared/ui';
import { DesignNavIcon } from '../../designIcons';
import styles from '../ProjectsPage.module.css';
import { FilterList, ProjectNavRow } from './ProjectChromeViews';
import type { ProjectFilter, ProjectInfo } from './types';

export type ProjectNavProps = {
  projects: ProjectInfo[];
  projectsLoading?: boolean | undefined;
  projectsError?: string | undefined;
  activeProjectId: string | null;
  onProjectSelect: (projectId: string) => void;
  searchQuery?: string | undefined;
  onSearchChange?: ((query: string) => void) | undefined;
  activeFilter: ProjectFilter;
  onFilterChange: (filter: ProjectFilter) => void;
  canCreateProject: boolean;
  onStartCreate: () => void;
  /** Whether more projects are available via pagination. */
  hasMore?: boolean | undefined;
  /** Whether a load-more page fetch is in flight. */
  loadingMore?: boolean | undefined;
  /** Triggered when the scroll sentinel enters the viewport. */
  onLoadMore?: (() => void) | undefined;
  /** Visible load-more failure (#1546). When set, pagination stopped and `onLoadMore` acts as explicit retry. */
  loadMoreError?: string | undefined;
};

export function ProjectNav({
  projects,
  projectsLoading,
  projectsError,
  activeProjectId,
  onProjectSelect,
  searchQuery = '',
  onSearchChange,
  activeFilter,
  onFilterChange,
  canCreateProject,
  onStartCreate,
  hasMore,
  loadingMore,
  onLoadMore,
  loadMoreError,
}: ProjectNavProps): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);

  // ── Infinite-scroll sentinel ──
  const sentinelRef = useRef<HTMLDivElement>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onLoadMoreRef.current?.();
        }
      },
      { rootMargin: '200px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore]);

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
      <div className={styles.navCaption}>视图</div>
      <FilterList activeFilter={activeFilter} onFilterChange={onFilterChange} />
      {/* Infinite-scroll sentinel: triggers loadMore when within 200px of viewport. */}
      <div
        ref={sentinelRef}
        className={styles.sentinel}
        role="status"
        aria-label={loadingMore ? t('projects.loading') : undefined}
      />
      {loadingMore ? (
        <StatusNotice
          {...(styles.statusNotice ? { className: styles.statusNotice } : {})}
          icon={<DesignNavIcon name="running" size={14} />}
          role="status"
        >
          {t('projects.loading')}
        </StatusNotice>
      ) : null}
      {loadMoreError ? (
        <div className={styles.statusStack} role="alert">
          <StatusNotice
            {...(styles.statusNotice ? { className: styles.statusNotice } : {})}
            icon={<DesignNavIcon name="error404" size={14} />}
          >
            {t('projects.loadMoreError', { message: loadMoreError })}
          </StatusNotice>
          {onLoadMore ? (
            <button
              type="button"
              className={`${styles.newProjectBtn} ${styles.navNewProjectBtn} outline-action`}
              onClick={onLoadMore}
            >
              {t('projects.retryLoadMore')}
            </button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
