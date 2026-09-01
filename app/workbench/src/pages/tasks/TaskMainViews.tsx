/* ═══════════════════════════════════════════════════════════════════════
   Tasks main pane cluster — head, stats, view tabs, toolbar, selection,
   and task table.

   Extracted from TasksPage as Phase 20 residual thin #596.
   CSS remains on shared TasksPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import { StatusNotice } from '@shared/ui';
import { DesignNavIcon } from '../../designIcons';
import styles from '../TasksPage.module.css';
import { TaskSelectionStrip, TaskTable } from './TaskTableViews';
import { buildViewModes, paneTitle, StatCard } from './shared';
import type { TasksPageProps } from './types';
import { needsHubOnlyMergeNotice } from '../../workbenchBoardColumns';

export type TaskMainProps = Pick<
  TasksPageProps,
  | 'activePane'
  | 'viewMode'
  | 'onViewModeChange'
  | 'groups'
  | 'emptyStateLabel'
  | 'comingSoonEmptyState'
  | 'demoDataActive'
  | 'platformSurface'
  | 'reviewMergePort'
  | 'profiles'
  | 'selectedTask'
  | 'taskActionLabel'
  | 'editingTaskId'
  | 'editingDraft'
  | 'incompleteCount'
  | 'dueTodayCount'
  | 'crossProjectCount'
  | 'activeFilterCount'
  | 'sortLabel'
  | 'groupLabel'
  | 'fieldConfigLabel'
  | 'sortActive'
  | 'groupActive'
  | 'fieldConfigActive'
  | 'showCreatorColumn'
  | 'selectedTaskId'
  | 'hasMore'
  | 'loadingMore'
  | 'onLoadMore'
  | 'onCreateTask'
  | 'onAddTaskRow'
  | 'onTaskClick'
  | 'onToolbarFilter'
  | 'onToolbarSort'
  | 'onToolbarGroup'
  | 'onToolbarFieldConfig'
  | 'onCycleSelectedTaskStatus'
  | 'onAssignSelectedTaskToMe'
  | 'onGroupBySelectedTaskProject'
  | 'onFilterBySelectedTaskAssignee'
  | 'onEditSelectedTask'
  | 'onDeleteSelectedTask'
  | 'onEditDraftChange'
  | 'onSaveTaskEdit'
  | 'onCancelTaskEdit'
>;

export function TaskMain({
  activePane,
  viewMode,
  onViewModeChange,
  groups,
  emptyStateLabel,
  comingSoonEmptyState = false,
  demoDataActive = false,
  platformSurface,
  reviewMergePort,
  profiles,
  selectedTask,
  taskActionLabel,
  editingTaskId = null,
  editingDraft = null,
  incompleteCount,
  dueTodayCount,
  crossProjectCount,
  activeFilterCount = 0,
  sortLabel = '',
  groupLabel = '',
  fieldConfigLabel = '',
  sortActive = false,
  groupActive = false,
  fieldConfigActive = false,
  showCreatorColumn = true,
  selectedTaskId = null,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onCreateTask,
  onAddTaskRow,
  onTaskClick,
  onToolbarFilter,
  onToolbarSort,
  onToolbarGroup,
  onToolbarFieldConfig,
  onCycleSelectedTaskStatus,
  onAssignSelectedTaskToMe,
  onGroupBySelectedTaskProject,
  onFilterBySelectedTaskAssignee,
  onEditSelectedTask,
  onDeleteSelectedTask,
  onEditDraftChange,
  onSaveTaskEdit,
  onCancelTaskEdit,
}: TaskMainProps): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const title = paneTitle(t, activePane);

  // ── Roving tabindex for the view-mode tablist (#1823) ────────────────
  // One Tab stop for the strip; Arrow/Home/End move focus between the
  // 列表/看板/仪表盘 tabs without switching the mode (activation stays on
  // click/Enter, matching the #1835 TerminalPanel pattern).
  const viewTabsRef = useRef<HTMLDivElement>(null);
  const viewTabsId = useId();
  const [rovingViewId, setRovingViewId] = useState<string | null>(null);

  const handleViewTabsKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const tabButtons = viewTabsRef.current
      ? Array.from(viewTabsRef.current.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      : [];
    if (tabButtons.length === 0) return;
    const activeIndex = tabButtons.findIndex((button) => button === document.activeElement);
    // Focus on a non-tab stop is not part of the roving strip — arrow keys
    // should not hijack it (#1835 review).
    if (activeIndex < 0) return;
    let nextIndex: number | null;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (activeIndex + 1) % tabButtons.length;
        break;
      case 'ArrowLeft':
        nextIndex = (activeIndex - 1 + tabButtons.length) % tabButtons.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabButtons.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = tabButtons[nextIndex];
    target?.focus();
    setRovingViewId(target?.dataset.mode ?? null);
  }, []);

  // ── Infinite-scroll sentinel (T14 pattern; wired to the mock data-layer
  //    cursor pagination, #1510) ──
  const sentinelRef = useRef<HTMLDivElement>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;
    // Environments without IntersectionObserver (jsdom, legacy browsers)
    // fall back to the explicit "加载更多" button below.
    if (typeof IntersectionObserver === 'undefined') return;

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
    <main className={`${styles.main} workbench-main`}>
      {/* Head */}
      <div className={`${styles.head} workbench-head`}>
        <div>
          <div className={styles.headTitleRow}>
            <h1 className={styles.headTitle}>{title}</h1>
            {demoDataActive && (
              <span className={styles.demoBadge} data-demo-badge>
                {t('tasks.demoBadge')}
              </span>
            )}
          </div>
          <p className={styles.headSubcopy}>
            {t('tasks.taskCenter')}
          </p>
        </div>
        <div className={styles.headActions}>
          {/* Without a create handler (real data mode, no task backend yet)
              the button is omitted instead of rendering a dead control (#1818). */}
          {onCreateTask && (
            <button type="button" className={`${styles.createBtn} btn btn-p`} onClick={onCreateTask}>
              {t('tasks.newTask')}
            </button>
          )}
          <button
            type="button"
            className={`${styles.iconBtn} icon-action`}
            aria-label={t("aria.switchView")}
            onClick={() =>
              onViewModeChange(viewMode === 'list' ? 'board' : 'list')
            }
          >
            <DesignNavIcon name="grid" size={16} />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className={styles.stats}>
        <StatCard label={t('tasks.stat.incomplete')} value={incompleteCount} />
        <StatCard label={t('tasks.stat.dueToday')} value={dueTodayCount} />
        <StatCard label={t('tasks.stat.crossProject')} value={crossProjectCount} />
      </div>

      {/* View tabs */}
      <div
        className={styles.viewTabs}
        role="tablist"
        ref={viewTabsRef}
        onKeyDown={handleViewTabsKeyDown}
      >
        {buildViewModes(t).map((mode) => {
          const selected = viewMode === mode.id;
          const isTabStop = mode.id === (rovingViewId ?? viewMode);
          return (
            <button
              key={mode.id}
              type="button"
              role="tab"
              id={`${viewTabsId}-tab-${mode.id}`}
              aria-controls={`${viewTabsId}-panel`}
              aria-selected={selected}
              tabIndex={isTabStop ? 0 : -1}
              data-mode={mode.id}
              className={`${styles.viewTab} ${
                selected ? styles.viewTabActive : ''
              }`}
              onClick={() => {
                // #1823: click activation switches the view AND moves the
                // roving stop to it — otherwise Tab later returns to the
                // stale stop.
                setRovingViewId(mode.id);
                onViewModeChange(mode.id);
              }}
            >
              {mode.label}
            </button>
          );
        })}
      </div>

      {/* Tabpanel: toolbar + task surface controlled by the view tabs (#1823) */}
      <div
        role="tabpanel"
        id={`${viewTabsId}-panel`}
        aria-labelledby={`${viewTabsId}-tab-${viewMode}`}
      >
      {/* Toolbar */}
      <div className={`${styles.toolbar} task-toolbar`}>
        {onCreateTask && (
          <button
            type="button"
            className={styles.toolbarBtn}
            onClick={onCreateTask}
          >
            <DesignNavIcon name="plus" size={15} />
            {t('tasks.newTask')}
          </button>
        )}
        <button
          type="button"
          className={`${styles.toolbarBtn} ${
            activeFilterCount > 0 ? styles.toolbarBtnActive : ''
          }`}
          onClick={onToolbarFilter}
        >
          <DesignNavIcon name="filter" size={15} />
          {t('tasks.filter')}{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
        </button>
        <button
          type="button"
          className={`${styles.toolbarBtn} ${
            sortActive ? styles.toolbarBtnActive : ''
          }`}
          onClick={onToolbarSort}
        >
          {sortLabel}
        </button>
        <button
          type="button"
          className={`${styles.toolbarBtn} ${
            groupActive ? styles.toolbarBtnActive : ''
          }`}
          onClick={onToolbarGroup}
        >
          {groupLabel}
        </button>
        <button
          type="button"
          className={`${styles.toolbarBtn} ${
            fieldConfigActive ? styles.toolbarBtnActive : ''
          }`}
          onClick={onToolbarFieldConfig}
        >
          {fieldConfigLabel}
        </button>
        {!selectedTask && taskActionLabel && (
          <span className={styles.toolbarStatus} role="status">{taskActionLabel}</span>
        )}
      </div>

      <TaskSelectionStrip
        actionLabel={taskActionLabel}
        platformSurface={platformSurface}
        reviewMergePort={reviewMergePort}
        task={selectedTask}
        onAssignToMe={onAssignSelectedTaskToMe}
        onCycleStatus={onCycleSelectedTaskStatus}
        onDelete={onDeleteSelectedTask}
        onEdit={onEditSelectedTask}
        onFilterByAssignee={onFilterBySelectedTaskAssignee}
        onGroupByProject={onGroupBySelectedTaskProject}
      />

      {/* Hub-only honesty notice (#1999): Web/Mobile may show awaiting-review
          tasks but never merge them — merging needs Desktop / Local Edge. */}
      {needsHubOnlyMergeNotice({
        surface: platformSurface,
        statuses: groups.flatMap((group) => group.tasks.map((task) => task.status)),
      }) && (
        <StatusNotice
          icon={<DesignNavIcon name="laptop" size={14} />}
          role="status"
        >
          <span data-testid="tasks-hub-only-merge-notice">
            {t('tasks.board.hubOnlyMergeNotice')}
          </span>
        </StatusNotice>
      )}

      {/* Task table */}
      <TaskTable
        comingSoonEmptyState={comingSoonEmptyState}
        emptyStateLabel={emptyStateLabel}
        groups={groups}
        editingDraft={editingDraft}
        editingTaskId={editingTaskId}
        selectedTaskId={selectedTaskId}
        showCreatorColumn={showCreatorColumn}
        profiles={profiles}
        onAddRow={onAddTaskRow}
        onCancelEdit={onCancelTaskEdit}
        onEditDraftChange={onEditDraftChange}
        onSaveEdit={onSaveTaskEdit}
        onTaskClick={onTaskClick}
      />

      {/* ── Infinite-scroll load-more (mock data-layer cursor pagination,
              #1510; fallback button for environments without
              IntersectionObserver) ── */}
      {hasMore && !loadingMore ? (
        <button type="button" className={styles.loadMoreBtn} onClick={onLoadMore}>
          {t('tasks.loadMore')}
        </button>
      ) : null}
      <div
        ref={sentinelRef}
        className={styles.sentinel}
        role="status"
        aria-label={loadingMore ? t('tasks.loading') : undefined}
      />
      {loadingMore ? (
        <StatusNotice
          icon={<DesignNavIcon name="running" size={14} />}
          role="status"
        >
          {t('tasks.loading')}
        </StatusNotice>
      ) : null}
      </div>
    </main>
  );
}
