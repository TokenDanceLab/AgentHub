import { applyEvent } from './workbenchStateApplyEvent';
import {
  compact,
  isEmptyWorkbenchData,
  list,
  mergeByKey,
  normalizeSnapshot,
} from './workbenchStateHelpers';
import type {
  WorkbenchAction,
  WorkbenchSnapshot,
  WorkbenchState,
} from './workbenchStateTypes';

export type {
  WorkbenchAction,
  WorkbenchConnectionStatus,
  WorkbenchSnapshot,
  WorkbenchSnapshotData,
  WorkbenchState,
} from './workbenchStateTypes';

export const initialWorkbenchState: WorkbenchState = {
  projects: [],
  threads: [],
  runners: [],
  runs: [],
  threadItems: [],
  approvals: [],
  artifacts: [],
  previews: [],
  runLogs: {},
  connection: { status: 'idle' },
  lastSeq: 0,
};

export function createWorkbenchState(
  snapshot?: WorkbenchSnapshot | null,
): WorkbenchState {
  return workbenchReducer(
    initialWorkbenchState,
    snapshot === undefined
      ? { type: 'snapshot.loaded' }
      : { type: 'snapshot.loaded', snapshot },
  );
}

export function workbenchReducer(
  state: WorkbenchState,
  action: WorkbenchAction,
): WorkbenchState {
  switch (action.type) {
    case 'snapshot.loaded': {
      const snapshot = normalizeSnapshot(action.snapshot);
      if (isEmptyWorkbenchData(state)) {
        return {
          ...state,
          ...snapshot,
          connection: { status: 'connected' },
        };
      }

      return {
        ...state,
        projects: mergeByKey(snapshot.projects, state.projects, (project) => project.id),
        threads: mergeByKey(snapshot.threads, state.threads, (thread) => thread.id),
        runners: mergeByKey(snapshot.runners, state.runners, (runner) => runner.id),
        runs: mergeByKey(snapshot.runs, state.runs, (run) => run.runId),
        threadItems: mergeByKey(snapshot.threadItems, state.threadItems, (item) => item.id),
        approvals: mergeByKey(snapshot.approvals, state.approvals, (approval) => approval.id),
        artifacts: mergeByKey(snapshot.artifacts, state.artifacts, (artifact) => artifact.id),
        previews: mergeByKey(snapshot.previews, state.previews, (preview) => preview.id),
        runLogs: { ...snapshot.runLogs, ...state.runLogs },
        connection: { status: 'connected' },
      };
    }
    case 'threadItems.loaded':
      return {
        ...state,
        threadItems: compact(list(action.threadItems)),
      };
    case 'connection.loading':
      return {
        ...state,
        connection: { status: 'loading' },
      };
    case 'connection.connected':
      return {
        ...state,
        connection: { status: 'connected' },
      };
    case 'connection.disconnected':
      return {
        ...state,
        connection: {
          status: 'disconnected',
          ...(action.error ? { error: action.error } : {}),
        },
      };
    case 'connection.error':
      return {
        ...state,
        connection: { status: 'error', error: action.error },
      };
    case 'event.received':
      return applyEvent(state, action.event);
    default:
      return state;
  }
}
