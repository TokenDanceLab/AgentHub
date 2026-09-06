// Task bridge store — tracks Hub agent tasks that are bridged to Edge runs.
// Maintains taskId ↔ runId bidirectional mapping for the integration hook.

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export type TaskCallbackOwner = 'edge' | 'desktop';

export interface AgentTask {
  taskId: string;
  agentId: string;
  prompt: string;
  threadId?: string;
  runId?: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  dispatchPayload: Record<string, unknown>;
  /** Explicit undefined clears a previous error through updateTask. */
  error?: string | undefined;
  /** Persistent output callback owner returned by Edge; unset until explicitly confirmed. */
  callbackOwner?: TaskCallbackOwner;
  /** Timestamp when the dispatch was received. */
  createdAt: string;
}

const MAX_TASK_HISTORY = 80;

function trimTaskHistory(tasks: AgentTask[]): AgentTask[] {
  if (tasks.length <= MAX_TASK_HISTORY) return tasks;
  const active = tasks.filter((task) => task.status === 'queued' || task.status === 'running');
  const terminal = tasks
    .filter((task) => task.status !== 'queued' && task.status !== 'running')
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return [...active, ...terminal.slice(0, Math.max(0, MAX_TASK_HISTORY - active.length))]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

function buildRunIndex(tasks: AgentTask[]): Record<string, string> {
  const index: Record<string, string> = {};
  for (const task of tasks) {
    if (task.runId) index[task.runId] = task.taskId;
  }
  return index;
}

interface TaskBridgeState {
  tasks: AgentTask[];
  /** Reverse index: runId → taskId for fast lookup. */
  runToTask: Record<string, string>;

  addTask: (task: AgentTask) => void;
  updateTask: (taskId: string, updates: Partial<AgentTask>) => void;
  removeTask: (taskId: string) => void;
  getTaskByRunId: (runId: string) => AgentTask | undefined;
  getRunByTaskId: (taskId: string) => string | undefined;
  /** Returns all tasks that are not yet done/failed. */
  getActiveTasks: () => AgentTask[];
  clear: () => void;
}

export const useTaskBridgeStore = create<TaskBridgeState>()(
  subscribeWithSelector((set, get) => ({
    tasks: [],
    runToTask: {},

    addTask: (task) =>
      set((s) => {
        // Deduplicate by taskId
        if (s.tasks.some((t) => t.taskId === task.taskId)) return s;
        const tasks = trimTaskHistory([...s.tasks, task]);
        return {
          tasks,
          runToTask: buildRunIndex(tasks),
        };
      }),

    updateTask: (taskId, updates) =>
      set((s) => {
        const idx = s.tasks.findIndex((t) => t.taskId === taskId);
        if (idx < 0) return s;

        const oldTask = s.tasks[idx];
        if (!oldTask) return s;
        const updated = { ...oldTask, ...updates };

        const newTasks = trimTaskHistory([...s.tasks.slice(0, idx), updated, ...s.tasks.slice(idx + 1)]);

        return { tasks: newTasks, runToTask: buildRunIndex(newTasks) };
      }),

    removeTask: (taskId) =>
      set((s) => {
        const task = s.tasks.find((t) => t.taskId === taskId);
        if (!task) return s;

        const newRunToTask = Object.fromEntries(
          Object.entries(s.runToTask).filter(([runId]) => runId !== task.runId),
        );

        return {
          tasks: s.tasks.filter((t) => t.taskId !== taskId),
          runToTask: newRunToTask,
        };
      }),

    getTaskByRunId: (runId) => {
      const { tasks, runToTask } = get();
      const taskId = runToTask[runId];
      if (!taskId) return undefined;
      return tasks.find((t) => t.taskId === taskId);
    },

    getRunByTaskId: (taskId) => {
      const task = get().tasks.find((t) => t.taskId === taskId);
      return task?.runId;
    },

    getActiveTasks: () => {
      return get().tasks.filter(
        (t) => t.status === 'queued' || t.status === 'running',
      );
    },

    clear: () => set({ tasks: [], runToTask: {} }),
  })),
);

export type { TaskBridgeState };
