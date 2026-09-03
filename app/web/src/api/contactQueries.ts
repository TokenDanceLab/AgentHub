import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createHubClient } from './hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import { hubQueryKeys } from '@shared/stores/queryKeys';
import type { FriendRequestInfo, SearchResult } from './hubClient';

const contactsQueryKey = hubQueryKeys.contacts.list;
const friendRequestsQueryKey = hubQueryKeys.contacts.friendRequests;
// The session list is a COLLECTION query, so it keys off `threads.list`, not
// the bare family root: root is the prefix used for broad invalidation, and
// using it as a query key is what made the same prefix mean "session list"
// here and "every transcript" on desktop (ADR-029 / #2261).
export const sessionsQueryKey = hubQueryKeys.threads.list;

// ── Async helpers ──────────────────────────────────────────

export async function listFriendRequests(
  getToken: () => string | null = getAccessToken,
): Promise<FriendRequestInfo[]> {
  const token = getToken();
  if (!token) return [];

  const client = createHubClient({ getToken: () => token });
  return client.listFriendRequests();
}

export async function searchHubUser(
  query: string,
  getToken: () => string | null = getAccessToken,
): Promise<SearchResult> {
  const token = getToken();
  if (!token) throw new Error('Hub session is required');

  const client = createHubClient({ getToken: () => token });
  return client.searchUser(query);
}

export async function sendFriendRequest(
  params: { userId: string; message?: string },
  getToken: () => string | null = getAccessToken,
): Promise<void> {
  const token = getToken();
  if (!token) throw new Error('Hub session is required');

  const client = createHubClient({ getToken: () => token });
  await client.sendFriendRequest(params.userId, params.message);
}

export async function acceptFriendRequest(
  requestId: string,
  getToken: () => string | null = getAccessToken,
): Promise<void> {
  const token = getToken();
  if (!token) throw new Error('Hub session is required');

  const client = createHubClient({ getToken: () => token });
  await client.acceptFriendRequest(requestId);
}

export async function rejectFriendRequest(
  requestId: string,
  getToken: () => string | null = getAccessToken,
): Promise<void> {
  const token = getToken();
  if (!token) throw new Error('Hub session is required');

  const client = createHubClient({ getToken: () => token });
  await client.rejectFriendRequest(requestId);
}

export async function removeContact(
  userId: string,
  getToken: () => string | null = getAccessToken,
): Promise<void> {
  const token = getToken();
  if (!token) throw new Error('Hub session is required');

  const client = createHubClient({ getToken: () => token });
  await client.removeContact(userId);
}

export async function blockContact(
  userId: string,
  getToken: () => string | null = getAccessToken,
): Promise<void> {
  const token = getToken();
  if (!token) throw new Error('Hub session is required');

  const client = createHubClient({ getToken: () => token });
  await client.blockContact(userId);
}

export async function unblockContact(
  userId: string,
  getToken: () => string | null = getAccessToken,
): Promise<void> {
  const token = getToken();
  if (!token) throw new Error('Hub session is required');

  const client = createHubClient({ getToken: () => token });
  await client.unblockContact(userId);
}

export async function updateContactRemark(
  params: { userId: string; remark: string },
  getToken: () => string | null = getAccessToken,
): Promise<void> {
  const token = getToken();
  if (!token) throw new Error('Hub session is required');

  const client = createHubClient({ getToken: () => token });
  await client.updateContactRemark(params.userId, params.remark);
}

export async function createGroupSession(
  params: { name: string; memberIds: string[] },
  getToken: () => string | null = getAccessToken,
): Promise<{ sessionId: string; type: string; created: boolean }> {
  const token = getToken();
  if (!token) throw new Error('Hub session is required');

  const client = createHubClient({ getToken: () => token });
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
