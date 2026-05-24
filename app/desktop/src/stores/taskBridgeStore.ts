// Task bridge store — tracks Hub agent tasks that are bridged to Edge runs.
// Maintains taskId ↔ runId bidirectional mapping for the integration hook.

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export interface AgentTask {
  taskId: string;
  agentId: string;
  prompt: string;
  threadId?: string;
  runId?: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  dispatchPayload: Record<string, unknown>;
  error?: string;
  /** Timestamp when the dispatch was received. */
  createdAt: string;
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
        const next = {
          tasks: [...s.tasks, task],
          runToTask: task.runId
            ? { ...s.runToTask, [task.runId]: task.taskId }
            : s.runToTask,
        };
        return next;
      }),

    updateTask: (taskId, updates) =>
      set((s) => {
        const idx = s.tasks.findIndex((t) => t.taskId === taskId);
        if (idx < 0) return s;

        const oldTask = s.tasks[idx];
        const updated = { ...oldTask, ...updates };

        const newTasks = [...s.tasks];
        newTasks[idx] = updated;

        // Maintain runToTask index
        const newRunToTask = { ...s.runToTask };
        if (oldTask.runId && oldTask.runId !== updated.runId) {
          delete newRunToTask[oldTask.runId];
        }
        if (updated.runId) {
          newRunToTask[updated.runId] = taskId;
        }

        return { tasks: newTasks, runToTask: newRunToTask };
      }),

    removeTask: (taskId) =>
      set((s) => {
        const task = s.tasks.find((t) => t.taskId === taskId);
        if (!task) return s;

        const newRunToTask = { ...s.runToTask };
        if (task.runId) {
          delete newRunToTask[task.runId];
        }

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
