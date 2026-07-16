import { useEffect, useReducer } from 'react';
import {
  listApprovals,
  listArtifacts,
  listPreviews,
  listProjects,
  listRuns,
  listThreads,
  workbenchReducer,
  type WorkbenchState,
} from '@shared/index';

const initialWorkbenchProjectionState: WorkbenchState = {
  projects: [],
  threads: [],
  // Product catalog SSOT is projects/threads/runs/artifacts/approvals.
  // Edge runners remain diagnostics-only and are not loaded here.
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

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error || 'Edge catalog unavailable');
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = 2500): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Edge catalog did not respond.')), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function useWorkbenchProjection() {
  const [state, dispatch] = useReducer(
    workbenchReducer,
    initialWorkbenchProjectionState,
    (initialState) => workbenchReducer(initialState, { type: 'connection.loading' }),
  );

  useEffect(() => {
    let cancelled = false;

    async function loadSnapshot() {
      dispatch({ type: 'connection.loading' });
      try {
        // Product live catalog does not depend on Edge /v1/runners diagnostics.
        const [projects, threads, runs, approvals, artifacts, previews] =
          await withTimeout(Promise.all([
            listProjects({ pageSize: 50 }),
            listThreads({ pageSize: 50 }),
            listRuns({ pageSize: 50 }),
            listApprovals(),
            listArtifacts(),
            listPreviews(),
          ]));

        if (cancelled) return;

        dispatch({
          type: 'snapshot.loaded',
          snapshot: {
            projects,
            threads,
            runners: [],
            runs,
            approvals,
            artifacts,
            previews,
          },
        });
      } catch (error) {
        if (!cancelled) {
          dispatch({ type: 'connection.error', error: formatError(error) });
        }
      }
    }

    loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
