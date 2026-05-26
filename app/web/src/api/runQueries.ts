import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cancelRun, fetchRuns, startRun } from './edgeClient';
import type { ListResponse, RunInfo, StartRunRequest } from '@shared/types';

export function useRuns(projectId?: string, threadId?: string) {
  return useQuery<ListResponse<RunInfo>>({
    queryKey: ['runs', projectId, threadId],
    queryFn: () => fetchRuns(projectId, threadId),
    refetchInterval: 10_000,
  });
}

export function useCreateRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req?: StartRunRequest) => startRun(req),
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
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['runs'] });
    },
  });
}
