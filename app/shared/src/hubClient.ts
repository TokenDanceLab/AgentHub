import { AppError, isErrorResponse } from './errors';
import { HUB_EVENTS, type HubEventType } from './hubEvents';

export interface HubResponseEnvelope<T = unknown> {
  code: string;
  message?: string;
  data?: T;
}

export type HubEnvelope<T = unknown> = HubResponseEnvelope<T>;

export interface HubClientOptions {
  baseUrl?: string;
  getToken?: () => string | null | undefined;
  fetch?: typeof fetch;
}

export interface HubRegisterRequest {
  username: string;
  password: string;
  nickname: string;
}

export interface HubLoginRequest {
  username: string;
  password: string;
  device_type: string;
  device_id: string;
}

export interface HubAuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface HubUserProfile {
  id: string;
  username: string;
  nickname: string;
  avatar_url?: string;
  created_at?: string;
}

export interface HubUpdateProfileRequest {
  nickname?: string;
  avatar_url?: string;
}

export interface HubChangePasswordRequest {
  old_password: string;
  new_password: string;
}

export interface HubOidcAuthorizeRequest {
  code_challenge: string;
  code_challenge_method?: 'S256' | 'plain';
  device_type?: string;
  device_id?: string;
}

export interface HubOidcAuthorizeResponse {
  state: string;
  authorization_url: string;
}

export interface HubOidcCallbackRequest {
  code: string;
  state: string;
  code_verifier: string;
  device_type?: string;
  device_id?: string;
}

export interface HubOidcCallbackResponse extends HubAuthResponse {
  user?: HubUserProfile;
}

export type HubContactType = 'user' | 'agent' | string;
export type HubRelationship =
  | 'stranger'
  | 'friend'
  | 'pending_sent'
  | 'pending_received'
  | 'blocked'
  | string;

export interface HubSearchResult {
  user_id: string;
  username: string;
  nickname: string;
  avatar_url?: string;
  relationship: HubRelationship;
}

export interface HubFriendRequest {
  request_id: string;
  user_id: string;
  username: string;
  nickname: string;
  avatar_url?: string;
  message: string;
  created_at: string;
}

export interface HubContactInfo {
  user_id: string;
  username: string;
  nickname: string;
  avatar_url?: string;
  remark?: string;
  online: boolean;
  type: HubContactType;
}

export type HubSessionType = 'private' | 'group' | string;
export type HubSessionRole = 'owner' | 'admin' | 'member' | string;

export interface HubSession {
  session_id?: string;
  id?: string;
  type: HubSessionType;
  name?: string;
  avatar_url?: string;
  announcement?: string;
  owner_user_id?: string;
  pinned?: boolean;
  archived?: boolean;
  muted?: boolean;
  last_message_at?: string;
  unread_count?: number;
  member_count?: number;
  role?: HubSessionRole;
  created_at?: string;
  updated_at?: string;
  members?: HubSessionMember[];
  last_message?: HubMessage;
}

export interface HubSessionMember {
  id?: string;
  session_id: string;
  member_type: 'user' | 'agent' | string;
  member_id: string;
  role: HubSessionRole;
  left_at?: string;
}

export interface HubCreatePrivateSessionRequest {
  target_user_id: string;
}

export interface HubCreateGroupSessionRequest {
  name: string;
  member_ids: string[];
}

export interface HubCreateSessionResponse {
  session_id: string;
  type: HubSessionType;
  created: boolean;
}

export interface HubUpdateSessionInfoRequest {
  name?: string;
  avatar_url?: string;
  announcement?: string;
}

export interface HubUpdateSessionSettingsRequest {
  pinned?: boolean;
  archived?: boolean;
  muted?: boolean;
}

export type HubSenderType = 'user' | 'agent' | string;
export type HubContentType =
  | 'text'
  | 'code'
  | 'diff'
  | 'image'
  | 'file'
  | 'link_card'
  | 'deploy_card'
  | string;

export interface HubSendMessageRequest {
  client_msg_id: string;
  content_type: HubContentType;
  content: string;
  reply_to_message_id?: string;
}

export interface HubSendMessageResponse {
  message_id: string;
  seq_id: number;
  created_at: string;
}

export interface HubReplyToInfo {
  id: string;
  sender_id: string;
  content_type: HubContentType;
  content: string;
  recalled: boolean;
  created_at: string;
}

export interface HubMessage {
  id: string;
  session_id: string;
  seq_id: number;
  client_msg_id?: string;
  sender_type: HubSenderType;
  sender_id: string;
  content_type: HubContentType;
  content: string;
  reply_to_message_id?: string;
  reply_to?: HubReplyToInfo;
  recalled?: boolean;
  created_at?: string;
}

export interface HubRegisterDeviceRequest {
  device_id: string;
  device_type?: string;
  device_name?: string;
  app_version?: string;
  capabilities?: string[] | Record<string, unknown>;
}

export interface HubDevice {
  id: string;
  user_id: string;
  device_type: string;
  app_version?: string;
  capabilities?: string | string[] | Record<string, unknown>;
  last_active_at?: string;
  created_at?: string;
}

export interface HubAddAgentToSessionRequest {
  agent_type: string;
  custom_agent_id?: string;
  display_name: string;
}

export interface HubCustomAgentRequest {
  name: string;
  avatar_url?: string;
  agent_type: string;
  system_prompt: string;
  capability_tags?: string;
  tool_whitelist?: string;
  model_params?: string;
}

export interface HubCustomAgent extends Record<string, unknown> {
  id: string;
  owner_user_id: string;
  name: string;
  avatar_url?: string;
  agent_type: string;
  system_prompt: string;
  capability_tags?: string;
  tool_whitelist?: string;
  model_params?: string;
  deleted_at?: string;
  created_at: string;
  updated_at: string;
}

export type HubAgentTaskStatus =
  | 'queued'
  | 'dispatched'
  | 'running'
  | 'done'
  | 'failed'
  | 'timeout'
  | 'cancelled'
  | string;

export interface HubAgentTask {
  id: string;
  agent_instance_id: string;
  triggered_by_user_id: string;
  trigger_message_id: string;
  target_id?: string;
  status: HubAgentTaskStatus;
  edge_run_id?: string;
  edge_device_id?: string;
  error_message?: string;
  created_at: string;
  dispatched_at?: string;
  finished_at?: string;
  expire_at: string;
}

export interface HubTriggerAgentTaskRequest {
  trigger_message_id: string;
  agent_instance_id?: string;
  agent_type?: string;
  custom_agent_id?: string;
  model_params?: string;
  target_id?: string;
}

export type HubTriggerAgentTaskOptions = Omit<HubTriggerAgentTaskRequest, 'trigger_message_id'>;

export interface HubTaskRunRequest {
  run_id?: string;
  edge_run_id?: string;
}

export type HubTaskAckRequest = HubTaskRunRequest;

export interface HubTaskStreamRequest extends HubTaskRunRequest {
  content: string;
}

export interface HubTaskDoneRequest extends HubTaskRunRequest {
  final_content?: string;
}

export interface HubTaskFailRequest extends HubTaskRunRequest {
  error: string;
}

export interface HubNotification {
  id: string;
  user_id: string;
  type: string;
  payload: string;
  read: boolean;
  created_at: string;
  [key: string]: unknown;
}

export interface HubPageInfo {
  nextCursor?: string;
  hasMore: boolean;
}

export interface HubListResponse<T> {
  items: T[];
  page: HubPageInfo;
}

export type HubExecutionTargetType =
  | 'local_edge'
  | 'remote_edge'
  | 'cloud_edge'
  | 'hub_relay'
  | string;

export interface HubExecutionTarget {
  id: string;
  name: string;
  type: HubExecutionTargetType;
  status?: string;
  config?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface HubExecutionTargetRequest {
  name: string;
  type: HubExecutionTargetType;
  config?: Record<string, unknown>;
}

export interface HubAuditEvent {
  id: string;
  actor_user_id?: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  [key: string]: unknown;
}

export interface HubRelayCommandRequest {
  target_id: string;
  payload: Record<string, unknown>;
}

export interface HubRelayCommand {
  id: string;
  target_id?: string;
  status?: string;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface HubDevicePresencePayload {
  user_id: string;
  device_type: string;
  device_id: string;
}

export interface HubDeviceKickedPayload {
  device_id?: string;
  device_type?: string;
  session_id?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface HubAgentDispatchPayload {
  task_id: string;
  agent_instance_id: string;
  agent_type: string;
  custom_agent_id?: string;
  session_id: string;
  trigger_message_id: string;
  trigger_user_id: string;
  display_name: string;
  system_prompt?: string;
  model_params?: string;
  tool_whitelist?: string;
}

export interface HubAgentStreamPayload extends HubTaskStreamRequest {
  task_id: string;
}

export interface HubAgentDonePayload extends HubTaskDoneRequest {
  task_id: string;
  status?: HubAgentTaskStatus;
}

export interface HubAgentFailedPayload {
  task_id: string;
  error?: string;
  error_message?: string;
  run_id?: string;
  edge_run_id?: string;
}

export interface HubAgentCancelPayload {
  task_id: string;
}

export interface HubFriendEventPayload {
  request_id?: string;
  user_id?: string;
  friend_id?: string;
  username?: string;
  nickname?: string;
  avatar_url?: string;
  message?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface HubFrame<TPayload = unknown, TType extends string = string> {
  type: TType;
  seq_id?: number;
  payload?: TPayload;
}

export type HubAuthFrame = HubFrame<
  { access_token: string },
  typeof HUB_EVENTS.AUTH
>;
export type HubAuthOkFrame = HubFrame<unknown, typeof HUB_EVENTS.AUTH_OK>;
export type HubAuthFailFrame = HubFrame<
  { code?: string; message?: string },
  typeof HUB_EVENTS.AUTH_FAIL
>;
export type HubMessageNewFrame = HubFrame<
  HubMessage,
  typeof HUB_EVENTS.MESSAGE_NEW
>;
export type HubMessageRecallFrame = HubFrame<
  { message_id?: string; id?: string; session_id?: string },
  typeof HUB_EVENTS.MESSAGE_RECALL
>;
export type HubMessageReadFrame = HubFrame<
  { session_id: string; user_id: string; last_read_seq: number },
  typeof HUB_EVENTS.MESSAGE_READ
>;
export type HubSessionCreatedFrame = HubFrame<
  HubSession | { session_id: string },
  typeof HUB_EVENTS.SESSION_CREATED
>;
export type HubSessionInfoUpdatedFrame = HubFrame<
  Partial<HubSession> & { session_id: string },
  typeof HUB_EVENTS.SESSION_INFO_UPDATED
>;
export type HubSessionDissolvedFrame = HubFrame<
  { session_id: string },
  typeof HUB_EVENTS.SESSION_DISSOLVED
>;
export type HubAgentDispatchFrame = HubFrame<
  HubAgentDispatchPayload,
  typeof HUB_EVENTS.AGENT_DISPATCH
>;
export type HubAgentStreamFrame = HubFrame<
  HubAgentStreamPayload,
  typeof HUB_EVENTS.AGENT_STREAM
>;
export type HubAgentDoneFrame = HubFrame<
  HubAgentDonePayload,
  typeof HUB_EVENTS.AGENT_DONE
>;
export type HubAgentFailedFrame = HubFrame<
  HubAgentFailedPayload,
  typeof HUB_EVENTS.AGENT_FAILED
>;
export type HubAgentCancelFrame = HubFrame<
  HubAgentCancelPayload,
  typeof HUB_EVENTS.AGENT_CANCEL
>;
export type HubDeviceOnlineFrame = HubFrame<
  HubDevicePresencePayload,
  typeof HUB_EVENTS.DEVICE_ONLINE
>;
export type HubDeviceOfflineFrame = HubFrame<
  HubDevicePresencePayload,
  typeof HUB_EVENTS.DEVICE_OFFLINE
>;
export type HubDeviceKickedFrame = HubFrame<
  HubDeviceKickedPayload,
  typeof HUB_EVENTS.DEVICE_KICKED
>;
export type HubNotificationNewFrame = HubFrame<
  HubNotification,
  typeof HUB_EVENTS.NOTIFICATION_NEW
>;
export type HubFriendRequestFrame = HubFrame<
  HubFriendEventPayload,
  typeof HUB_EVENTS.FRIEND_REQUEST
>;
export type HubFriendAcceptedFrame = HubFrame<
  HubFriendEventPayload,
  typeof HUB_EVENTS.FRIEND_ACCEPTED
>;

export type HubKnownFrame =
  | HubAuthFrame
  | HubAuthOkFrame
  | HubAuthFailFrame
  | HubMessageNewFrame
  | HubMessageRecallFrame
  | HubMessageReadFrame
  | HubSessionCreatedFrame
  | HubSessionInfoUpdatedFrame
  | HubSessionDissolvedFrame
  | HubAgentDispatchFrame
  | HubAgentStreamFrame
  | HubAgentDoneFrame
  | HubAgentFailedFrame
  | HubAgentCancelFrame
  | HubDeviceOnlineFrame
  | HubDeviceOfflineFrame
  | HubDeviceKickedFrame
  | HubNotificationNewFrame
  | HubFriendRequestFrame
  | HubFriendAcceptedFrame
  | HubFrame<unknown, HubEventType>;

export class HubError extends AppError {
  constructor(status: number, message: string, code = 'hub_error') {
    super({ error: { code, message } }, status);
    this.name = 'HubError';
  }
}

export function isHubResponseEnvelope(
  body: unknown,
): body is HubResponseEnvelope {
  return isRecord(body) && typeof body.code === 'string';
}

export function unwrapHubResponse<T>(body: unknown, status = 200): T {
  if (!isHubResponseEnvelope(body)) {
    return body as T;
  }

  if (body.code !== 'OK') {
    throw new AppError(
      {
        error: {
          code: body.code,
          message: body.message || 'Hub request failed',
        },
      },
      status,
      body,
    );
  }

  return body.data as T;
}

export async function parseHubError(response: Response): Promise<AppError> {
  const body = await readJson(response);
  if (isErrorResponse(body)) {
    return new AppError(body, response.status, body);
  }
  if (isHubResponseEnvelope(body)) {
    return new AppError(
      {
        error: {
          code: body.code || 'HUB_ERROR',
          message:
            body.message ||
            response.statusText ||
            `HTTP ${response.status}`,
        },
      },
      response.status,
      body,
    );
  }
  if (isRecord(body) && typeof body.message === 'string') {
    return new AppError(
      {
        error: {
          code: text(body.code) ?? 'HUB_ERROR',
          message: body.message,
        },
      },
      response.status,
      body,
    );
  }

  return new AppError(
    {
      error: {
        code: response.status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
        message: response.statusText || `HTTP ${response.status}`,
      },
    },
    response.status,
    body,
  );
}

export function createHubClient(opts: HubClientOptions = {}) {
  const baseUrl = (opts.baseUrl ?? '').replace(/\/+$/, '');
  const fetchImpl = opts.fetch;

  async function request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const token = opts.getToken?.();
    const headers = new Headers(options.headers);
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await (fetchImpl ?? globalThis.fetch)(`${baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw await parseHubError(response);
    }
    if (response.status === 204) {
      return undefined as T;
    }

    return unwrapHubResponse<T>(await readJson(response), response.status);
  }

  async function requestWithFallback<T>(
    paths: readonly string[],
    options: RequestInit = {},
  ): Promise<T> {
    let fallbackError: unknown;

    for (let index = 0; index < paths.length; index += 1) {
      const path = paths[index]!;
      try {
        return await request<T>(path, options);
      } catch (error) {
        if (index < paths.length - 1 && isRouteFallbackError(error)) {
          fallbackError = error;
          continue;
        }
        throw error;
      }
    }

    throw fallbackError;
  }

  return {
    request,

    register: (body: HubRegisterRequest) =>
      request<{ user_id: string }>('/client/auth/register', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    login: (body: HubLoginRequest) =>
      request<HubAuthResponse>('/client/auth/login', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    refresh: (refreshToken: string) =>
      request<HubAuthResponse>('/client/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refreshToken }),
      }),
    logout: () => request<void>('/client/auth/logout', { method: 'POST' }),
    me: () => request<HubUserProfile>('/client/auth/me'),
    updateProfile: (body: HubUpdateProfileRequest) =>
      request<HubUserProfile>('/client/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    changePassword: async (body: HubChangePasswordRequest) => {
      const payload = JSON.stringify(body);
      try {
        return await request<void>('/client/auth/change-password', {
          method: 'POST',
          body: payload,
        });
      } catch (error) {
        if (isRouteFallbackError(error)) {
          return request<void>('/client/auth/password', {
            method: 'PUT',
            body: payload,
          });
        }
        throw error;
      }
    },
    oidcAuthorize: (body: HubOidcAuthorizeRequest) =>
      request<HubOidcAuthorizeResponse>('/client/auth/oidc/authorize', {
        method: 'POST',
        body: JSON.stringify({
          code_challenge_method: 'S256',
          ...body,
        }),
      }),
    oidcCallback: (body: HubOidcCallbackRequest) =>
      request<HubOidcCallbackResponse>('/client/auth/oidc/callback', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    searchUser: (targetUserId: string) =>
      request<HubSearchResult>(
        `/client/contacts/search?id=${encodeURIComponent(targetUserId)}`,
      ),
    listContacts: () => request<HubContactInfo[]>('/client/contacts'),
    sendFriendRequest: (friendId: string, message?: string) =>
      request<void>('/client/contacts/friend-requests', {
        method: 'POST',
        body: JSON.stringify({ friend_id: friendId, message }),
      }),
    listFriendRequests: () =>
      request<HubFriendRequest[]>('/client/contacts/friend-requests'),
    acceptFriendRequest: (requestId: string) =>
      request<void>(
        `/client/contacts/friend-requests/${encodeURIComponent(requestId)}/accept`,
        { method: 'POST' },
      ),
    rejectFriendRequest: (requestId: string) =>
      request<void>(
        `/client/contacts/friend-requests/${encodeURIComponent(requestId)}/reject`,
        { method: 'POST' },
      ),
    removeContact: (friendUserId: string) =>
      request<void>(`/client/contacts/${encodeURIComponent(friendUserId)}`, {
        method: 'DELETE',
      }),
    blockContact: (targetUserId: string) =>
      request<void>(
        `/client/contacts/${encodeURIComponent(targetUserId)}/block`,
        { method: 'POST' },
      ),
    unblockContact: (targetUserId: string) =>
      request<void>(
        `/client/contacts/${encodeURIComponent(targetUserId)}/unblock`,
        { method: 'POST' },
      ),
    updateContactRemark: (friendUserId: string, remark: string) =>
      request<void>(
        `/client/contacts/${encodeURIComponent(friendUserId)}/remark`,
        {
          method: 'PUT',
          body: JSON.stringify({ remark }),
        },
      ),

    listSessions: () => request<HubSession[]>('/client/sessions'),
    searchSessions: (q: string) =>
      request<HubSession[]>(
        `/client/sessions/search?q=${encodeURIComponent(q)}`,
      ),
    createPrivateSession: (body: HubCreatePrivateSessionRequest) =>
      request<HubSession>('/client/sessions/private', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    createGroupSession: (body: HubCreateGroupSessionRequest) =>
      request<HubSession>('/client/sessions/group', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    addSessionMembers: (sessionId: string, memberIds: string[]) =>
      request<void>(`/client/sessions/${encodeURIComponent(sessionId)}/members`, {
        method: 'POST',
        body: JSON.stringify({ member_ids: memberIds }),
      }),
    removeSessionMember: (sessionId: string, userId: string) =>
      request<void>(
        `/client/sessions/${encodeURIComponent(sessionId)}/members/${encodeURIComponent(userId)}`,
        { method: 'DELETE' },
      ),
    leaveSession: (sessionId: string) =>
      request<void>(`/client/sessions/${encodeURIComponent(sessionId)}/leave`, {
        method: 'POST',
      }),
    transferSessionOwnership: (sessionId: string, newOwnerId: string) =>
      request<void>(
        `/client/sessions/${encodeURIComponent(sessionId)}/transfer-owner`,
        {
          method: 'POST',
          body: JSON.stringify({ new_owner_id: newOwnerId }),
        },
      ),
    dissolveSession: (sessionId: string) =>
      request<void>(
        `/client/sessions/${encodeURIComponent(sessionId)}/dissolve`,
        { method: 'POST' },
      ),
    updateSessionInfo: (
      sessionId: string,
      body: HubUpdateSessionInfoRequest,
    ) =>
      request<void>(`/client/sessions/${encodeURIComponent(sessionId)}/info`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    updateSessionSettings: (
      sessionId: string,
      body: HubUpdateSessionSettingsRequest,
    ) =>
      request<void>(
        `/client/sessions/${encodeURIComponent(sessionId)}/settings`,
        {
          method: 'PUT',
          body: JSON.stringify(body),
        },
      ),
    deleteSession: (sessionId: string) =>
      request<void>(`/client/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      }),

    sendMessage: (sessionId: string, body: HubSendMessageRequest) =>
      request<HubSendMessageResponse>(
        `/client/sessions/${encodeURIComponent(sessionId)}/messages`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    getMessages: (
      sessionId: string,
      params?: { before_seq?: number; limit?: number },
    ) =>
      request<HubMessage[]>(
        `/client/sessions/${encodeURIComponent(sessionId)}/messages${qs(params ?? {})}`,
      ),
    syncMessages: (
      sessionId: string,
      params?: { after_seq?: number; limit?: number },
    ) =>
      request<HubMessage[]>(
        `/client/sessions/${encodeURIComponent(sessionId)}/messages/sync${qs(params ?? {})}`,
      ),
    markRead: (sessionId: string, lastReadSeq: number) =>
      request<void>(`/client/sessions/${encodeURIComponent(sessionId)}/read`, {
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
      request<void>(
        `/client/messages/${encodeURIComponent(messageId)}/forward`,
        {
          method: 'POST',
          body: JSON.stringify({ target_session_ids: targetSessionIds }),
        },
      ),
    listPinnedMessages: (sessionId: string) =>
      request<HubMessage[]>(
        `/client/sessions/${encodeURIComponent(sessionId)}/pins`,
      ),
    searchMessages: (params: {
      q: string;
      session_id?: string;
      content_type?: string;
      from?: string;
      to?: string;
    }) => request<HubMessage[]>(`/client/messages/search${qs(params)}`),
    searchSessionMessages: (
      sessionId: string,
      params: { q: string; content_type?: string; from?: string; to?: string },
    ) =>
      request<HubMessage[]>(
        `/client/sessions/${encodeURIComponent(sessionId)}/messages/search${qs(params)}`,
      ),

    listNotifications: (params?: {
      unread_only?: boolean;
      limit?: number;
      offset?: number;
    }) =>
      request<HubNotification[]>(
        `/client/notifications${qs(params ?? {})}`,
      ),
    markNotificationRead: (id: string) =>
      requestWithFallback<void>(
        [
          `/client/notifications/${encodeURIComponent(id)}:read`,
          `/client/notifications/${encodeURIComponent(id)}/read`,
        ],
        { method: 'POST' },
      ),
    readAllNotifications: () =>
      requestWithFallback<void>(
        ['/client/notifications:read-all', '/client/notifications/read-all'],
        { method: 'POST' },
      ),

    registerDevice: (body: HubRegisterDeviceRequest) =>
      requestWithFallback<HubDevice>(['/edge/devices:register', '/edge/devices/register'], {
        method: 'POST',
        body: JSON.stringify(normalizeRegisterDeviceRequest(body)),
      }),
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

    addAgentToSession: (
      sessionId: string,
      body: HubAddAgentToSessionRequest,
    ) =>
      request<void>(
        `/client/sessions/${encodeURIComponent(sessionId)}/agents`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      ),
    triggerAgentTask: (triggerMessageId: string, options: HubTriggerAgentTaskOptions = {}) =>
      request<HubAgentTask>('/web/agent-tasks', {
        method: 'POST',
        body: JSON.stringify({ trigger_message_id: triggerMessageId, ...options }),
      }),
    cancelAgentTask: (taskId: string) =>
      requestWithFallback<void>(
        [
          `/web/agent-tasks/${encodeURIComponent(taskId)}:cancel`,
          `/web/agent-tasks/${encodeURIComponent(taskId)}/cancel`,
        ],
        { method: 'POST' },
      ),

    listExecutionTargets: () =>
      request<HubListResponse<HubExecutionTarget>>('/web/execution-targets'),
    createExecutionTarget: (body: HubExecutionTargetRequest) =>
      request<HubExecutionTarget>('/web/execution-targets', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    getExecutionTarget: (id: string) =>
      request<HubExecutionTarget>(
        `/web/execution-targets/${encodeURIComponent(id)}`,
      ),
    updateExecutionTarget: (
      id: string,
      body: Partial<HubExecutionTargetRequest>,
    ) =>
      request<HubExecutionTarget>(
        `/web/execution-targets/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        },
      ),
    deleteExecutionTarget: (id: string) =>
      request<void>(`/web/execution-targets/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    pingExecutionTarget: (id: string) =>
      request<HubExecutionTarget>(
        `/web/execution-targets/${encodeURIComponent(id)}:ping`,
        { method: 'POST' },
      ),
    listAuditEvents: (params?: { pageSize?: number; pageCursor?: string }) =>
      request<HubListResponse<HubAuditEvent>>(
        `/web/audit-events${qs(params ?? {})}`,
      ),
    createRelayCommand: (body: HubRelayCommandRequest) =>
      request<HubRelayCommand>('/web/relay/commands', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    getRelayCommand: (id: string) =>
      request<HubRelayCommand>(`/web/relay/commands/${encodeURIComponent(id)}`),
    ackRelayCommand: (id: string) =>
      request<void>(`/web/relay/commands/${encodeURIComponent(id)}:ack`, {
        method: 'POST',
      }),

    listCustomAgents: () =>
      request<HubCustomAgent[]>('/web/custom-agents'),
    createCustomAgent: (body: HubCustomAgentRequest) =>
      request<HubCustomAgent>('/web/custom-agents', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateCustomAgent: (id: string, body: HubCustomAgentRequest) =>
      request<void>(`/web/custom-agents/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    deleteCustomAgent: (id: string) =>
      request<void>(`/web/custom-agents/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
  };
}

export type HubClient = ReturnType<typeof createHubClient>;

export type RegisterRequest = HubRegisterRequest;
export type LoginRequest = HubLoginRequest;
export type AuthResponse = HubAuthResponse;
export type UserProfile = HubUserProfile;
export type UpdateProfileRequest = HubUpdateProfileRequest;
export type ChangePasswordRequest = HubChangePasswordRequest;
export type SearchResult = HubSearchResult;
export type FriendRequestInfo = HubFriendRequest;
export type ContactInfo = HubContactInfo;
export interface Contact {
  id: string;
  user_id: string;
  friend_id: string;
  status: string;
  remark?: string;
  friend?: UserProfile;
  created_at?: string;
}
export type Session = HubSession;
export type SessionMember = HubSessionMember;
export type CreatePrivateSessionRequest = HubCreatePrivateSessionRequest;
export type CreateGroupSessionRequest = HubCreateGroupSessionRequest;
export type SendMessageRequest = HubSendMessageRequest;
export type SendMessageResponse = HubSendMessageResponse;
export type ReplyToInfo = HubReplyToInfo;
export type MessageResponse = HubMessage;
export type RegisterDeviceRequest = HubRegisterDeviceRequest;
export type Device = HubDevice;
export type AddAgentToSessionRequest = HubAddAgentToSessionRequest;
export type CustomAgentRequest = HubCustomAgentRequest;

function isRouteFallbackError(error: unknown): boolean {
  return error instanceof AppError && (error.status === 404 || error.status === 405);
}

function normalizeRegisterDeviceRequest(
  body: HubRegisterDeviceRequest,
): HubRegisterDeviceRequest & {
  device_name: string;
  device_type: string;
  capabilities?: Record<string, unknown>;
} {
  const normalized = {
    ...body,
    device_name: body.device_name ?? body.device_id,
    device_type: body.device_type ?? 'desktop',
  };

  if (Array.isArray(body.capabilities)) {
    return {
      ...normalized,
      capabilities: Object.fromEntries(body.capabilities.map((capability) => [capability, true])),
    };
  }

  return normalized as HubRegisterDeviceRequest & {
    device_name: string;
    device_type: string;
    capabilities?: Record<string, unknown>;
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function qs(
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      search.set(key, String(value));
    }
  }
  const value = search.toString();
  return value ? `?${value}` : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
