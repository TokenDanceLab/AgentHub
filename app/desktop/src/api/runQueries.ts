// TanStack Query hooks for run lifecycle.
// Service-layer data (runs, run lists) managed by TanStack Query.
// Streaming data (outputText, toolCalls, messages) stays in useChatMessages reducer.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { startRun, cancelRun, fetchRuns } from './edgeClient';
import { RunInfoSchema, safeParse, listResponseSchema } from './schemas';
import type { RunInfo, ListResponse, StartRunRequest } from '@shared/types';

export function useRuns(projectId?: string, threadId?: string) {
  return useQuery<ListResponse<RunInfo>>({
    queryKey: ['runs', projectId, threadId],
    queryFn: async () => {
      const raw = await fetchRuns(projectId, threadId);
      return safeParse(listResponseSchema(RunInfoSchema), raw, 'runs');
    },
    refetchInterval: 10_000,
  });
}

export function useCreateRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req?: StartRunRequest) => startRun(req),
    onMutate: async (req) => {
      await qc.cancelQueries({ queryKey: ['runs'] });
      const prev = qc.getQueryData<ListResponse<RunInfo>>(['runs']);
      if (prev && req) {
        const optimistic: RunInfo = {
          runId: `optimistic-${Date.now()}`,
          projectId: req.projectId ?? '',
          threadId: req.threadId ?? '',
          status: 'queued',
          createdAt: new Date().toISOString(),
        };
        qc.setQueryData<ListResponse<RunInfo>>(['runs'], {
          ...prev,
          items: [...prev.items, optimistic],
        });
      }
      return { prev };
    },
    onError: (_err, _req, ctx) => {
      if (ctx?.prev) qc.setQueryData(['runs'], ctx.prev);
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
      const prev = qc.getQueryData<ListResponse<RunInfo>>(['runs']);
      if (prev) {
        qc.setQueryData<ListResponse<RunInfo>>(['runs'], {
          ...prev,
          items: prev.items.map((r) =>
            r.runId === runId ? { ...r, status: 'cancelled' } : r,
          ),
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['runs'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['runs'] });
    },
  });
}
