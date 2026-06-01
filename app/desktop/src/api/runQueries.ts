// TanStack Query hooks for run lifecycle.
// Service-layer data (runs, run lists) managed by TanStack Query.
// Streaming data (outputText, toolCalls, messages) stays in useChatMessages reducer.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { startRun, cancelRun, fetchRuns } from './edgeClient';
import { RunInfoSchema, safeParse, listResponseSchema } from './schemas';
import type { RunInfo, ListResponse, StartRunRequest } from '@shared/types';

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
