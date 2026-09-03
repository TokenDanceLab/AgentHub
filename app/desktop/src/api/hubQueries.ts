// React Query hooks for Hub Server contacts and workspace projects.
// Thin wrappers around hubClient methods.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createHubClient } from '@/api/hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import { fetchAllPages } from '@shared/hub/paginate';
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


// Derived from the client itself so the paging loop below cannot drift from
// what listWorkspaceProjects actually returns.
type WorkspaceProjectListResponse =
  Awaited<ReturnType<ReturnType<typeof getHubClient>['listWorkspaceProjects']>>;

export async function fetchWorkspaceProjects(): Promise<WorkspaceProjectListResponse> {
  // Canonical Hub list contract (pageSize 200 x 5 pages, cap reported via
  // hasMore) — see @shared/hub/paginate (#2290). Desktop used to call
  // listWorkspaceProjects() with no parameters at all, so it got the server
  // default of 50 and dropped the cursor.
  return fetchAllPages(getHubClient().listWorkspaceProjects);
}

export function useHubWorkspaceProjects(opts?: { enabled?: boolean }) {
  return useQuery({
    // Collection queries key off projects.list, never off the bare family root:
    // the root is the prefix used for broad invalidation, and using it as a
    // query key is what made the two invalidations below impossible to hit
    // (ADR-029 / #2261). Web already keys its projects collection this way, so
    // this also removes a two-shell divergence over the same endpoint.
    queryKey: hubQueryKeys.projects.list('hub'),
    queryFn: () => fetchWorkspaceProjects(),
    enabled: opts?.enabled ?? false,
  });
}

export function useCreateHubWorkspaceProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<ReturnType<typeof getHubClient>['createWorkspaceProject']>[0]) =>
      getHubClient().createWorkspaceProject(data),
    onSuccess: () => {
      // ['hub','workspace-projects'] matched nothing: the collection is keyed
      // ['hub','projects','hub'], so creating/updating a project left the
      // list stale until a manual refetch. The family root is the prefix of
      // every projects key, so it invalidates the list and any cached
      // project detail / threads (#2290, same failure mode as #2261).
      void queryClient.invalidateQueries({ queryKey: hubQueryKeys.projects.root });
    },
  });
}

export function useUpdateHubWorkspaceProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<ReturnType<typeof getHubClient>['updateWorkspaceProject']>[1] }) =>
      getHubClient().updateWorkspaceProject(id, data),
    onSuccess: () => {
      // ['hub','workspace-projects'] matched nothing: the collection is keyed
      // ['hub','projects','hub'], so creating/updating a project left the
      // list stale until a manual refetch. The family root is the prefix of
      // every projects key, so it invalidates the list and any cached
      // project detail / threads (#2290, same failure mode as #2261).
      void queryClient.invalidateQueries({ queryKey: hubQueryKeys.projects.root });
    },
  });
}
