// Typed REST client for Hub Server.
// Handles JWT auth header injection, error parsing, and typed endpoints.
// Covers all routes defined in hub-server/internal/router/router.go.
//
// Uses the same error convention as edgeClient.ts: AppError from @shared/errors.

import { HUB_URL } from '@/config';
import { AppError, parseError } from '@shared/errors';

// ── Types ─────────────────────────────────────────

export interface RegisterRequest {
  username: string;
  password: string;
  nickname: string;
}

export interface LoginRequest {
  username: string;
  password: string;
  device_type: string;
  device_id: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface UserProfile {
  id: string;
  username: string;
  nickname: string;
  avatar_url: string;
  created_at?: string;
}

// ── Contacts ─────────────────────────────────────

export interface SearchResult {
  user_id: string;
  username: string;
  nickname: string;
  avatar_url?: string;
  relationship: string;
}

export interface FriendRequestInfo {
  request_id: string;
  user_id: string;
  username: string;
  nickname: string;
  avatar_url?: string;
  message: string;
  created_at: string;
}

export interface ContactInfo {
  user_id: string;
  username: string;
  nickname: string;
  avatar_url?: string;
  remark?: string;
  online: boolean;
  type: string;
}

export interface Contact {
  id: string;
  user_id: string;
  friend_id: string;
  status: string;
  remark?: string;
  friend?: UserProfile;
  created_at?: string;
}

// ── Sessions ─────────────────────────────────────

export interface Session {
  id: string;
  type: string;
  name?: string;
  owner_user_id: string;
  last_message?: Record<string, unknown>;
  members?: SessionMember[];
  created_at?: string;
  updated_at?: string;
}

export interface SessionMember {
  id: string;
  session_id: string;
  member_type: string;
  member_id: string;
  role: string;
}

export interface CreatePrivateSessionRequest {
  target_user_id: string;
}

export interface CreateGroupSessionRequest {
  name: string;
  member_ids: string[];
}

// ── Messages ─────────────────────────────────────

export interface SendMessageRequest {
  client_msg_id: string;
  content_type: string;
  content: string;
  reply_to_message_id?: string;
}

export interface SendMessageResponse {
  message_id: string;
  seq_id: number;
  created_at: string;
}

export interface ReplyToInfo {
  id: string;
  sender_id: string;
  content_type: string;
}

export interface MessageResponse {
  id: string;
  session_id: string;
  seq_id: number;
  client_msg_id: string;
  sender_type: string;
  sender_id: string;
  content_type: string;
  content: string;
  reply_to_message_id?: string;
  reply_to?: ReplyToInfo;
  recalled?: boolean;
  created_at?: string;
}

// ── Devices ──────────────────────────────────────

export interface RegisterDeviceRequest {
  device_id: string;
  app_version?: string;
  capabilities?: string[];
}

export interface Device {
  id: string;
  user_id: string;
  device_type: string;
  app_version: string;
  capabilities: Record<string, unknown>;
}

// ── Agents ───────────────────────────────────────

export interface AddAgentToSessionRequest {
  agent_type: string;
  custom_agent_id?: string;
  display_name: string;
}

// ── Custom agents ────────────────────────────────

export interface CustomAgentRequest {
  name: string;
  avatar_url?: string;
  agent_type: string;
  system_prompt: string;
  capability_tags?: string;
  tool_whitelist?: string;
  model_params?: string;
}

// ── Auth ─────────────────────────────────────────

export interface UpdateProfileRequest {
  nickname?: string;
  avatar_url?: string;
}

export interface ChangePasswordRequest {
  old_password: string;
  new_password: string;
}

// ── Error ────────────────────────────────────────

export class HubError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = 'hub_error') {
    super(message);
    this.name = 'HubError';
    this.status = status;
    this.code = code;
  }
}

// ── Client factory ────────────────────────────────

export interface HubClientOptions {
  baseUrl?: string;
  /** Returns the current JWT token (or null if not authenticated). */
  getToken?: () => string | null;
}

export function createHubClient(opts: HubClientOptions = {}) {
  const base = (opts.baseUrl || HUB_URL).replace(/\/+$/, '');

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = opts.getToken?.();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((options.headers as Record<string, string>) || {}),
    };

    const res = await fetch(`${base}${path}`, { ...options, headers });
    if (!res.ok) {
      // Try Hub's structured error first, then fall back to generic parseError
      try {
        const body = await res.json();
        if (body?.error?.message) {
          throw new AppError(
            { error: { code: body.error.code || 'hub_error', message: body.error.message } },
            res.status,
          );
        }
      } catch (e) {
        if (e instanceof AppError) throw e;
      }
      // Fallback to shared parseError
      throw await parseError(
        new Response(
          JSON.stringify({ error: { code: 'internal_error', message: res.statusText } }),
          { status: res.status },
        ),
      );
    }
    // 204 No Content for void endpoints
    if (res.status === 204) return undefined as T;
    return res.json();
  }

  // ── Helpers ────────────────────────────────────

  function qs(params: Record<string, string | number | boolean | undefined | null>): string {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v != null) p.set(k, String(v));
    }
    const s = p.toString();
    return s ? `?${s}` : '';
  }

  return {
    /** Raw request for one-off calls. */
    request,

    // ── Auth ──────────────────────────────────────

    register: (data: RegisterRequest) =>
      request<{ user_id: string }>('/client/auth/register', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    login: (data: LoginRequest) =>
      request<AuthResponse>('/client/auth/login', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    refresh: (token: string) =>
      request<AuthResponse>('/client/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: token }),
      }),

    logout: () =>
      request<void>('/client/auth/logout', { method: 'POST' }),

    me: () =>
      request<UserProfile>('/client/auth/me'),

    updateProfile: (data: UpdateProfileRequest) =>
      request<UserProfile>('/client/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    changePassword: (data: ChangePasswordRequest) =>
      request<void>('/client/auth/password', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    // ── Contacts ──────────────────────────────────

    /** Search for a user by their user_id (UUID). Returns relationship status. */
    searchUser: (targetUserId: string) =>
      request<SearchResult>(`/client/contacts/search?id=${encodeURIComponent(targetUserId)}`),

    listContacts: () =>
      request<ContactInfo[]>('/client/contacts'),

    sendFriendRequest: (friendId: string, message?: string) =>
      request<void>('/client/contacts/friend-requests', {
        method: 'POST',
        body: JSON.stringify({ friend_id: friendId, message }),
      }),

    listFriendRequests: () =>
      request<FriendRequestInfo[]>('/client/contacts/friend-requests'),

    acceptFriendRequest: (requestId: string) =>
      request<void>(`/client/contacts/friend-requests/${encodeURIComponent(requestId)}/accept`, {
        method: 'POST',
      }),

    rejectFriendRequest: (requestId: string) =>
      request<void>(`/client/contacts/friend-requests/${encodeURIComponent(requestId)}/reject`, {
        method: 'POST',
      }),

    removeContact: (friendUserId: string) =>
      request<void>(`/client/contacts/${encodeURIComponent(friendUserId)}`, { method: 'DELETE' }),

    blockContact: (targetUserId: string) =>
      request<void>(`/client/contacts/${encodeURIComponent(targetUserId)}/block`, {
        method: 'POST',
      }),

    unblockContact: (targetUserId: string) =>
      request<void>(`/client/contacts/${encodeURIComponent(targetUserId)}/unblock`, {
        method: 'POST',
      }),

    updateContactRemark: (friendUserId: string, remark: string) =>
      request<void>(`/client/contacts/${encodeURIComponent(friendUserId)}/remark`, {
        method: 'PUT',
        body: JSON.stringify({ remark }),
      }),

    // ── Sessions ──────────────────────────────────

    listSessions: () =>
      request<Session[]>('/client/sessions'),

    searchSessions: (q: string) =>
      request<Session[]>(`/client/sessions/search?q=${encodeURIComponent(q)}`),

    createPrivateSession: (data: CreatePrivateSessionRequest) =>
      request<Session>('/client/sessions/private', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    createGroupSession: (data: CreateGroupSessionRequest) =>
      request<Session>('/client/sessions/group', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    addSessionMembers: (sessionId: string, memberIds: string[]) =>
      request<void>(`/client/sessions/${sessionId}/members`, {
        method: 'POST',
        body: JSON.stringify({ member_ids: memberIds }),
      }),

    removeSessionMember: (sessionId: string, userId: string) =>
      request<void>(`/client/sessions/${sessionId}/members/${userId}`, { method: 'DELETE' }),

    leaveSession: (sessionId: string) =>
      request<void>(`/client/sessions/${sessionId}/leave`, { method: 'POST' }),

    transferSessionOwnership: (sessionId: string, newOwnerId: string) =>
      request<void>(`/client/sessions/${sessionId}/transfer-owner`, {
        method: 'POST',
        body: JSON.stringify({ new_owner_id: newOwnerId }),
      }),

    dissolveSession: (sessionId: string) =>
      request<void>(`/client/sessions/${sessionId}/dissolve`, { method: 'POST' }),

    updateSessionInfo: (
      sessionId: string,
      data: { name?: string; avatar_url?: string; announcement?: string },
    ) =>
      request<void>(`/client/sessions/${sessionId}/info`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    updateSessionSettings: (
      sessionId: string,
      data: { pinned?: boolean; archived?: boolean; muted?: boolean },
    ) =>
      request<void>(`/client/sessions/${sessionId}/settings`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    deleteSession: (sessionId: string) =>
      request<void>(`/client/sessions/${sessionId}`, { method: 'DELETE' }),

    // ── Messages ──────────────────────────────────

    sendMessage: (sessionId: string, body: SendMessageRequest) =>
      request<SendMessageResponse>(
        `/client/sessions/${sessionId}/messages`,
        { method: 'POST', body: JSON.stringify(body) },
      ),

    getMessages: (
      sessionId: string,
      params?: { before_seq?: number; limit?: number },
    ) =>
      request<MessageResponse[]>(
        `/client/sessions/${sessionId}/messages${qs(params ?? {})}`,
      ),

    syncMessages: (
      sessionId: string,
      params?: { after_seq?: number; limit?: number },
    ) =>
      request<MessageResponse[]>(
        `/client/sessions/${sessionId}/messages/sync${qs(params ?? {})}`,
      ),

    markRead: (sessionId: string, lastReadSeq: number) =>
      request<void>(`/client/sessions/${sessionId}/read`, {
        method: 'POST',
        body: JSON.stringify({ last_read_seq: lastReadSeq }),
      }),

    recallMessage: (messageId: string) =>
      request<void>(`/client/messages/${encodeURIComponent(messageId)}/recall`, {
        method: 'POST',
      }),

    pinMessage: (messageId: string, sessionId: string) =>
      request<void>(`/client/messages/${encodeURIComponent(messageId)}/pin`, {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId }),
      }),

    unpinMessage: (messageId: string, sessionId: string) =>
      request<void>(`/client/messages/${encodeURIComponent(messageId)}/pin`, {
        method: 'DELETE',
        body: JSON.stringify({ session_id: sessionId }),
      }),

    forwardMessage: (messageId: string, targetSessionIds: string[]) =>
      request<void>(`/client/messages/${encodeURIComponent(messageId)}/forward`, {
        method: 'POST',
        body: JSON.stringify({ target_session_ids: targetSessionIds }),
      }),

    listPinnedMessages: (sessionId: string) =>
      request<MessageResponse[]>(`/client/sessions/${sessionId}/pins`),

    searchMessages: (params: {
      q: string;
      session_id?: string;
      content_type?: string;
      from?: string;
      to?: string;
    }) =>
      request<MessageResponse[]>(`/client/messages/search${qs(params)}`),

    searchSessionMessages: (
      sessionId: string,
      params: { q: string; content_type?: string; from?: string; to?: string },
    ) =>
      request<MessageResponse[]>(
        `/client/sessions/${sessionId}/messages/search${qs(params)}`,
      ),

    // ── Notifications ─────────────────────────────

    listNotifications: (params?: { unread_only?: boolean; limit?: number; offset?: number }) =>
      request<Record<string, unknown>[]>(`/client/notifications${qs(params ?? {})}`),

    markNotificationRead: (id: string) =>
      request<void>(`/client/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }),

    readAllNotifications: () =>
      request<void>('/client/notifications/read-all', { method: 'POST' }),

    // ── Edge (desktop device operations) ──────────

    registerDevice: (data: RegisterDeviceRequest) =>
      request<Device>('/edge/devices/register', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    // ── Edge callbacks (desktop → hub task lifecycle) ──

    ackTask: (taskId: string, runId?: string) =>
      request<void>(`/edge/agent-tasks/${encodeURIComponent(taskId)}/ack`, {
        method: 'POST',
        ...(runId ? { body: JSON.stringify({ run_id: runId }) } : {}),
      }),

    streamTask: (taskId: string, content: string) =>
      request<void>(`/edge/agent-tasks/${encodeURIComponent(taskId)}/stream`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      }),

    doneTask: (taskId: string, finalContent?: string) =>
      request<void>(`/edge/agent-tasks/${encodeURIComponent(taskId)}/done`, {
        method: 'POST',
        body: JSON.stringify({ final_content: finalContent ?? '' }),
      }),

    failTask: (taskId: string, error: string) =>
      request<void>(`/edge/agent-tasks/${encodeURIComponent(taskId)}/fail`, {
        method: 'POST',
        body: JSON.stringify({ error }),
      }),

    // ── Agent tasks ───────────────────────────────

    /** Add an agent to a session (becomes triggerable by @mentions). */
    addAgentToSession: (sessionId: string, data: AddAgentToSessionRequest) =>
      request<void>(`/client/sessions/${sessionId}/agents`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    triggerAgentTask: (triggerMessageId: string) =>
      request<Record<string, unknown>>('/web/agent-tasks', {
        method: 'POST',
        body: JSON.stringify({ trigger_message_id: triggerMessageId }),
      }),

    cancelAgentTask: (taskId: string) =>
      request<void>(`/web/agent-tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' }),

    // ── Custom agents ─────────────────────────────

    listCustomAgents: () =>
      request<Record<string, unknown>[]>('/web/custom-agents'),

    createCustomAgent: (data: CustomAgentRequest) =>
      request<Record<string, unknown>>('/web/custom-agents', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    updateCustomAgent: (id: string, data: CustomAgentRequest) =>
      request<Record<string, unknown>>(`/web/custom-agents/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    deleteCustomAgent: (id: string) =>
      request<void>(`/web/custom-agents/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  };
}

export type HubClient = ReturnType<typeof createHubClient>;
