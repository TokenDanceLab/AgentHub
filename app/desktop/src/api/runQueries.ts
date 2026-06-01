// TanStack Query hooks for run lifecycle.
// Service-layer data (runs, run lists) managed by TanStack Query.
// Streaming data (outputText, toolCalls, messages) stays in useChatMessages reducer.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { startRun, cancelRun, fetchRuns } from './edgeClient';
import { RunInfoSchema, safeParse, listResponseSchema } from './schemas';
import type { RunInfo, ListResponse, StartRunRequest } from '@shared/types';

type RunPatch = Partial<RunInfo> & { runId: string };
type RunsSnapshot = Array<[QueryKey, ListResponse<RunInfo> | undefined]>;

function queryFilterMatchesRun(queryKey: QueryKey, run: RunPatch, current?: RunInfo): boolean {
  const [, projectFilter, threadFilter] = queryKey;
  const projectId = run.projectId ?? current?.projectId;
  const threadId = run.threadId ?? current?.threadId;
  if (typeof projectFilter === 'string' && projectFilter && projectId && projectId !== projectFilter) return false;
  if (typeof threadFilter === 'string' && threadFilter && threadId && threadId !== threadFilter) return false;
  if (typeof projectFilter === 'string' && projectFilter && !projectId) return false;
  if (typeof threadFilter === 'string' && threadFilter && !threadId) return false;
  return true;
}

function restoreRunsSnapshot(qc: QueryClient, snapshot: RunsSnapshot | undefined) {
  snapshot?.forEach(([key, value]) => qc.setQueryData(key, value));
}

export function snapshotRunQueries(qc: QueryClient): RunsSnapshot {
  return qc.getQueriesData<ListResponse<RunInfo>>({ queryKey: ['runs'] });
}

export function upsertRunInQueries(qc: QueryClient, patch: RunPatch) {
  const entries = qc.getQueriesData<ListResponse<RunInfo>>({ queryKey: ['runs'] });
  for (const [key, data] of entries) {
    if (!data) continue;
    const existing = data.items.find((run) => run.runId === patch.runId);
    if (!queryFilterMatchesRun(key, patch, existing)) continue;
    const items = existing
      ? data.items.map((run) => (run.runId === patch.runId ? { ...run, ...patch } : run))
      : [{ projectId: '', threadId: '', status: 'queued', ...patch }, ...data.items];
    qc.setQueryData<ListResponse<RunInfo>>(key, { ...data, items });
  }
}

export function updateRunStatusInQueries(
  qc: QueryClient,
  runId: string,
  status: string,
  timestamps: Partial<Pick<RunInfo, 'startedAt' | 'finishedAt'>> = {},
) {
  const entries = qc.getQueriesData<ListResponse<RunInfo>>({ queryKey: ['runs'] });
  for (const [key, data] of entries) {
    if (!data?.items.some((run) => run.runId === runId)) continue;
    qc.setQueryData<ListResponse<RunInfo>>(key, {
      ...data,
      items: data.items.map((run) =>
        run.runId === runId ? { ...run, status, ...timestamps } : run,
      ),
    });
  }
}

export function useRuns(projectId?: string, threadId?: string) {
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
