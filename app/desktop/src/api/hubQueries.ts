// React Query hooks for Hub Server contacts and workspace projects.
// Thin wrappers around hubClient methods.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getHubClient } from '@/api/hubClient';

// ── Contacts ──────────────────────────────────────────────────────

export function useHubContacts(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['hub', 'contacts'],
    queryFn: () => getHubClient().listContacts(),
    enabled: opts?.enabled ?? false,
  });
}

// ── Workspace Projects ────────────────────────────────────────────

export interface WorkspaceProjectPage {
  items: Awaited<ReturnType<ReturnType<typeof getHubClient>['listWorkspaceProjects']>>['items'];
  nextPageCursor?: string;
}

export function useHubWorkspaceProjects(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['hub', 'workspace-projects'],
    queryFn: () => getHubClient().listWorkspaceProjects(),
    enabled: opts?.enabled ?? false,
  });
}

export function useCreateHubWorkspaceProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<ReturnType<typeof getHubClient>['createWorkspaceProject']>[0]) =>
      getHubClient().createWorkspaceProject(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'workspace-projects'] });
    },
  });
}

export function useUpdateHubWorkspaceProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<ReturnType<typeof getHubClient>['updateWorkspaceProject']>[1] }) =>
      getHubClient().updateWorkspaceProject(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'workspace-projects'] });
    },
  });
}
