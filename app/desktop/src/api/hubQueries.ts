// React Query hooks for Hub Server contacts and workspace projects.
// Thin wrappers around hubClient methods.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createHubClient } from '@/api/hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import { hubQueryKeys } from '@shared/stores/queryKeys';

// Lazy singleton — avoids creating the client on module load when Hub is not needed.
let _hubClient: ReturnType<typeof createHubClient> | null = null;
export function getHubClient() {
  if (!_hubClient) _hubClient = createHubClient({ getToken: getAccessToken });
  return _hubClient;
}

// ── Contacts ──────────────────────────────────────────────────────

export function useHubContacts(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: hubQueryKeys.contacts.root,
    queryFn: () => getHubClient().listContacts(),
    enabled: opts?.enabled ?? false,
  });
}

export function useHubSearchUser() {
  return useMutation({
    mutationFn: (query: string) => getHubClient().searchUser(query),
  });
}

export function useHubSendFriendRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, message }: { userId: string; message?: string }) =>
      getHubClient().sendFriendRequest(userId, message),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hubQueryKeys.contacts.root });
    },
  });
}

export function useHubAcceptFriendRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => getHubClient().acceptFriendRequest(requestId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hubQueryKeys.contacts.root });
    },
  });
}

export function useHubRejectFriendRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => getHubClient().rejectFriendRequest(requestId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hubQueryKeys.contacts.root });
    },
  });
}

export function useHubRemoveContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => getHubClient().removeContact(userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hubQueryKeys.contacts.root });
    },
  });
}

export function useHubBlockContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => getHubClient().blockContact(userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hubQueryKeys.contacts.root });
    },
  });
}

export function useHubUnblockContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => getHubClient().unblockContact(userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hubQueryKeys.contacts.root });
    },
  });
}

export function useHubUpdateContactRemark() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, remark }: { userId: string; remark: string }) =>
      getHubClient().updateContactRemark(userId, remark),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hubQueryKeys.contacts.root });
    },
  });
}

export function useHubCreateContactGroup() {
  return useMutation({
    mutationFn: ({ name, memberIds }: { name: string; memberIds: string[] }) =>
      getHubClient().createGroupSession({ name, member_ids: memberIds }),
  });
}

// ── Workspace Projects ────────────────────────────────────────────


export function useHubWorkspaceProjects(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: hubQueryKeys.projects.root,
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
