import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TaskGroup, TasksPane, ViewMode } from './pages';
import type { TaskEditDraft } from './pages/TasksPage';
import {
  WORKBENCH_MOCK_PAGE_SIZE,
  WORKBENCH_MOCK_TASK_POOL,
  readMockCursorPage,
} from './mockData';
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
import {
  deriveActiveTaskQueue,
  publishWorkbenchTaskQueue,
  useWorkbenchTaskDeepLinkSnapshot,
} from './workbenchTaskDeepLinks';

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

  // ── Mock cursor pagination (#1510). In mock mode the task pool (larger
  //    than one page) is exposed as the "默认分组" source; the first page is
  //    loaded from the pool, loadMore appends the next page with an async
  //    cursor read. In realDataMode the parent owns taskGroups, so the
  //    pagination flags stay inert. ──
  const mockPaginationEnabled = !realDataMode;
  const firstTaskPage = useMemo(
    () => readMockCursorPage(WORKBENCH_MOCK_TASK_POOL, WORKBENCH_MOCK_PAGE_SIZE, undefined),
    [],
  );
  const [loadedTaskCount, setLoadedTaskCount] = useState(() => firstTaskPage.items.length);
  const [taskHasMore, setTaskHasMore] = useState(() => firstTaskPage.hasMore);
  const [taskLoadingMore, setTaskLoadingMore] = useState(false);
  const taskHasMoreRef = useRef(firstTaskPage.hasMore);
  const taskLoadingMoreRef = useRef(false);
  const taskCursorRef = useRef<string | undefined>(firstTaskPage.nextCursor);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const onLoadMore = useCallback(async () => {
    if (!mockPaginationEnabled || taskLoadingMoreRef.current) return;
    if (!taskHasMoreRef.current) return;
    taskLoadingMoreRef.current = true;
    setTaskLoadingMore(true);
    try {
      const page = await readMockCursorPage(
        WORKBENCH_MOCK_TASK_POOL,
        WORKBENCH_MOCK_PAGE_SIZE,
        taskCursorRef.current,
      );
      if (!mountedRef.current) return;
      setLoadedTaskCount((current) => current + page.items.length);
      taskCursorRef.current = page.nextCursor;
      taskHasMoreRef.current = page.hasMore;
      setTaskHasMore(page.hasMore);
    } finally {
      taskLoadingMoreRef.current = false;
      setTaskLoadingMore(false);
    }
  }, [mockPaginationEnabled]);

  const paginatedMockGroups = useMemo<TaskGroup[]>(
    () => [{ label: '默认分组', tasks: WORKBENCH_MOCK_TASK_POOL.slice(0, loadedTaskCount) }],
    [loadedTaskCount],
  );

  const sourceTaskGroups = resolveSourceTaskGroups(realDataMode, taskGroups, paginatedMockGroups);
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

  // ── #1963: sidebar task queue + deep-link focus adoption ──────────────
  // The sidebar 任务队列 group mirrors this route's live inventory while the
  // route is mounted; the shell hook seeds the queue only while it is not.
  const sidebarTaskQueue = useMemo(() => deriveActiveTaskQueue(allTasks), [allTasks]);
  useEffect(() => {
    publishWorkbenchTaskQueue(sidebarTaskQueue);
  }, [sidebarTaskQueue]);

  // Adopt the task selection requested by a conversation→task deep link (and
  // by the task→conversation back trip, which remounts this route). The
  // focus token changes per request, so re-linking the same task re-applies.
  const taskFocus = useWorkbenchTaskDeepLinkSnapshot().taskFocus;
  useEffect(() => {
    if (taskFocus) setSelectedTaskId(taskFocus.taskId);
  }, [taskFocus]);

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
    hasMore: mockPaginationEnabled ? taskHasMore : false,
    loadingMore: mockPaginationEnabled ? taskLoadingMore : false,
    onLoadMore: mockPaginationEnabled ? onLoadMore : undefined,
    setTaskViewMode,
    ...handlers,
  };
}
