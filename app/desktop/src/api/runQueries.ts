// TanStack Query hooks for run lifecycle.
// Service-layer data (runs, run lists) managed by TanStack Query.
// Streaming data is normalized through the v4 shared transcript/event model.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { startRun, cancelRun, fetchRuns } from './edgeClient';
import { RunInfoSchema, safeParse, listResponseSchema } from './schemas';
import type { RunInfo, ListResponse, StartRunRequest } from '@shared/types';

type RunQuerySnapshot = Array<[readonly unknown[], ListResponse<RunInfo> | undefined]>;

export function snapshotRunQueries(qc: QueryClient): RunQuerySnapshot {
  return qc.getQueriesData<ListResponse<RunInfo>>({ queryKey: ['runs'] });
}

export function upsertRunInQueries(qc: QueryClient, run: RunInfo) {
  qc.setQueriesData<ListResponse<RunInfo>>({ queryKey: ['runs'] }, (current) => {
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

export function restoreRunsSnapshot(qc: QueryClient, snapshot: RunQuerySnapshot | undefined) {
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
  qc.setQueriesData<ListResponse<RunInfo>>({ queryKey: ['runs'] }, (current) => {
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
    queryKey: ['runs', projectId, threadId],
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
      await qc.cancelQueries({ queryKey: ['runs'] });
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
      qc.invalidateQueries({ queryKey: ['runs'] });
      qc.invalidateQueries({ queryKey: ['threads'] });
      qc.invalidateQueries({ queryKey: ['threadItems'] });
    },
  });
}

export function useCancelRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => cancelRun(runId),
    onMutate: async (runId) => {
      await qc.cancelQueries({ queryKey: ['runs'] });
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
      qc.invalidateQueries({ queryKey: ['runs'] });
    },
  });
}
