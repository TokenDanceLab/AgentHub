/* ═══════════════════════════════════════════════════════════════════════
   Tasks main pane cluster — head, stats, view tabs, toolbar, selection,
   and task table.

   Extracted from TasksPage as Phase 20 residual thin #596.
   CSS remains on shared TasksPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '../../../i18n';
import { DesignNavIcon } from '../../designIcons';
import styles from '../TasksPage.module.css';
import { TaskSelectionStrip, TaskTable } from './TaskTableViews';
import { PANE_TITLES, StatCard, VIEW_MODES } from './shared';
import type { TasksPageProps } from './types';

export type TaskMainProps = Pick<
  TasksPageProps,
  | 'activePane'
  | 'viewMode'
  | 'onViewModeChange'
  | 'groups'
  | 'emptyStateLabel'
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
  profiles,
  selectedTask,
  taskActionLabel,
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
  const title = PANE_TITLES[activePane] ?? '我负责的';

  return (
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
  );
}
