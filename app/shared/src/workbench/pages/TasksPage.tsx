import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '../../i18n';
import { DesignNavIcon } from '../designIcons';
import styles from './TasksPage.module.css';
import {
  NAV_PRIMARY,
  NAV_QUICK,
  NavGlyph,
  PANE_TITLES,
  StatCard,
  TaskNavMenu,
  TaskSelectionStrip,
  TaskTable,
  VIEW_MODES,
} from './tasks';
import type { TasksPageProps } from './tasks';

/* ═══════════════════════════════════════════════════════════════════════
   TasksPage — pure presentational workbench page

   Subcomponents / types extracted under ./tasks for Phase 18 #571.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Public re-exports (preserve external consumers) ── */

export type {
  TaskStatus,
  TasksPane,
  ViewMode,
  TaskItem,
  TaskGroup,
  TaskEditDraft,
  TasksPageProps,
} from './tasks';

// ── Main component ──

export function TasksPage({
  activePane,
  onPaneChange,
  viewMode,
  onViewModeChange,
  groups,
  emptyStateLabel,
  profiles,
  selectedTask,
  taskActionLabel,
  navMenuOpen = false,
  editingTaskId = null,
  editingDraft = null,
  incompleteCount,
  dueTodayCount,
  crossProjectCount,
  activeFilterCount = 0,
  sortLabel = '排序：拖拽自定义',
  groupLabel = '分组：自定义分组',
  fieldConfigLabel = '字段配置',
  sortActive = false,
  groupActive = false,
  fieldConfigActive = false,
  showCreatorColumn = true,
  selectedTaskId = null,
  onCreateTask,
  onNavMore,
  onNewGroup,
  onTaskList,
  onTaskClick,
  onAddTaskRow,
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
}: TasksPageProps): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const title = PANE_TITLES[activePane] ?? '我负责的';

  return (
    <section className={`${styles.page} workbench tasks-page`}>
      {/* ── Left nav ── */}
      <aside className={`${styles.nav} workbench-nav`}>
        <div className={`${styles.navTitle} workbench-title`}>任务</div>

        <button
          type="button"
          className={`${styles.navMore} ${navMenuOpen ? styles.navMoreActive : ''}`}
          aria-label="任务更多操作"
          aria-expanded={navMenuOpen}
          onClick={onNavMore}
        >
          <DesignNavIcon name="more" size={16} />
        </button>
        <TaskNavMenu open={navMenuOpen} />

        {/* Primary nav: 我负责的 / 我关注的 / 动态 */}
        {NAV_PRIMARY.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`${styles.navRow} ${
              activePane === item.id ? styles.navRowActive : ''
            }`}
            onClick={() => onPaneChange(item.id)}
          >
            <NavGlyph name={item.icon} />
            {item.label}
            {item.badge != null && (
              <small className={styles.navBadge}>{item.badge}</small>
            )}
          </button>
        ))}

        <div className={styles.navDivider} />

        {/* Quick access: 全部 / 我创建的 / 我分配的 / 已完成 */}
        <div className={styles.navCaption}>快速访问</div>
        {NAV_QUICK.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`${styles.navRow} ${styles.navRowSlim} ${
              activePane === item.id
                ? styles.navRowActiveSoft
                : ''
            }`}
            onClick={() => onPaneChange(item.id)}
          >
            <NavGlyph name={item.icon} />
            {item.label}
          </button>
        ))}

        <div className={styles.navDivider} />

        <button
          type="button"
          className={`${styles.navRow} ${styles.navRowSlim}`}
          onClick={onTaskList}
        >
          <NavGlyph name="fileText" />
          {t('nav.tasks')}清单
          <small className={styles.navBadgePlus}>+</small>
        </button>

        <button
          type="button"
          className={`${styles.navRow} ${styles.navRowSlim}`}
          onClick={onNewGroup}
        >
          <NavGlyph name="plus" />
          新建分组
        </button>
      </aside>

      {/* ── Right main ── */}
      <main className={`${styles.main} workbench-main`}>
        {/* Head */}
        <div className={`${styles.head} workbench-head`}>
          <div>
            <h1 className={styles.headTitle}>{title}</h1>
            <p className={styles.headSubcopy}>
              跨项目任务中心；项目页只展示当前项目内任务和运行。
            </p>
          </div>
          <div className={styles.headActions}>
            <button type="button" className={`${styles.createBtn} btn btn-p`} onClick={onCreateTask}>
              {t('tasks.newTask')}
            </button>
            <button
              type="button"
              className={`${styles.iconBtn} icon-action`}
              aria-label="切换视图"
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
          <StatCard label="未完成" value={incompleteCount} />
          <StatCard label="今天截止" value={dueTodayCount} />
          <StatCard label="跨项目" value={crossProjectCount} />
        </div>

        {/* View tabs */}
        <div className={styles.viewTabs} role="tablist">
          {VIEW_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              role="tab"
              className={`${styles.viewTab} ${
                viewMode === mode.id ? styles.viewTabActive : ''
              }`}
              aria-selected={viewMode === mode.id}
              onClick={() => onViewModeChange(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <div className={`${styles.toolbar} task-toolbar`}>
          <button
            type="button"
            className={styles.toolbarBtn}
            onClick={onCreateTask}
          >
            <DesignNavIcon name="plus" size={15} />
            {t('tasks.newTask')}
          </button>
          <button
            type="button"
            className={`${styles.toolbarBtn} ${
              activeFilterCount > 0 ? styles.toolbarBtnActive : ''
            }`}
            onClick={onToolbarFilter}
          >
            <DesignNavIcon name="filter" size={15} />
            筛选{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
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
          {!selectedTask && taskActionLabel && taskActionLabel !== '筛选已启用' && (
            <span className={styles.toolbarStatus} role="status">{taskActionLabel}</span>
          )}
        </div>

        <TaskSelectionStrip
          actionLabel={taskActionLabel}
          task={selectedTask}
          onAssignToMe={onAssignSelectedTaskToMe}
          onCycleStatus={onCycleSelectedTaskStatus}
          onDelete={onDeleteSelectedTask}
          onEdit={onEditSelectedTask}
          onFilterByAssignee={onFilterBySelectedTaskAssignee}
          onGroupByProject={onGroupBySelectedTaskProject}
        />

        {/* Task table */}
        <TaskTable
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
      </main>
    </section>
  );
}
