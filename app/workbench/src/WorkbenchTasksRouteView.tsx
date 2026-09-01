import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import type { WorkbenchProfileSource } from './profileRegistry';
import { DesignNavIcon } from './designIcons';
import { TasksPage } from './pages/TasksPage';
import type { WorkbenchTasksRoute } from './useWorkbenchTasksRoute';
import { buildTasksPageDerivedModel } from './workbenchTasksPageModel';
import type { TaskReviewMergePort } from './workbenchBoardColumns';
import type { AgentHubSurface } from '@shared/platform';
import {
  useWorkbenchTaskDeepLinkActions,
  useWorkbenchTaskDeepLinkSnapshot,
} from './workbenchTaskDeepLinks';
import styles from './AgentHubWorkbench.module.css';

export interface WorkbenchTasksRouteViewProps {
  tasksRoute: WorkbenchTasksRoute;
  realDataMode: boolean;
  profiles: WorkbenchProfileSource[];
  /**
   * Workbench surface (#1999): Hub-only surfaces state that merging needs
   * Desktop / Local Edge and never render merge controls.
   */
  platformSurface?: AgentHubSurface | undefined;
  /**
   * Real review-before-merge capability port (#1999). Never invented here;
   * absent port keeps approve/merge controls at zero (fail-closed).
   */
  reviewMergePort?: TaskReviewMergePort | null | undefined;
}

/** Thin tasks route shell: pure model + TasksPage prop wiring. */
export function WorkbenchTasksRouteView({
  tasksRoute,
  realDataMode,
  profiles,
  platformSurface,
  reviewMergePort,
}: WorkbenchTasksRouteViewProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const { t: tw } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const model = useMemo(
    () => buildTasksPageDerivedModel({
      t: tw,
      realDataMode,
      taskFilterActive: tasksRoute.taskFilterActive,
      taskGroupMode: tasksRoute.taskGroupMode,
      taskShowCreator: tasksRoute.taskShowCreator,
      taskSortMode: tasksRoute.taskSortMode,
      taskViewMode: tasksRoute.taskViewMode,
      visibleTasks: tasksRoute.visibleTasks,
    }),
    [
      realDataMode,
      tasksRoute.taskFilterActive,
      tasksRoute.taskGroupMode,
      tasksRoute.taskShowCreator,
      tasksRoute.taskSortMode,
      tasksRoute.taskViewMode,
      tasksRoute.visibleTasks,
    ],
  );

  // ── #1963 deep-link chrome ─────────────────────────────────────────────
  // Arriving from the conversation sidebar's task queue keeps a "back to
  // conversation" affordance; a selected task with a hosting conversation
  // offers the forward jump. Both trips go through the deep-link store, so
  // the shell applies navigation and the return trip stays available.
  const appliedDeepLink = useWorkbenchTaskDeepLinkSnapshot().applied;
  const deepLinkActions = useWorkbenchTaskDeepLinkActions();
  const arrivedFromConversation = appliedDeepLink?.direction === 'conversation-to-task';
  const selectedTask = tasksRoute.selectedTask;
  const canOpenHostingConversation = Boolean(selectedTask?.conversationId);

  return (
    <div className={styles.tasksDeepLinkHost}>
      {(arrivedFromConversation || canOpenHostingConversation) && (
        <div className={styles.tasksDeepLinkBar}>
          {arrivedFromConversation && (
            <button
              type="button"
              className={styles.tasksDeepLinkButton}
              onClick={() => deepLinkActions.back()}
            >
              <DesignNavIcon name="back" size={14} />
              <span>{t('taskQueue.backToConversation')}</span>
            </button>
          )}
          {canOpenHostingConversation && selectedTask && (
            <button
              type="button"
              className={styles.tasksDeepLinkButton}
              data-task-id={selectedTask.id}
              onClick={() => deepLinkActions.openConversationForTask(selectedTask)}
            >
              <DesignNavIcon name="chat" size={14} />
              <span>{t('taskQueue.openConversation')}</span>
            </button>
          )}
        </div>
      )}
      <TasksPage
        activePane={tasksRoute.tasksPane}
        activeFilterCount={model.activeFilterCount}
        comingSoonEmptyState={model.tasksComingSoon}
        crossProjectCount={model.crossProjectCount}
        // Mock/demo task rows stay available in non-real modes but are always
        // labeled as demo data (#1818).
        demoDataActive={!realDataMode}
        dueTodayCount={model.dueTodayCount}
        fieldConfigActive={model.fieldConfigActive}
        fieldConfigLabel={model.fieldConfigLabel}
        groupActive={model.groupActive}
        groupLabel={model.groupLabel}
        groups={tasksRoute.visibleTaskGroups}
        profiles={profiles}
        platformSurface={platformSurface}
        reviewMergePort={reviewMergePort}
        editingDraft={tasksRoute.editingTaskDraft}
        editingTaskId={tasksRoute.editingTaskId}
        incompleteCount={model.incompleteCount}
        hasMore={tasksRoute.hasMore}
        loadingMore={tasksRoute.loadingMore}
        onLoadMore={tasksRoute.onLoadMore}
        onAddTaskRow={realDataMode ? undefined : tasksRoute.handleCreateTask}
        onAssignSelectedTaskToMe={tasksRoute.handleAssignSelectedTaskToMe}
        onCycleSelectedTaskStatus={tasksRoute.handleCycleSelectedTaskStatus}
        onCreateTask={realDataMode ? undefined : tasksRoute.handleCreateTask}
        onCancelTaskEdit={tasksRoute.handleCancelTaskEdit}
        onDeleteSelectedTask={tasksRoute.handleDeleteSelectedTask}
        onEditDraftChange={tasksRoute.handleEditTaskDraftChange}
        onEditSelectedTask={tasksRoute.handleEditSelectedTask}
        onFilterBySelectedTaskAssignee={tasksRoute.handleFilterBySelectedTaskAssignee}
        onGroupBySelectedTaskProject={tasksRoute.handleGroupBySelectedTaskProject}
        onNewGroup={realDataMode ? undefined : tasksRoute.handleNewTaskGroup}
        onPaneChange={tasksRoute.handleTaskPaneChange}
        onTaskClick={tasksRoute.handleTaskClick}
        onSaveTaskEdit={tasksRoute.handleSaveTaskEdit}
        onTaskList={tasksRoute.handleTaskList}
        onToolbarFieldConfig={tasksRoute.handleToolbarFieldConfig}
        onToolbarFilter={tasksRoute.handleToolbarFilter}
        onToolbarGroup={tasksRoute.handleTaskGroup}
        onToolbarSort={tasksRoute.handleTaskSort}
        onViewModeChange={tasksRoute.setTaskViewMode}
        selectedTaskId={tasksRoute.selectedTaskId}
        selectedTask={tasksRoute.selectedTask}
        showCreatorColumn={tasksRoute.taskShowCreator}
        sortActive={model.sortActive}
        sortLabel={model.sortLabel}
        taskActionLabel={tasksRoute.taskActionLabel}
        viewMode={tasksRoute.taskViewMode}
      />
    </div>
  );
}
