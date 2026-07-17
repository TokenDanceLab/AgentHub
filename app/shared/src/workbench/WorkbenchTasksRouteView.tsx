import React, { useMemo } from 'react';
import type { WorkbenchProfileSource } from './profileRegistry';
import { TasksPage } from './pages/TasksPage';
import type { WorkbenchTasksRoute } from './useWorkbenchTasksRoute';
import { buildTasksPageDerivedModel } from './workbenchTasksPageModel';

export interface WorkbenchTasksRouteViewProps {
  tasksRoute: WorkbenchTasksRoute;
  realDataMode: boolean;
  profiles: WorkbenchProfileSource[];
}

/** Thin tasks route shell: pure model + TasksPage prop wiring. */
export function WorkbenchTasksRouteView({
  tasksRoute,
  realDataMode,
  profiles,
}: WorkbenchTasksRouteViewProps): React.ReactElement {
  const model = useMemo(
    () => buildTasksPageDerivedModel({
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

  return (
    <TasksPage
      activePane={tasksRoute.tasksPane}
      activeFilterCount={model.activeFilterCount}
      crossProjectCount={model.crossProjectCount}
      dueTodayCount={model.dueTodayCount}
      fieldConfigActive={model.fieldConfigActive}
      fieldConfigLabel={model.fieldConfigLabel}
      emptyStateLabel={model.emptyStateLabel}
      groupActive={model.groupActive}
      groupLabel={model.groupLabel}
      groups={tasksRoute.visibleTaskGroups}
      profiles={profiles}
      editingDraft={tasksRoute.editingTaskDraft}
      editingTaskId={tasksRoute.editingTaskId}
      navMenuOpen={tasksRoute.taskNavMenuOpen}
      incompleteCount={model.incompleteCount}
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
      onNavMore={tasksRoute.handleNavMore}
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
  );
}
