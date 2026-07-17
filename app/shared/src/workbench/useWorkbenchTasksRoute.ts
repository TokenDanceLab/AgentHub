import { useMemo, useState } from 'react';
import type { TaskGroup, TasksPane, ViewMode } from './pages';
import type { TaskEditDraft } from './pages/TasksPage';
import {
  type TaskGroupMode,
  type TaskSortMode,
  buildTaskGroups,
  flattenTaskGroups,
} from './workbenchTaskGroups';
import {
  buildWorkbenchTasksRouteHandlers,
  resolveSourceTaskGroups,
  type UseWorkbenchTasksRouteOptions,
  type WorkbenchTasksRoute,
} from './workbenchTasksRouteHelpers';

export type {
  UseWorkbenchTasksRouteOptions,
  WorkbenchTasksRoute,
} from './workbenchTasksRouteHelpers';

export function useWorkbenchTasksRoute({
  realDataMode,
  currentUserId,
  userDisplayName,
}: UseWorkbenchTasksRouteOptions): WorkbenchTasksRoute {
  const [tasksPane, setTasksPane] = useState<TasksPane>('owned');
  const [taskViewMode, setTaskViewMode] = useState<ViewMode>('list');
  const [taskGroups, setTaskGroups] = useState<TaskGroup[]>([]);
  const [taskFilterActive, setTaskFilterActive] = useState(true);
  const [taskSortMode, setTaskSortMode] = useState<TaskSortMode>('custom');
  const [taskGroupMode, setTaskGroupMode] = useState<TaskGroupMode>('custom');
  const [taskShowCreator, setTaskShowCreator] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskNavMenuOpen, setTaskNavMenuOpen] = useState(false);
  const [taskActionLabel, setTaskActionLabel] = useState('筛选已启用');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskDraft, setEditingTaskDraft] = useState<TaskEditDraft | null>(null);
  const [localTaskCounter, setLocalTaskCounter] = useState(1);

  const sourceTaskGroups = resolveSourceTaskGroups(realDataMode, taskGroups);
  const visibleTaskGroups = useMemo(() => buildTaskGroups(
    sourceTaskGroups,
    tasksPane,
    taskFilterActive,
    taskSortMode,
    taskGroupMode,
    taskViewMode,
    currentUserId,
  ), [sourceTaskGroups, taskFilterActive, taskGroupMode, taskSortMode, taskViewMode, tasksPane, currentUserId]);
  const visibleTasks = flattenTaskGroups(visibleTaskGroups);
  const allTasks = flattenTaskGroups(sourceTaskGroups);
  const selectedTask = allTasks.find((task) => task.id === selectedTaskId) ?? null;

  const handlers = buildWorkbenchTasksRouteHandlers({
    taskGroups,
    selectedTask,
    editingTaskId,
    editingTaskDraft,
    localTaskCounter,
    ...(currentUserId !== undefined ? { currentUserId } : {}),
    ...(userDisplayName !== undefined ? { userDisplayName } : {}),
    setTasksPane,
    setTaskViewMode,
    setTaskGroups,
    setTaskFilterActive,
    setTaskSortMode,
    setTaskGroupMode,
    setTaskShowCreator,
    setSelectedTaskId,
    setTaskNavMenuOpen,
    setTaskActionLabel,
    setEditingTaskId,
    setEditingTaskDraft,
    setLocalTaskCounter,
  });

  return {
    tasksPane,
    taskViewMode,
    taskFilterActive,
    taskSortMode,
    taskGroupMode,
    taskShowCreator,
    selectedTaskId,
    taskNavMenuOpen,
    taskActionLabel,
    editingTaskId,
    editingTaskDraft,
    sourceTaskGroups,
    visibleTaskGroups,
    visibleTasks,
    selectedTask,
    setTaskViewMode,
    ...handlers,
  };
}
