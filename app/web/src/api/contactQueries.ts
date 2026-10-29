import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createHubClient } from './hubClient';
import { isHubAuthenticated } from '@/hooks/useAuth';
import { hubQueryKeys, webQueryKeys } from '@shared/stores/queryKeys';
import type { FriendRequestInfo, SearchResult } from './hubClient';

// Invalidations target the `webQueryKeys.contacts.root` / `sessions.root`
// families so they match the keys Web queries actually write, whatever the
// `hubReady` flag is (ADR-029 / #2261).
const contactsQueryKey = webQueryKeys.contacts.root;
// Friend requests are the one contact sub-resource Web caches under the shared
// `hub` namespace (`useListFriendRequests` below), so its key stays.
const friendRequestsQueryKey = hubQueryKeys.contacts.friendRequests;
export const sessionsQueryKey = webQueryKeys.sessions.root;

// ── Async helpers ──────────────────────────────────────────

export async function listFriendRequests(
  isAuthenticated: () => boolean = isHubAuthenticated,
): Promise<FriendRequestInfo[]> {
  const authenticated = isAuthenticated();
  if (!authenticated) return [];

  const client = createHubClient();
  return client.listFriendRequests();
}

export async function searchHubUser(
  query: string,
  isAuthenticated: () => boolean = isHubAuthenticated,
): Promise<SearchResult> {
  const authenticated = isAuthenticated();
  if (!authenticated) throw new Error('Hub session is required');

  const client = createHubClient();
  return client.searchUser(query);
}

export async function sendFriendRequest(
  params: { userId: string; message?: string },
  isAuthenticated: () => boolean = isHubAuthenticated,
): Promise<void> {
  const authenticated = isAuthenticated();
  if (!authenticated) throw new Error('Hub session is required');

  const client = createHubClient();
  await client.sendFriendRequest(params.userId, params.message);
}

export async function acceptFriendRequest(
  requestId: string,
  isAuthenticated: () => boolean = isHubAuthenticated,
): Promise<void> {
  const authenticated = isAuthenticated();
  if (!authenticated) throw new Error('Hub session is required');

  const client = createHubClient();
  await client.acceptFriendRequest(requestId);
}

export async function rejectFriendRequest(
  requestId: string,
  isAuthenticated: () => boolean = isHubAuthenticated,
): Promise<void> {
  const authenticated = isAuthenticated();
  if (!authenticated) throw new Error('Hub session is required');

  const client = createHubClient();
  await client.rejectFriendRequest(requestId);
}

export async function removeContact(
  userId: string,
  isAuthenticated: () => boolean = isHubAuthenticated,
): Promise<void> {
  const authenticated = isAuthenticated();
  if (!authenticated) throw new Error('Hub session is required');

  const client = createHubClient();
  await client.removeContact(userId);
}

export async function blockContact(
  userId: string,
  isAuthenticated: () => boolean = isHubAuthenticated,
): Promise<void> {
  const authenticated = isAuthenticated();
  if (!authenticated) throw new Error('Hub session is required');

  const client = createHubClient();
  await client.blockContact(userId);
}

export async function unblockContact(
  userId: string,
  isAuthenticated: () => boolean = isHubAuthenticated,
): Promise<void> {
  const authenticated = isAuthenticated();
  if (!authenticated) throw new Error('Hub session is required');

  const client = createHubClient();
  await client.unblockContact(userId);
}

export async function updateContactRemark(
  params: { userId: string; remark: string },
  isAuthenticated: () => boolean = isHubAuthenticated,
): Promise<void> {
  const authenticated = isAuthenticated();
  if (!authenticated) throw new Error('Hub session is required');

  const client = createHubClient();
  await client.updateContactRemark(params.userId, params.remark);
}

export async function createGroupSession(
  params: { name: string; memberIds: string[] },
  isAuthenticated: () => boolean = isHubAuthenticated,
): Promise<{ sessionId: string; type: string; created: boolean }> {
  const authenticated = isAuthenticated();
  if (!authenticated) throw new Error('Hub session is required');

  const client = createHubClient();
  const res = await client.createGroupSession({ name: params.name, member_ids: params.memberIds });
  return { sessionId: res.session_id, type: res.type, created: res.created };
}

// ── Query hooks ────────────────────────────────────────────

export function useListFriendRequests(options: { enabled: boolean }) {
  return useQuery<FriendRequestInfo[]>({
    queryKey: friendRequestsQueryKey,
    queryFn: () => listFriendRequests(),
    enabled: options.enabled,
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });
}

// ── Mutation hooks ─────────────────────────────────────────

export function useSearchHubUser() {
  return useMutation({
    mutationFn: (query: string) => searchHubUser(query),
  });
}

export function useSendFriendRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { userId: string; message?: string }) => sendFriendRequest(params),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: contactsQueryKey });
      void queryClient.invalidateQueries({ queryKey: friendRequestsQueryKey });
    },
  });
}

export function useAcceptFriendRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (requestId: string) => acceptFriendRequest(requestId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: contactsQueryKey });
      void queryClient.invalidateQueries({ queryKey: friendRequestsQueryKey });
    },
  });
}

export function useRejectFriendRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (requestId: string) => rejectFriendRequest(requestId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: friendRequestsQueryKey });
    },
  });
}

export function useRemoveContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => removeContact(userId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: contactsQueryKey });
    },
  });
}

export function useBlockContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => blockContact(userId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: contactsQueryKey });
    },
  });
}

export function useUnblockContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => unblockContact(userId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: contactsQueryKey });
    },
  });
}

export function useUpdateContactRemark() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { userId: string; remark: string }) => updateContactRemark(params),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: contactsQueryKey });
    },
  });
}

export function useCreateGroupSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { name: string; memberIds: string[] }) => createGroupSession(params),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
    },
  });
}
