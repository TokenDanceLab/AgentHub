import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListResponse, RunInfo } from '@shared/types';

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