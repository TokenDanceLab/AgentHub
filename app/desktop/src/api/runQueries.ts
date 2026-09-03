// TanStack Query hooks for run lifecycle.
// Service-layer data (runs, run lists) managed by TanStack Query.
// Streaming data is normalized through the v4 shared transcript/event model.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { startRun, cancelRun, fetchRuns, decidePermission } from './edgeClient';
import type { PermissionDecideRequest } from './edgeClient';
import { RunInfoSchema, safeParse, listResponseSchema } from './schemas';
import { edgeQueryKeys } from '@shared/stores/queryKeys';
import { invalidateEdgeThreadTranscript } from './threadQueries';
import type { RunInfo, ListResponse, StartRunRequest } from '@shared/types';

// Terminal Edge run statuses (edge-server lifecycle: runs settle into
// completed/failed/cancelled; everything else is still cancellable).
// Unknown future statuses are treated as active on purpose — the stop
// affordance should rather show once too often than hide a live run.
const EDGE_RUN_TERMINAL_STATUSES = new Set([
  'completed',
  'finished',
  'failed',
  'cancelled',
  'canceled',
]);

/** Whether an Edge run status represents a run that is still active. */
export function isEdgeRunStatusActive(status: string): boolean {
  return !EDGE_RUN_TERMINAL_STATUSES.has(status);
}

/** First still-active run in the list, in server order. */
export function findActiveEdgeRun(runs: RunInfo[] | undefined): RunInfo | undefined {
  return (runs ?? []).find((run) => isEdgeRunStatusActive(run.status));
}

type RunQuerySnapshot = Array<[readonly unknown[], ListResponse<RunInfo> | undefined]>;

function snapshotRunQueries(qc: QueryClient): RunQuerySnapshot {
  return qc.getQueriesData<ListResponse<RunInfo>>({ queryKey: edgeQueryKeys.runs.root });
}

export function upsertRunInQueries(qc: QueryClient, run: RunInfo) {
  qc.setQueriesData<ListResponse<RunInfo>>({ queryKey: edgeQueryKeys.runs.root }, (current) => {
    if (!current) return { items: [run], page: { hasMore: false } };
    const idx = current.items.findIndex((r) => r.runId === run.runId);
    if (idx >= 0) {
      const items = [...current.items];
      items[idx] = run;
      return { ...current, items };
    }
    return { ...current, items: [run, ...current.items] };
  });
}

function restoreRunsSnapshot(qc: QueryClient, snapshot: RunQuerySnapshot | undefined) {
  if (!snapshot) return;
  for (const [queryKey, value] of snapshot) {
    qc.setQueryData(queryKey, value);
  }
}

export function updateRunStatusInQueries(
  qc: QueryClient,
  runId: string,
  status: string,
  overrides?: Partial<RunInfo>,
) {
  qc.setQueriesData<ListResponse<RunInfo>>({ queryKey: edgeQueryKeys.runs.root }, (current) => {
    if (!current) return current;
    return {
      ...current,
      items: current.items.map((r) =>
        r.runId === runId ? { ...r, status, ...overrides } : r,
      ),
    };
  });
}

export function useRuns(projectId?: string, threadId?: string, options: { enabled?: boolean } = {}) {
  return useQuery<ListResponse<RunInfo>>({
    queryKey: edgeQueryKeys.runs.all(projectId, threadId),
    queryFn: async () => {
      const raw = await fetchRuns(projectId, threadId);
      return safeParse(listResponseSchema(RunInfoSchema), raw, 'runs');
    },
    enabled: options.enabled ?? true,
    refetchInterval: 10_000,
  });
}

export function useCreateRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req?: StartRunRequest) => startRun(req),
    onMutate: async (req) => {
      await qc.cancelQueries({ queryKey: edgeQueryKeys.runs.root });
      const prev = snapshotRunQueries(qc);
      if (req) {
        const optimistic: RunInfo = {
          runId: `optimistic-${Date.now()}`,
          projectId: req.projectId ?? '',
          threadId: req.threadId ?? '',
          status: 'queued',
          createdAt: new Date().toISOString(),
        };
        upsertRunInQueries(qc, optimistic);
      }
      return { prev };
    },
    onSuccess: (run) => {
      upsertRunInQueries(qc, run);
    },
    onError: (_err, _req, ctx) => {
      restoreRunsSnapshot(qc, ctx?.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: edgeQueryKeys.runs.root });
      // threads.root reaches the thread LIST only — the transcript lives under
      // ['edge','threadItems',…], a prefix that root does not match (#2274 A-12).
      qc.invalidateQueries({ queryKey: edgeQueryKeys.threads.root });
      void invalidateEdgeThreadTranscript(qc);
    },
  });
}

export function useCancelRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => cancelRun(runId),
    onMutate: async (runId) => {
      await qc.cancelQueries({ queryKey: edgeQueryKeys.runs.root });
      const prev = snapshotRunQueries(qc);
      updateRunStatusInQueries(qc, runId, 'cancelled', { finishedAt: new Date().toISOString() });
      return { prev };
    },
    onSuccess: (run) => {
      upsertRunInQueries(qc, run);
    },
    onError: (_err, _vars, ctx) => {
      restoreRunsSnapshot(qc, ctx?.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: edgeQueryKeys.runs.root });
      // threads.root reaches the thread LIST only — the transcript lives under
      // ['edge','threadItems',…], a prefix that root does not match (#2274 A-12).
      qc.invalidateQueries({ queryKey: edgeQueryKeys.threads.root });
      void invalidateEdgeThreadTranscript(qc);
    },
  });
}

/**
 * Decide a pending Edge permission request for a local run
 * (`POST /v1/permissions/decide`). The `permission_result` block normally
 * arrives through the Edge event stream; the thread invalidation closes the
 * replay gap when the persisted transcript is reloaded before that happens.
 */
export function useDecideEdgePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: PermissionDecideRequest) => decidePermission(req),
    onSettled: () => {
      // The doc comment above names this invalidation as the thing that "closes
      // the replay gap when the persisted transcript is reloaded" — but
      // threads.root cannot reach the transcript key, so it never did
      // (#2274 A-12). The thread is not known here, hence the family-wide form.
      qc.invalidateQueries({ queryKey: edgeQueryKeys.threads.root });
      void invalidateEdgeThreadTranscript(qc);
    },
  });
}
