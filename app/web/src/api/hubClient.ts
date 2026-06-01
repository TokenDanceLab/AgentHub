// Typed REST client for Hub Server.
// Handles JWT auth header injection, error parsing, and typed endpoints.
// Covers all routes defined in hub-server/internal/router/router.go.
//
// Uses the same error convention as edgeClient.ts: AppError from @shared/errors.

import { HUB_URL } from '@/config';
import { AppError } from '@shared/errors';

// 鈹€鈹€ Types 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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

// 鈹€鈹€ Contacts 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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

// 鈹€鈹€ Sessions 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface Session {
  id?: string;
  session_id?: string;
  type: string;
  name?: string;
  owner_user_id?: string;
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

export interface CreateSessionResponse {
  session_id: string;
  type: string;
  created: boolean;
}

// 鈹€鈹€ Messages 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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

// 鈹€鈹€ Devices 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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

// 鈹€鈹€ Agents 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface AddAgentToSessionRequest {
  agent_type: string;
  custom_agent_id?: string;
  display_name: string;
}

export interface PendingAgentTask {
  id: string;
  agent_instance_id: string;
  triggered_by_user_id: string;
  trigger_message_id: string;
  target_id?: string;
  status: string;
  edge_run_id?: string;
  edge_device_id?: string;
  error_message?: string;
  created_at?: string;
  dispatched_at?: string;
  finished_at?: string;
  expire_at?: string;
}

export interface AgentRunEvent {
  id: string;
  task_id: string;
  edge_run_id?: string;
  session_id: string;
  agent_instance_id: string;
  event_seq: number;
  event_type: string;
  payload: unknown;
  created_at: string;
}

export interface TriggerAgentTaskOptions {
  agent_instance_id?: string;
  agent_type?: string;
  custom_agent_id?: string;
  model_params?: string;
  target_id?: string;
}

// 鈹€鈹€ Custom agents 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface CustomAgentRequest {
  name: string;
  avatar_url?: string;
  agent_type: string;
  system_prompt: string;
  capability_tags?: string;
  tool_whitelist?: string;
  model_params?: string;
}

// 鈹€鈹€ Agent profiles 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface AgentProfile {
  id: string;
  owner_id?: string;
  name: string;
  description?: string;
  runtime_id: string;
  model?: string;
  provider?: string;
  reasoning_effort?: string;
  model_mapping?: string;
  skills?: string;
  mcp_servers?: string;
  tool_allowlist?: string;
  approval_policy?: string;
  permission_mode?: string;
  target_preferences?: string;
  context_budget_max_tokens?: number;
  is_public?: boolean;
  install_count?: number;
  rating_avg?: number;
  rating_count?: number;
  version?: number;
  created_at?: string;
  updated_at?: string;
}

export interface AgentProfileListResponse {
  items: AgentProfile[];
  page: {
    nextCursor?: string;
    hasMore: boolean;
  };
}

// 鈹€鈹€ Execution targets 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export type ExecutionTargetType = 'local_edge' | 'hub_relay' | 'remote_ssh' | 'tailscale' | 'cloud_edge';
export type ExecutionTargetTrustLevel = 'local' | 'remote' | 'cloud' | 'relay';
export type ExecutionTargetHealthState = 'unknown' | 'healthy' | 'degraded' | 'offline';

export interface ExecutionTarget {
  id: string;
  owner_id?: string;
  device_id?: string;
  name: string;
  target_type: ExecutionTargetType;
  endpoint?: string;
  host?: string;
  port?: number | string;
  workspace_root?: string;
  capabilities?: string;
  metadata?: string;
  workspace_allowlist?: string[] | string;
  trust_level?: ExecutionTargetTrustLevel;
  health_state?: ExecutionTargetHealthState;
  auth_method?: string;
  is_online?: boolean;
  last_seen_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ExecutionTargetListResponse {
  items: ExecutionTarget[];
  page: {
    nextCursor?: string;
    hasMore: boolean;
  };
}

// 鈹€鈹€ Auth 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface OIDCAuthorizeRequest {
  code_challenge: string;
  code_challenge_method?: string;
  device_type: string;
  device_id: string;
  redirect_uri?: string;
}

export interface OIDCAuthorizeResponse {
  state: string;
  authorization_url: string;
}

export interface OIDCCallbackRequest {
  code: string;
  state: string;
  code_verifier: string;
  device_type: string;
  device_id: string;
  redirect_uri?: string;
}

export interface OIDCCallbackResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: UserProfile;
}

// ... existing types ...

export interface UpdateProfileRequest {
  nickname?: string;
  avatar_url?: string;
}

export interface ChangePasswordRequest {
  old_password: string;
  new_password: string;
}

interface HubEnvelope<T> {
  code: string;
  message?: string;
  data?: T;
}

// 鈹€鈹€ Error 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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

// 鈹€鈹€ Client factory 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface HubClientOptions {
  baseUrl?: string;
  /** Returns the current JWT token (or null if not authenticated). */
  getToken?: () => string | null;
}

export function createHubClient(opts: HubClientOptions = {}) {
  const base = (opts.baseUrl || HUB_URL).replace(/\/+$/, '');

  function isHubEnvelope<T>(body: unknown): body is HubEnvelope<T> {
    return !!body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string';
  }

  function isSharedErrorBody(body: unknown): body is { error: { code: string; message: string } } {
    if (!body || typeof body !== 'object') return false;
    const error = (body as { error?: unknown }).error;
    if (!error || typeof error !== 'object') return false;
    const record = error as { code?: unknown; message?: unknown };
    return typeof record.code === 'string' && typeof record.message === 'string';
  }

  async function readJsonBody(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = opts.getToken?.();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((options.headers as Record<string, string>) || {}),
    };

    const res = await fetch(`${base}${path}`, { ...options, headers });
    const body = res.status === 204 ? undefined : await readJsonBody(res);

    if (!res.ok) {
      if (isSharedErrorBody(body)) {
        throw new AppError({ error: body.error }, res.status, body);
      }
      if (isHubEnvelope(body)) {
        throw new AppError(
          {
            error: {
              code: body.code || 'hub_error',
              message: body.message || res.statusText || 'Hub request failed',
            },
          },
          res.status,
          body,
        );
      }
      throw new AppError(
        {
          error: {
            code: res.status >= 500 ? 'internal_error' : 'bad_request',
            message: `HTTP ${res.status}: ${res.statusText}`,
          },
        },
        res.status,
        body,
      );
    }

    // 204 No Content for void endpoints
    if (res.status === 204) return undefined as T;
    if (isHubEnvelope<T>(body)) return body.data as T;
    return body as T;
  }

  // 鈹€鈹€ Helpers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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

    // 鈹€鈹€ Auth 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

    refresh: (token: string) =>
      request<AuthResponse>('/client/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: token }),
      }),

    logout: () =>
      request<undefined>('/client/auth/logout', { method: 'POST' }),

    me: () =>
      request<UserProfile>('/client/auth/me'),

    updateProfile: (data: UpdateProfileRequest) =>
      request<UserProfile>('/client/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    // 鈹€鈹€ OIDC PKCE 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

    oidcAuthorize: (data: OIDCAuthorizeRequest) =>
      request<OIDCAuthorizeResponse>('/client/auth/oidc/authorize', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    oidcCallback: (data: OIDCCallbackRequest) =>
      request<OIDCCallbackResponse>('/client/auth/oidc/callback', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    // 鈹€鈹€ Contacts 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

    /** Search for a user by their user_id (UUID). Returns relationship status. */
    searchUser: (targetUserId: string) =>
      request<SearchResult>(`/client/contacts/search?id=${encodeURIComponent(targetUserId)}`),

    listContacts: () =>
      request<ContactInfo[]>('/client/contacts'),

    sendFriendRequest: (friendId: string, message?: string) =>
      request<undefined>('/client/contacts/friend-requests', {
        method: 'POST',
        body: JSON.stringify({ friend_id: friendId, message }),
      }),

    listFriendRequests: () =>
      request<FriendRequestInfo[]>('/client/contacts/friend-requests'),

    acceptFriendRequest: (requestId: string) =>
      request<undefined>(`/client/contacts/friend-requests/${encodeURIComponent(requestId)}/accept`, {
        method: 'POST',
      }),

    rejectFriendRequest: (requestId: string) =>
      request<undefined>(`/client/contacts/friend-requests/${encodeURIComponent(requestId)}/reject`, {
        method: 'POST',
      }),

    removeContact: (friendUserId: string) =>
      request<undefined>(`/client/contacts/${encodeURIComponent(friendUserId)}`, { method: 'DELETE' }),

    blockContact: (targetUserId: string) =>
      request<undefined>(`/client/contacts/${encodeURIComponent(targetUserId)}/block`, {
        method: 'POST',
      }),

    unblockContact: (targetUserId: string) =>
      request<undefined>(`/client/contacts/${encodeURIComponent(targetUserId)}/unblock`, {
        method: 'POST',
      }),

    updateContactRemark: (friendUserId: string, remark: string) =>
      request<undefined>(`/client/contacts/${encodeURIComponent(friendUserId)}/remark`, {
        method: 'PUT',
        body: JSON.stringify({ remark }),
      }),

    // 鈹€鈹€ Sessions 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

    listSessions: () =>
      request<Session[]>('/client/sessions'),

    searchSessions: (q: string) =>
      request<Session[]>(`/client/sessions/search?q=${encodeURIComponent(q)}`),

    createPrivateSession: (data: CreatePrivateSessionRequest) =>
      request<CreateSessionResponse>('/client/sessions/private', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    createGroupSession: (data: CreateGroupSessionRequest) =>
      request<CreateSessionResponse>('/client/sessions/group', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    addSessionMembers: (sessionId: string, memberIds: string[]) =>
      request<undefined>(`/client/sessions/${sessionId}/members`, {
        method: 'POST',
        body: JSON.stringify({ member_ids: memberIds }),
      }),

    removeSessionMember: (sessionId: string, userId: string) =>
      request<undefined>(`/client/sessions/${sessionId}/members/${userId}`, { method: 'DELETE' }),

    leaveSession: (sessionId: string) =>
      request<undefined>(`/client/sessions/${sessionId}/leave`, { method: 'POST' }),

    transferSessionOwnership: (sessionId: string, newOwnerId: string) =>
      request<undefined>(`/client/sessions/${sessionId}/transfer-owner`, {
        method: 'POST',
        body: JSON.stringify({ new_owner_id: newOwnerId }),
      }),

    dissolveSession: (sessionId: string) =>
      request<undefined>(`/client/sessions/${sessionId}/dissolve`, { method: 'POST' }),

    updateSessionInfo: (
      sessionId: string,
      data: { name?: string; avatar_url?: string; announcement?: string },
    ) =>
      request<undefined>(`/client/sessions/${sessionId}/info`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    updateSessionSettings: (
      sessionId: string,
      data: { pinned?: boolean; archived?: boolean; muted?: boolean },
    ) =>
      request<undefined>(`/client/sessions/${sessionId}/settings`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    deleteSession: (sessionId: string) =>
      request<undefined>(`/client/sessions/${sessionId}`, { method: 'DELETE' }),

    // 鈹€鈹€ Messages 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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
      request<undefined>(`/client/sessions/${sessionId}/read`, {
        method: 'POST',
        body: JSON.stringify({ last_read_seq: lastReadSeq }),
      }),

    recallMessage: (messageId: string) =>
      request<undefined>(`/client/messages/${encodeURIComponent(messageId)}/recall`, {
        method: 'POST',
      }),

    pinMessage: (messageId: string, sessionId: string) =>
      request<undefined>(`/client/messages/${encodeURIComponent(messageId)}/pin`, {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId }),
      }),

    unpinMessage: (messageId: string, sessionId: string) =>
      request<undefined>(`/client/messages/${encodeURIComponent(messageId)}/pin`, {
        method: 'DELETE',
        body: JSON.stringify({ session_id: sessionId }),
      }),

    forwardMessage: (messageId: string, targetSessionIds: string[]) =>
      request<undefined>(`/client/messages/${encodeURIComponent(messageId)}/forward`, {
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

    // 鈹€鈹€ Notifications 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

    listNotifications: (params?: { unread_only?: boolean; limit?: number; offset?: number }) =>
      request<Record<string, unknown>[]>(`/client/notifications${qs(params ?? {})}`),

    markNotificationRead: (id: string) =>
      request<undefined>(`/client/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }),

    readAllNotifications: () =>
      request<undefined>('/client/notifications/read-all', { method: 'POST' }),

    // 鈹€鈹€ Edge (desktop device operations) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

    registerDevice: (data: RegisterDeviceRequest) =>
      request<Device>('/edge/devices/register', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    // 鈹€鈹€ Edge callbacks (desktop 鈫?hub task lifecycle) 鈹€鈹€

    ackTask: (taskId: string, runId?: string) =>
      request<undefined>(`/edge/agent-tasks/${encodeURIComponent(taskId)}/ack`, {
        method: 'POST',
        ...(runId ? { body: JSON.stringify({ run_id: runId }) } : {}),
      }),

    streamTask: (taskId: string, content: string, runId?: string) =>
      request<undefined>(`/edge/agent-tasks/${encodeURIComponent(taskId)}/stream`, {
        method: 'POST',
        body: JSON.stringify({ content, ...(runId ? { run_id: runId } : {}) }),
      }),

    doneTask: (taskId: string, finalContent?: string, runId?: string) =>
      request<undefined>(`/edge/agent-tasks/${encodeURIComponent(taskId)}/done`, {
        method: 'POST',
        body: JSON.stringify({
          final_content: finalContent ?? '',
          ...(runId ? { run_id: runId } : {}),
        }),
      }),

    failTask: (taskId: string, error: string, runId?: string) =>
      request<undefined>(`/edge/agent-tasks/${encodeURIComponent(taskId)}/fail`, {
        method: 'POST',
        body: JSON.stringify({ error, ...(runId ? { run_id: runId } : {}) }),
      }),

    // 鈹€鈹€ Agent tasks 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

    /** Add an agent to a session (becomes triggerable by @mentions). */
    addAgentToSession: (sessionId: string, data: AddAgentToSessionRequest) =>
      request<undefined>(`/client/sessions/${sessionId}/agents`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    triggerAgentTask: (triggerMessageId: string, options: TriggerAgentTaskOptions = {}) =>
      request<PendingAgentTask>('/web/agent-tasks', {
        method: 'POST',
        body: JSON.stringify({ trigger_message_id: triggerMessageId, ...options }),
      }),

    cancelAgentTask: (taskId: string) =>
      request<undefined>(`/web/agent-tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' }),

    listTaskRunEvents: (taskId: string) =>
      request<AgentRunEvent[]>(`/web/agent-tasks/${encodeURIComponent(taskId)}/events`),

    // 鈹€鈹€ Custom agents 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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
      request<undefined>(`/web/custom-agents/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    // 鈹€鈹€ Agent profiles 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

    listAgentProfiles: (params?: {
      runtime_id?: string;
      q?: string;
      pageCursor?: string;
      pageSize?: number;
    }) =>
      request<AgentProfileListResponse>(`/web/agent-profiles${qs(params ?? {})}`),

    // 鈹€鈹€ Execution targets 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

    listExecutionTargets: (params?: {
      target_type?: ExecutionTargetType | string;
      pageCursor?: string;
      pageSize?: number;
    }) =>
      request<ExecutionTargetListResponse>(`/web/execution-targets${qs(params ?? {})}`),

    pingExecutionTarget: (id: string) =>
      request<undefined>(`/web/execution-targets/${encodeURIComponent(id)}/ping`, { method: 'POST' }),
  };
}

export type HubClient = ReturnType<typeof createHubClient>;