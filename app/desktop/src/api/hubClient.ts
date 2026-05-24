// Typed REST client for Hub Server.
// Handles JWT auth header injection, error parsing, and typed endpoints.
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

export interface Contact {
  id: string;
  user_id: string;
  friend_id: string;
  status: string;
  remark?: string;
  friend?: UserProfile;
  created_at?: string;
}

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

export interface CreateSessionRequest {
  user_id: string;
}

export interface RegisterDeviceRequest {
  device_id: string;
  device_type: string;
  app_version?: string;
  capabilities?: Record<string, unknown>;
}

export interface Device {
  id: string;
  user_id: string;
  device_type: string;
  app_version: string;
  capabilities: Record<string, unknown>;
}

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
    return res.json();
  }

  return {
    /** Raw request for one-off calls (logout, custom endpoints). */
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

    me: () => request<UserProfile>('/client/auth/me'),

    // ── Contacts ──────────────────────────────────

    listContacts: () => request<Contact[]>('/client/contacts'),

    sendFriendRequest: (userId: string, message?: string) =>
      request<{ id: string }>('/client/contacts/friend-requests', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, message }),
      }),

    // ── Sessions ──────────────────────────────────

    listSessions: () => request<Session[]>('/client/sessions'),

    searchSessions: (q: string) =>
      request<Session[]>(`/client/sessions/search?q=${encodeURIComponent(q)}`),

    createPrivateSession: (data: CreateSessionRequest) =>
      request<Session>('/client/sessions/private', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    createGroupSession: (data: { name: string; member_ids: string[] }) =>
      request<Session>('/client/sessions/group', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    addSessionMembers: (sessionId: string, member_ids: string[]) =>
      request<void>(`/client/sessions/${sessionId}/members`, {
        method: 'POST',
        body: JSON.stringify({ member_ids }),
      }),

    removeSessionMember: (sessionId: string, userId: string) =>
      request<void>(`/client/sessions/${sessionId}/members/${userId}`, { method: 'DELETE' }),

    leaveSession: (sessionId: string) =>
      request<void>(`/client/sessions/${sessionId}/leave`, { method: 'POST' }),

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

    // ── Edge ──────────────────────────────────────

    registerDevice: (data: RegisterDeviceRequest) =>
      request<Device>('/edge/devices/register', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    // ── Messages ──────────────────────────────────

    sendMessage: (
      sessionId: string,
      body: { client_msg_id: string; content_type: string; content: string; reply_to_message_id?: string },
    ) =>
      request<{ message_id: string; seq_id: number; created_at: string }>(
        `/client/sessions/${sessionId}/messages`,
        { method: 'POST', body: JSON.stringify(body) },
      ),

    getMessages: (sessionId: string, params?: { before_seq?: number; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.before_seq != null) qs.set('before_seq', String(params.before_seq));
      if (params?.limit != null) qs.set('limit', String(params.limit));
      const q = qs.toString();
      return request<Record<string, unknown>[]>(`/client/sessions/${sessionId}/messages${q ? `?${q}` : ''}`);
    },

    syncMessages: (sessionId: string, params?: { after_seq?: number; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.after_seq != null) qs.set('after_seq', String(params.after_seq));
      if (params?.limit != null) qs.set('limit', String(params.limit));
      const q = qs.toString();
      return request<Record<string, unknown>[]>(`/client/sessions/${sessionId}/messages/sync${q ? `?${q}` : ''}`);
    },

    markRead: (sessionId: string, lastReadSeq: number) =>
      request<void>(`/client/sessions/${sessionId}/read`, {
        method: 'POST',
        body: JSON.stringify({ last_read_seq: lastReadSeq }),
      }),

    // ── Notifications ─────────────────────────────

    listNotifications: () => request<Record<string, unknown>[]>('/client/notifications'),

    markNotificationRead: (id: string) =>
      request<void>(`/client/notifications/${id}/read`, { method: 'POST' }),

    readAllNotifications: () =>
      request<void>('/client/notifications/read-all', { method: 'POST' }),

    // ── Agent tasks ───────────────────────────────

    triggerAgentTask: (triggerMessageId: string) =>
      request<Record<string, unknown>>('/web/agent-tasks', {
        method: 'POST',
        body: JSON.stringify({ trigger_message_id: triggerMessageId }),
      }),

    cancelAgentTask: (taskId: string) =>
      request<void>(`/web/agent-tasks/${taskId}/cancel`, { method: 'POST' }),

    // ── Edge callbacks (desktop → hub) ────────────

    ackTask: (taskId: string) =>
      request<void>(`/edge/agent-tasks/${encodeURIComponent(taskId)}/ack`, { method: 'POST' }),

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

    // ── Custom agents ─────────────────────────────

    listCustomAgents: () => request<Record<string, unknown>[]>('/web/custom-agents'),

    createCustomAgent: (data: Record<string, unknown>) =>
      request<Record<string, unknown>>('/web/custom-agents', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    updateCustomAgent: (id: string, data: Record<string, unknown>) =>
      request<Record<string, unknown>>(`/web/custom-agents/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    deleteCustomAgent: (id: string) =>
      request<void>(`/web/custom-agents/${id}`, { method: 'DELETE' }),
  };
}

export type HubClient = ReturnType<typeof createHubClient>;
