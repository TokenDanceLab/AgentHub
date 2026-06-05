import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListResponse, RunInfo, StartRunRequest } from '@shared/types';

async function fetchRunsStub(_projectId?: string, _threadId?: string): Promise<ListResponse<RunInfo>> {
  return { items: [], page: { hasMore: false } };
}

export function useRuns(projectId?: string, threadId?: string) {
  return useQuery<ListResponse<RunInfo>>({
    queryKey: ['runs', projectId, threadId],
    queryFn: () => fetchRunsStub(projectId, threadId),
    refetchInterval: 10_000,
  });
}

export function useCreateRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_req?: StartRunRequest): Promise<RunInfo> => ({
      runId: `web-run-${Date.now()}`,
      projectId: _req?.projectId || 'web-preview',
      threadId: _req?.threadId || 'web-thread',
      status: 'queued',
      createdAt: new Date().toISOString(),
    }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['runs'] });
      qc.invalidateQueries({ queryKey: ['threads'] });
    },
  });
}

export function useCancelRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string): Promise<RunInfo> => ({
      runId,
      projectId: 'web-preview',
      threadId: 'web-thread',
      status: 'cancelled',
      finishedAt: new Date().toISOString(),
    }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['runs'] });
    },
  });
}