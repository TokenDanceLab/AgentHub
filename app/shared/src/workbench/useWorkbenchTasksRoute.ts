import { useMemo, useState } from 'react';
import type { TaskGroup, TaskItem, TasksPane, ViewMode } from './pages';
import type { TaskEditDraft } from './pages/TasksPage';
import { WORKBENCH_MOCK_TASK_GROUPS } from './mockData';
import {
  TASK_STATUS_SEQUENCE,
  type TaskGroupMode,
  type TaskSortMode,
  buildTaskGroups,
  createLocalTask,
  flattenTaskGroups,
} from './workbenchTaskGroups';

export interface UseWorkbenchTasksRouteOptions {
  realDataMode: boolean;
  currentUserId?: string | undefined;
  userDisplayName?: string | undefined;
}

export interface WorkbenchTasksRoute {
  tasksPane: TasksPane;
  taskViewMode: ViewMode;
  taskFilterActive: boolean;
  taskSortMode: TaskSortMode;
  taskGroupMode: TaskGroupMode;
  taskShowCreator: boolean;
  selectedTaskId: string | null;
  taskNavMenuOpen: boolean;
  taskActionLabel: string;
  editingTaskId: string | null;
  editingTaskDraft: TaskEditDraft | null;
  sourceTaskGroups: TaskGroup[];
  visibleTaskGroups: TaskGroup[];
  visibleTasks: TaskItem[];
  selectedTask: TaskItem | null;
  setTaskViewMode: (mode: ViewMode) => void;
  handleTaskPaneChange: (pane: TasksPane) => void;
  handleCreateTask: () => void;
  handleNewTaskGroup: () => void;
  handleTaskList: () => void;
  handleTaskSort: () => void;
  handleTaskGroup: () => void;
  handleEditSelectedTask: () => void;
  handleEditTaskDraftChange: (field: keyof TaskEditDraft, value: string) => void;
  handleSaveTaskEdit: () => void;
  handleCancelTaskEdit: () => void;
  handleDeleteSelectedTask: () => void;
  handleCycleSelectedTaskStatus: () => void;
  handleAssignSelectedTaskToMe: () => void;
  handleGroupBySelectedTaskProject: () => void;
  handleFilterBySelectedTaskAssignee: () => void;
  handleTaskClick: (task: TaskItem) => void;
  handleNavMore: () => void;
  handleToolbarFieldConfig: () => void;
  handleToolbarFilter: () => void;
}

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

  const sourceTaskGroups = realDataMode ? taskGroups : (taskGroups.length > 0 ? taskGroups : WORKBENCH_MOCK_TASK_GROUPS);
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

  function handleTaskPaneChange(pane: TasksPane): void {
    setTasksPane(pane);
    setSelectedTaskId(null);
    setEditingTaskId(null);
    setEditingTaskDraft(null);
    setTaskNavMenuOpen(false);
    setTaskActionLabel(`已切换到${pane === 'owned' ? '我负责的' : pane === 'watching' ? '我关注的' : pane === 'activity' ? '动态' : pane === 'done' ? '已完成' : '任务视图'}`);
  }

  function handleCreateTask(): void {
    const nextTask = createLocalTask(localTaskCounter);
    setLocalTaskCounter((current) => current + 1);
    setTaskGroups((current) => {
      const [first, ...rest] = current;
      if (!first) return [{ label: '默认分组', tasks: [nextTask] }];
      return [{ ...first, tasks: [nextTask, ...first.tasks] }, ...rest];
    });
    setTasksPane('owned');
    setTaskViewMode('list');
    setSelectedTaskId(nextTask.id);
    setEditingTaskId(nextTask.id);
    setEditingTaskDraft({
      title: nextTask.title,
      project: nextTask.project,
      assignee: nextTask.assignee,
      startTime: nextTask.startTime,
      dueDate: nextTask.dueDate,
      creator: nextTask.creator,
    });
    setTaskActionLabel(`已创建 ${nextTask.title}`);
  }

  function handleNewTaskGroup(): void {
    const nextIndex = taskGroups.length + 1;
    setTaskGroups((current) => [...current, { label: `自定义分组 ${nextIndex}`, tasks: [] }]);
    setTaskGroupMode('custom');
    setTaskViewMode('list');
    setTaskActionLabel(`已创建自定义分组 ${nextIndex}`);
  }

  function handleTaskList(): void {
    setTaskViewMode('list');
    setTaskGroupMode('custom');
    setTaskNavMenuOpen(false);
    setTaskActionLabel('已回到任务清单');
  }

  function handleTaskSort(): void {
    setTaskSortMode((current) => {
      const next = current === 'custom' ? 'due' : 'custom';
      setTaskActionLabel(next === 'due' ? '已按截止时间排序' : '已恢复拖拽自定义排序');
      return next;
    });
  }

  function handleTaskGroup(): void {
    setTaskGroupMode((current) => (
      current === 'custom' ? 'project' : current === 'project' ? 'status' : 'custom'
    ));
    setTaskActionLabel('已切换任务分组方式');
  }

  function updateTask(taskId: string, patch: Partial<TaskItem>): void {
    setTaskGroups((current) => current.map((group) => ({
      ...group,
      tasks: group.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
    })));
  }

  function startTaskEdit(task: TaskItem): void {
    setSelectedTaskId(task.id);
    setEditingTaskId(task.id);
    setEditingTaskDraft({
      title: task.title,
      project: task.project,
      assignee: task.assignee,
      startTime: task.startTime,
      dueDate: task.dueDate,
      creator: task.creator,
    });
    setTaskViewMode('list');
    setTaskActionLabel(`正在编辑 ${task.title}`);
  }

  function handleEditSelectedTask(): void {
    if (!selectedTask) {
      setTaskActionLabel('请先选择任务');
      return;
    }
    startTaskEdit(selectedTask);
  }

  function handleEditTaskDraftChange(field: keyof TaskEditDraft, value: string): void {
    setEditingTaskDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  function handleSaveTaskEdit(): void {
    if (!editingTaskId || !editingTaskDraft) {
      setTaskActionLabel('没有正在编辑的任务');
      return;
    }
    const title = editingTaskDraft.title.trim() || '未命名任务';
    const nextDraft = { ...editingTaskDraft, title };
    updateTask(editingTaskId, nextDraft);
    setEditingTaskId(null);
    setEditingTaskDraft(null);
    setTaskActionLabel(`${title} 已保存`);
  }

  function handleCancelTaskEdit(): void {
    if (editingTaskDraft) {
      setTaskActionLabel('已取消编辑');
    }
    setEditingTaskId(null);
    setEditingTaskDraft(null);
  }

  function handleDeleteSelectedTask(): void {
    if (!selectedTask) {
      setTaskActionLabel('请先选择任务');
      return;
    }
    const deletedTitle = selectedTask.title;
    setTaskGroups((current) => current
      .map((group) => ({
        ...group,
        tasks: group.tasks.filter((task) => task.id !== selectedTask.id),
      }))
      .filter((group) => group.tasks.length > 0 || group.label.startsWith('自定义分组')));
    setSelectedTaskId(null);
    setEditingTaskId(null);
    setEditingTaskDraft(null);
    setTaskActionLabel(`${deletedTitle} 已删除`);
  }

  function handleCycleSelectedTaskStatus(): void {
    if (!selectedTask) {
      setTaskActionLabel('请先选择任务');
      return;
    }
    const currentIndex = TASK_STATUS_SEQUENCE.indexOf(selectedTask.status ?? TASK_STATUS_SEQUENCE[0]!);
    const nextStatus = TASK_STATUS_SEQUENCE[(currentIndex + 1) % TASK_STATUS_SEQUENCE.length]
      ?? TASK_STATUS_SEQUENCE[0]!;
    updateTask(selectedTask.id, { status: nextStatus });
    setTaskActionLabel(`${selectedTask.title} 已推进到 ${nextStatus}`);
  }

  function handleAssignSelectedTaskToMe(): void {
    if (!selectedTask) {
      setTaskActionLabel('请先选择任务');
      return;
    }
    updateTask(selectedTask.id, { assignee: userDisplayName ?? currentUserId ?? '当前用户' });
    setTaskActionLabel(`${selectedTask.title} 已指派给 ${userDisplayName ?? '当前用户'}`);
  }

  function handleGroupBySelectedTaskProject(): void {
    if (!selectedTask) {
      setTaskActionLabel('请先选择任务');
      return;
    }
    setTaskGroupMode('project');
    setTaskViewMode('list');
    setTaskActionLabel(`已按项目查看：${selectedTask.project}`);
  }

  function handleFilterBySelectedTaskAssignee(): void {
    if (!selectedTask) {
      setTaskActionLabel('请先选择任务');
      return;
    }
    setTasksPane(selectedTask.assignee === currentUserId ? 'owned' : 'all');
    setTaskFilterActive(false);
    setTaskActionLabel(`当前负责人：${selectedTask.assignee}`);
  }

  function handleTaskClick(task: TaskItem): void {
    setSelectedTaskId(task.id);
    if (editingTaskId && editingTaskId !== task.id) {
      setEditingTaskId(null);
      setEditingTaskDraft(null);
    }
    setTaskActionLabel(`已选中 ${task.title}`);
  }

  function handleNavMore(): void {
    setTaskNavMenuOpen((current) => !current);
    setTaskActionLabel('任务更多操作');
  }

  function handleToolbarFieldConfig(): void {
    setTaskShowCreator((current) => {
      setTaskActionLabel(current ? '已隐藏创建人字段' : '已显示创建人字段');
      return !current;
    });
  }

  function handleToolbarFilter(): void {
    setTaskFilterActive((current) => {
      setTaskActionLabel(current ? '已关闭筛选' : '筛选已启用');
      return !current;
    });
  }

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
    handleTaskPaneChange,
    handleCreateTask,
    handleNewTaskGroup,
    handleTaskList,
    handleTaskSort,
    handleTaskGroup,
    handleEditSelectedTask,
    handleEditTaskDraftChange,
    handleSaveTaskEdit,
    handleCancelTaskEdit,
    handleDeleteSelectedTask,
    handleCycleSelectedTaskStatus,
    handleAssignSelectedTaskToMe,
    handleGroupBySelectedTaskProject,
    handleFilterBySelectedTaskAssignee,
    handleTaskClick,
    handleNavMore,
    handleToolbarFieldConfig,
    handleToolbarFilter,
  };
}
