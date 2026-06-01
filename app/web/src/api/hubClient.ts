// Typed REST client for Hub Server.
// Handles JWT auth header injection, error parsing, and typed endpoints.
// Covers all routes defined in hub-server/internal/router/router.go.
//
// Uses the same error convention as edgeClient.ts: AppError from @shared/errors.

import { HUB_URL } from '@/config';
import { AppError } from '@shared/errors';

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
  id?: string;
  session_id?: string;
  type: string;
  name?: string;
  avatar_url?: string;
  owner_user_id?: string;
  pinned?: boolean;
  archived?: boolean;
  muted?: boolean;
  last_message_at?: string;
  unread_count?: number;
  member_count?: number;
  role?: string;
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

export interface AgentRunEventSummary {
  task_id: string;
  edge_run_id?: string;
  status: string;
  total_events: number;
  last_event_seq: number;
  event_type_counts: Record<string, number>;
  tool_call_count: number;
  step_count: number;
  artifact_count: number;
  approval_count: number;
  pending_approvals: number;
  decided_approvals: number;
  input_tokens: number;
  output_tokens: number;
  output_bytes: number;
  started_at?: string;
  finished_at?: string;
  elapsed_ms?: number;
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

// ── Agent profiles ──────────────────────────────

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

// ── Execution targets ───────────────────────────

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

// ── Auth ─────────────────────────────────────────

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

// ── Agent teams / TeamRun console ───────────────

export interface AgentTeam {
  id: string;
  owner_id?: string;
  name: string;
  description?: string;
  avatar_url?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AgentTeamMember {
  id: string;
  team_id: string;
  agent_profile_id?: string;
  role: 'supervisor' | 'executor' | 'reviewer' | string;
  position?: number;
  created_at?: string;
}

export interface AgentTeamDetail extends AgentTeam {
  members?: AgentTeamMember[];
}

export interface AgentTeamRun {
  id: string;
  team_id: string;
  session_id?: string;
  trigger_user_id?: string;
  trigger_message?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | string;
  created_at?: string;
  updated_at?: string;
}

export interface AgentTeamAssignment {
  id: string;
  team_run_id: string;
  from_member_id?: string;
  to_member_id?: string;
  type?: string;
  task_prompt?: string;
  context?: string;
  status?: string;
  run_id?: string;
  result?: string;
  depth?: number;
  created_at?: string;
  updated_at?: string;
}

export interface AgentTeamTask {
  id: string;
  team_run_id: string;
  assignment_id?: string;
  assignee_member_id?: string;
  parent_task_id?: string;
  status: 'pending' | 'dispatched' | 'running' | 'done' | 'failed' | 'cancelled' | string;
  objective?: string;
  input_refs?: Record<string, unknown>;
  run_id?: string;
  attempt?: number;
  risk_level?: 'normal' | 'high' | string;
  created_at?: string;
  updated_at?: string;
}

export interface AgentTeamEvent {
  id: string;
  team_run_id: string;
  seq: number;
  type: string;
  payload?: string | Record<string, unknown>;
  created_at?: string;
}

export interface TeamMemberState {
  member_id: string;
  agent_profile_id?: string;
  role: string;
  active_tasks?: number;
  completed_tasks?: number;
}

export interface TeamTaskState {
  task_id: string;
  assignment_id?: string;
  assignee_member_id?: string;
  parent_task_id?: string;
  status: string;
  objective?: string;
  run_id?: string;
  agent_task_id?: string;
  edge_run_id?: string;
  attempt?: number;
  risk_level?: string;
}

export interface TeamAssignmentState {
  assignment_id: string;
  from_member_id?: string;
  to_member_id?: string;
  type?: string;
  status?: string;
  depth?: number;
  run_id?: string;
  agent_task_id?: string;
  edge_run_id?: string;
}

export interface TeamApprovalState {
  approval_id: string;
  agent_task_id?: string;
  team_task_id?: string;
  assignment_id?: string;
  member_id?: string;
  edge_run_id?: string;
  request_id?: string;
  tool_name?: string;
  tool_use_id?: string;
  status: string;
  reason?: string;
  decided_by?: string;
  created_at?: string;
  decided_at?: string;
  edge_control?: Record<string, unknown>;
}

export interface TeamArtifactState {
  agent_task_id?: string;
  team_task_id?: string;
  assignment_id?: string;
  member_id?: string;
  edge_run_id?: string;
  source_event_id?: string;
  event_seq?: number;
  path: string;
  action?: string;
  tool_name?: string;
  status?: string;
  conflict_id?: string;
  created_at?: string;
}

export interface TeamConflictState {
  conflict_id: string;
  path: string;
  status: string;
  agent_task_ids?: string[];
  team_task_ids?: string[];
  assignment_ids?: string[];
  member_ids?: string[];
  edge_run_ids?: string[];
  actions?: string[];
  first_seen_at?: string;
  last_seen_at?: string;
  resolution?: string;
  resolved_by?: string;
  resolved_at?: string;
  reason?: string;
  selected_agent_task_id?: string;
}

export interface TeamRunEventState {
  agent_task_id: string;
  edge_run_id?: string;
  event_seq: number;
  event_type: string;
  payload?: string;
  created_at?: string;
}

export interface TeamBudget {
  total_tokens_used?: number;
  input_tokens?: number;
  output_tokens?: number;
  token_limit?: number;
  remaining_tokens?: number;
  usage_percent?: number;
  run_count?: number;
  context_warnings?: number;
  compactions?: number;
}

export interface CoordinatorRouteDecision {
  action: string;
  next_worker?: string;
  instructions?: string;
  reasoning?: string;
  context?: string;
  approved?: boolean;
  feedback?: string;
  summary?: string;
  blocked_reason?: string;
  correlation_id?: string;
}

export interface TeamRunState {
  run_id: string;
  team_id: string;
  status: string;
  members?: TeamMemberState[];
  tasks?: TeamTaskState[];
  dependencies?: Array<Record<string, unknown>>;
  assignments?: TeamAssignmentState[];
  approvals?: TeamApprovalState[];
  artifacts?: TeamArtifactState[];
  conflicts?: TeamConflictState[];
  run_events?: TeamRunEventState[];
  route_log?: CoordinatorRouteDecision[];
  budget?: TeamBudget;
  terminal_reason?: string;
}

export interface TeamApprovalDecisionRequest {
  decision: 'allow' | 'deny';
  reason?: string;
}

export interface TeamConflictResolutionRequest {
  resolution: string;
  path?: string;
  selected_agent_task_id?: string;
  reason?: string;
}

export interface CreateAgentTeamRequest {
  name: string;
  description?: string;
}

export interface UpdateAgentTeamRequest {
  name?: string;
  description?: string;
}

export interface AddAgentTeamMemberRequest {
  agent_profile_id: string;
  role: 'supervisor' | 'executor' | 'reviewer' | string;
}

export interface StartAgentTeamRunRequest {
  trigger_message: string;
}

interface HubEnvelope<T> {
  code: string;
  message?: string;
  data?: T;
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

    // ── OIDC PKCE ─────────────────────────────────

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

    streamTask: (taskId: string, content: string, runId?: string) =>
      request<void>(`/edge/agent-tasks/${encodeURIComponent(taskId)}/stream`, {
        method: 'POST',
        body: JSON.stringify({ content, ...(runId ? { run_id: runId } : {}) }),
      }),

    doneTask: (taskId: string, finalContent?: string, runId?: string) =>
      request<void>(`/edge/agent-tasks/${encodeURIComponent(taskId)}/done`, {
        method: 'POST',
        body: JSON.stringify({
          final_content: finalContent ?? '',
          ...(runId ? { run_id: runId } : {}),
        }),
      }),

    failTask: (taskId: string, error: string, runId?: string) =>
      request<void>(`/edge/agent-tasks/${encodeURIComponent(taskId)}/fail`, {
        method: 'POST',
        body: JSON.stringify({ error, ...(runId ? { run_id: runId } : {}) }),
      }),

    // ── Agent tasks ───────────────────────────────

    /** Add an agent to a session (becomes triggerable by @mentions). */
    addAgentToSession: (sessionId: string, data: AddAgentToSessionRequest) =>
      request<void>(`/client/sessions/${sessionId}/agents`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    triggerAgentTask: (triggerMessageId: string, options: TriggerAgentTaskOptions = {}) =>
      request<PendingAgentTask>('/web/agent-tasks', {
        method: 'POST',
        body: JSON.stringify({ trigger_message_id: triggerMessageId, ...options }),
      }),

    cancelAgentTask: (taskId: string) =>
      request<void>(`/web/agent-tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' }),

    listTaskRunEvents: (taskId: string) =>
      request<AgentRunEvent[]>(`/web/agent-tasks/${encodeURIComponent(taskId)}/events`),

    getTaskRunEventSummary: (taskId: string) =>
      request<AgentRunEventSummary>(`/web/agent-tasks/${encodeURIComponent(taskId)}/events/summary`),

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

    // ── Agent profiles ───────────────────────────

    listAgentProfiles: (params?: {
      runtime_id?: string;
      q?: string;
      pageCursor?: string;
      pageSize?: number;
    }) =>
      request<AgentProfileListResponse>(`/web/agent-profiles${qs(params ?? {})}`),

    // ── Execution targets ────────────────────────

    listExecutionTargets: (params?: {
      target_type?: ExecutionTargetType | string;
      pageCursor?: string;
      pageSize?: number;
    }) =>
      request<ExecutionTargetListResponse>(`/web/execution-targets${qs(params ?? {})}`),

    pingExecutionTarget: (id: string) =>
      request<void>(`/web/execution-targets/${encodeURIComponent(id)}/ping`, { method: 'POST' }),

    // ── Agent teams / TeamRun console ─────────────

    createAgentTeam: (data: CreateAgentTeamRequest) =>
      request<AgentTeam>('/web/agent-teams', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    listAgentTeams: () =>
      request<AgentTeam[]>('/web/agent-teams'),

    getAgentTeam: (teamId: string) =>
      request<AgentTeamDetail>(`/web/agent-teams/${encodeURIComponent(teamId)}`),

    updateAgentTeam: (teamId: string, data: UpdateAgentTeamRequest) =>
      request<void>(`/web/agent-teams/${encodeURIComponent(teamId)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    deleteAgentTeam: (teamId: string) =>
      request<void>(`/web/agent-teams/${encodeURIComponent(teamId)}`, { method: 'DELETE' }),

    addAgentTeamMember: (teamId: string, data: AddAgentTeamMemberRequest) =>
      request<void>(`/web/agent-teams/${encodeURIComponent(teamId)}/members`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    removeAgentTeamMember: (teamId: string, memberId: string) =>
      request<void>(
        `/web/agent-teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(memberId)}`,
        { method: 'DELETE' },
      ),

    startTeamRun: (teamId: string, data: StartAgentTeamRunRequest) =>
      request<AgentTeamRun>(`/web/agent-teams/${encodeURIComponent(teamId)}/runs`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    listTeamRuns: (teamId: string) =>
      request<AgentTeamRun[]>(`/web/agent-teams/${encodeURIComponent(teamId)}/runs`),

    getTeamRun: (teamId: string, runId: string) =>
      request<AgentTeamRun>(
        `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}`,
      ),

    getTeamRunState: (teamId: string, runId: string) =>
      request<TeamRunState>(
        `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/state`,
      ),

    listTeamEvents: (teamId: string, runId: string) =>
      request<AgentTeamEvent[]>(
        `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/events`,
      ),

    listTeamTasks: (teamId: string, runId: string) =>
      request<AgentTeamTask[]>(
        `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/tasks`,
      ),

    decideTeamApproval: (
      teamId: string,
      runId: string,
      approvalId: string,
      decision: TeamApprovalDecisionRequest,
    ) =>
      request<TeamApprovalState>(
        `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}/decide`,
        {
          method: 'POST',
          body: JSON.stringify(decision),
        },
      ),

    resolveTeamConflict: (
      teamId: string,
      runId: string,
      conflictId: string,
      resolution: TeamConflictResolutionRequest,
    ) =>
      request<TeamConflictState>(
        `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/conflicts/${encodeURIComponent(conflictId)}/resolve`,
        {
          method: 'POST',
          body: JSON.stringify(resolution),
        },
      ),
  };
}

export type HubClient = ReturnType<typeof createHubClient>;