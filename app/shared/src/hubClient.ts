import { AppError, isErrorResponse, reportApiError } from './errors';
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
  /** Request timeout in milliseconds. Default: 30000 (30s). */
  timeoutMs?: number;
  /**
   * Called when a 401 response is received.  If provided, the client will:
   * 1. Call onRefreshToken() to attempt a token refresh.
   * 2. Retry the original request once with the new token.
   * If not provided, 401 errors are thrown immediately.
   */
  onRefreshToken?: () => Promise<string | null>;
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
  tokendance_sub?: string;
  tokendance_sub_linked_at?: string;
  created_at?: string;
  updated_at?: string;
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
  workspace_id?: string;
  pinned?: boolean;
  archived?: boolean;
  muted?: boolean;
  dissolved?: boolean;
  next_seq?: number;
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
  pinned?: boolean;
  archived?: boolean;
  muted?: boolean;
  last_read_seq?: number;
  joined_at?: string;
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

export interface HubMessageAttachment {
  id: string;
  hash: string;
  size: number;
  mime_type: string;
  original_name?: string;
  uploader_user_id: string;
  metadata?: string;
  created_at?: string;
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
  edited?: boolean;
  edited_at?: string;
  attachments?: HubMessageAttachment[];
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
  capabilities?: string[];
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

export interface HubSkill {
  id: string;
  name: string;
  description?: string;
  skill_type?: string;
  version?: string;
  install_count?: number;
  is_public?: boolean;
  owner_id?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface HubMCPServer {
  id: string;
  name: string;
  description?: string;
  transport?: string;
  command?: string;
  url?: string;
  install_count?: number;
  is_public?: boolean;
  owner_id?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface HubWorkspaceProject {
  id: string;
  name: string;
  description?: string;
  owner_id: string;
  created_at?: string;
  updated_at?: string;
}

export interface HubWorkspaceProjectListResponse {
  items: HubWorkspaceProject[];
  page: HubPageInfo;
}

export interface HubCreateWorkspaceProjectRequest {
  name: string;
  description?: string;
}

export type HubUpdateWorkspaceProjectRequest = Partial<HubCreateWorkspaceProjectRequest>;

export interface HubWorkspaceProjectThread {
  id: string;
  project_id: string;
  type?: string;
  name: string;
  owner_user_id?: string;
  role?: string;
  member_count: number;
  last_message_at?: string;
  created_at: string;
}

export interface HubCreateWorkspaceProjectThreadRequest {
  name: string;
}

export interface HubSendWorkspaceProjectThreadMessageRequest {
  client_msg_id: string;
  content_type: string;
  content: string;
}

export interface HubWorkspaceProjectThreadMessage {
  id: string;
  project_id: string;
  thread_id: string;
  seq_id: number;
  client_msg_id: string;
  sender_type: string;
  sender_id: string;
  content_type: string;
  content: string;
  created_at: string;
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
  target_id?: string;
  edge_device_id?: string;
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

export interface HubAgentRegeneratePayload {
  original_task_id: string;
  new_task_id: string;
  trigger_message_id: string;
  agent_instance_id: string;
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
export type HubAgentRegenerateFrame = HubFrame<
  HubAgentRegeneratePayload,
  typeof HUB_EVENTS.AGENT_REGENERATE
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

// ── WS frame types matching hub-server/internal/ws/frame.go ──

export interface HubMessageEditedPayload {
  id: string;
  session_id: string;
  seq_id: number;
  content_type: string;
  content: string;
  edited: boolean;
  edited_at?: string;
}

export type HubMessageEditedFrame = HubFrame<
  HubMessageEditedPayload,
  typeof HUB_EVENTS.MESSAGE_EDITED
>;

export interface HubMessagePinPayload {
  session_id: string;
  message_id: string;
  pinned_by_user_id: string;
  pinned_at: string;
}

export type HubMessagePinFrame = HubFrame<
  HubMessagePinPayload,
  typeof HUB_EVENTS.MESSAGE_PIN
>;

export interface HubMessageUnpinPayload {
  session_id: string;
  message_id: string;
}

export type HubMessageUnpinFrame = HubFrame<
  HubMessageUnpinPayload,
  typeof HUB_EVENTS.MESSAGE_UNPIN
>;

export interface HubMessageReactionPayload {
  action: string;
  user_id: string;
  message_id: string;
  session_id: string;
  reaction: string;
  count: number;
}

export type HubMessageReactionAddedFrame = HubFrame<
  HubMessageReactionPayload,
  typeof HUB_EVENTS.MESSAGE_REACTION_ADDED
>;

export type HubMessageReactionRemovedFrame = HubFrame<
  HubMessageReactionPayload,
  typeof HUB_EVENTS.MESSAGE_REACTION_REMOVED
>;

export interface HubSessionMemberEventPayload {
  session_id: string;
  member_id: string;
  member_type?: string;
}

export type HubSessionMemberJoinedFrame = HubFrame<
  HubSessionMemberEventPayload,
  typeof HUB_EVENTS.SESSION_MEMBER_JOINED
>;

export type HubSessionMemberLeftFrame = HubFrame<
  HubSessionMemberEventPayload,
  typeof HUB_EVENTS.SESSION_MEMBER_LEFT
>;

export type HubKnownFrame =
  | HubAuthFrame
  | HubAuthOkFrame
  | HubAuthFailFrame
  | HubMessageNewFrame
  | HubMessageEditedFrame
  | HubMessageRecallFrame
  | HubMessagePinFrame
  | HubMessageUnpinFrame
  | HubMessageReadFrame
  | HubMessageReactionAddedFrame
  | HubMessageReactionRemovedFrame
  | HubSessionCreatedFrame
  | HubSessionInfoUpdatedFrame
  | HubSessionDissolvedFrame
  | HubSessionMemberJoinedFrame
  | HubSessionMemberLeftFrame
  | HubAgentDispatchFrame
  | HubAgentStreamFrame
  | HubAgentDoneFrame
  | HubAgentFailedFrame
  | HubAgentCancelFrame
  | HubAgentRegenerateFrame
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

    const timeoutMs = opts.timeoutMs ?? 30_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const signal = controller.signal;

    try {
      const response = await (fetchImpl ?? globalThis.fetch)(`${baseUrl}${path}`, {
        ...options,
        headers,
        signal,
      });
      clearTimeout(timeoutId);

      // ── Token refresh recovery on 401 ──────────────────
      if (response.status === 401 && opts.onRefreshToken) {
        try {
          const newToken = await opts.onRefreshToken();
          if (newToken) {
            // Retry once with fresh token
            headers.set('Authorization', `Bearer ${newToken}`);
            const retryController = new AbortController();
            const retryTimeoutId = setTimeout(() => retryController.abort(), timeoutMs);
            try {
              const retryResponse = await (fetchImpl ?? globalThis.fetch)(`${baseUrl}${path}`, {
                ...options,
                headers,
                signal: retryController.signal,
              });
              clearTimeout(retryTimeoutId);
              if (!retryResponse.ok) {
                throw await parseHubError(retryResponse);
              }
              if (retryResponse.status === 204) {
                return undefined as T;
              }
              return unwrapHubResponse<T>(await readJson(retryResponse), retryResponse.status);
            } catch (retryErr) {
              clearTimeout(retryTimeoutId);
              throw retryErr;
            }
          }
        } catch (refreshErr) {
          console.error('[HubClient] Token refresh failed', refreshErr);
          reportApiError(refreshErr instanceof Error ? refreshErr : new Error(String(refreshErr)), {
            path,
            context: 'token_refresh',
          });
        }
      }

      if (!response.ok) {
        throw await parseHubError(response);
      }
      if (response.status === 204) {
        return undefined as T;
      }

      return unwrapHubResponse<T>(await readJson(response), response.status);
    } catch (error) {
      clearTimeout(timeoutId);

      // Surface timeout as a distinct error
      if (error instanceof DOMException && error.name === 'AbortError') {
        const timeoutError = new AppError(
          {
            error: {
              code: 'TIMEOUT',
              message: `Request timed out after ${timeoutMs}ms: ${options.method ?? 'GET'} ${path}`,
            },
          },
          0,
        );
        console.error(`[HubClient] ${timeoutError.message}`);
        reportApiError(timeoutError, { path, method: options.method ?? 'GET', timeoutMs });
        throw timeoutError;
      }

      // Report all other errors
      if (error instanceof AppError) {
        reportApiError(error, { path, method: options.method ?? 'GET' });
      } else if (error instanceof TypeError && error.message.includes('fetch')) {
        const netError = new AppError(
          {
            error: {
              code: 'NETWORK_ERROR',
              message: `Network request failed: ${error.message}`,
            },
          },
          0,
        );
        console.error(`[HubClient] ${netError.message}`);
        reportApiError(netError, { path, method: options.method ?? 'GET' });
        throw netError;
      }
      throw error;
    }
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
      request<HubCreateSessionResponse>('/client/sessions/private', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    createGroupSession: (body: HubCreateGroupSessionRequest) =>
      request<HubCreateSessionResponse>('/client/sessions/group', {
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

    regenerateAgentTask: (taskId: string) =>
      request<HubAgentTask>(`/web/agent-tasks/${encodeURIComponent(taskId)}/regenerate`, {
        method: 'POST',
      }),

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

    listPublicSkills: (params?: {
      skill_type?: string;
      q?: string;
      is_public?: string;
      pageCursor?: string;
      pageSize?: number;
    }) =>
      request<HubListResponse<HubSkill>>(
        `/web/skills${qs({ is_public: 'true', ...params ?? {} })}`,
      ),

    listPublicMCPServers: (params?: {
      transport?: string;
      q?: string;
      is_public?: string;
      pageCursor?: string;
      pageSize?: number;
    }) =>
      request<HubListResponse<HubMCPServer>>(
        `/web/mcp-servers${qs({ is_public: 'true', ...params ?? {} })}`,
      ),

    // ── Workspace Projects ──────────────────────────────────────────
    listWorkspaceProjects: (params?: { pageSize?: number; pageCursor?: string; q?: string }) =>
      request<HubWorkspaceProjectListResponse>(`/web/projects${qs(params ?? {})}`),
    getWorkspaceProject: (id: string) =>
      request<HubWorkspaceProject>(`/web/projects/${encodeURIComponent(id)}`),
    createWorkspaceProject: (data: HubCreateWorkspaceProjectRequest) =>
      request<HubWorkspaceProject>('/web/projects', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateWorkspaceProject: (id: string, data: HubUpdateWorkspaceProjectRequest) =>
      request<HubWorkspaceProject>(`/web/projects/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    listWorkspaceProjectThreads: (projectId: string) =>
      request<HubWorkspaceProjectThread[]>(`/web/projects/${encodeURIComponent(projectId)}/threads`),
    createWorkspaceProjectThread: (projectId: string, data: HubCreateWorkspaceProjectThreadRequest) =>
      request<HubWorkspaceProjectThread>(`/web/projects/${encodeURIComponent(projectId)}/threads`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    listWorkspaceProjectThreadMessages: (
      projectId: string,
      threadId: string,
      params?: { limit?: number },
    ) =>
      request<HubWorkspaceProjectThreadMessage[]>(
        `/web/projects/${encodeURIComponent(projectId)}/threads/${encodeURIComponent(threadId)}/messages${qs(params ?? {})}`,
      ),
    sendWorkspaceProjectThreadMessage: (
      projectId: string,
      threadId: string,
      data: HubSendWorkspaceProjectThreadMessageRequest,
    ) =>
      request<HubWorkspaceProjectThreadMessage>(
        `/web/projects/${encodeURIComponent(projectId)}/threads/${encodeURIComponent(threadId)}/messages`,
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
      ),
  };
}

export type HubClient = ReturnType<typeof createHubClient>;

// ---------------------------------------------------------------------------
// Compatibility aliases (desktop/web historical names → shared Hub* types)
// Slice1 (#430): align names without moving method implementations yet.
// Prefer Hub* names in new shared code; aliases exist so surface forks can
// re-export shared types without a big-bang rename.
// ---------------------------------------------------------------------------
export type RegisterRequest = HubRegisterRequest;
export type LoginRequest = HubLoginRequest;
export type AuthResponse = HubAuthResponse;
export type UserProfile = HubUserProfile;
export type UpdateProfileRequest = HubUpdateProfileRequest;
export type ChangePasswordRequest = HubChangePasswordRequest;
export type SearchResult = HubSearchResult;
export type FriendRequestInfo = HubFriendRequest;
export type ContactInfo = HubContactInfo;
/** @deprecated Prefer HubContactInfo / relationship fields; kept for desktop/web parity. */
export interface Contact {
  id: string;
  user_id: string;
  friend_id: string;
  status: string;
  remark?: string;
  friend?: UserProfile;
  created_at?: string;
}
/** Alias: desktop/web historically used Session; shared canonical type is HubSession. */
export type Session = HubSession;
export type HubSessionAlias = HubSession;
export type SessionMember = HubSessionMember;
export type CreatePrivateSessionRequest = HubCreatePrivateSessionRequest;
export type CreateGroupSessionRequest = HubCreateGroupSessionRequest;
export type SendMessageRequest = HubSendMessageRequest;
export type SendMessageResponse = HubSendMessageResponse;
export type ReplyToInfo = HubReplyToInfo;
export type MessageResponse = HubMessage;
export type MessageAttachment = HubMessageAttachment;
export type RegisterDeviceRequest = HubRegisterDeviceRequest;
export type Device = HubDevice;
export type AddAgentToSessionRequest = HubAddAgentToSessionRequest;
export type CustomAgentRequest = HubCustomAgentRequest;
export type CustomAgent = HubCustomAgent;
export type Notification = HubNotification;
export type ExecutionTarget = HubExecutionTarget;
export type ExecutionTargetType = HubExecutionTargetType;
export type ExecutionTargetRequest = HubExecutionTargetRequest;
export type WorkspaceProject = HubWorkspaceProject;
export type WorkspaceProjectListResponse = HubWorkspaceProjectListResponse;
export type CreateWorkspaceProjectRequest = HubCreateWorkspaceProjectRequest;
export type UpdateWorkspaceProjectRequest = HubUpdateWorkspaceProjectRequest;
export type WorkspaceProjectThread = HubWorkspaceProjectThread;
export type CreateWorkspaceProjectThreadRequest = HubCreateWorkspaceProjectThreadRequest;
export type SendWorkspaceProjectThreadMessageRequest = HubSendWorkspaceProjectThreadMessageRequest;
export type WorkspaceProjectThreadMessage = HubWorkspaceProjectThreadMessage;
export type AgentTask = HubAgentTask;
export type TriggerAgentTaskOptions = HubTriggerAgentTaskOptions;
export type OIDCAuthorizeRequest = HubOidcAuthorizeRequest;
export type OIDCAuthorizeResponse = HubOidcAuthorizeResponse;
export type OIDCCallbackRequest = HubOidcCallbackRequest;
export type OIDCCallbackResponse = HubOidcCallbackResponse;
export type Skill = HubSkill;
export type MCPServer = HubMCPServer;

/**
 * Method groups still owned by desktop/web forks (not yet on shared createHubClient).
 * Tracked for T3.2 method parity — do not implement ad-hoc only on one surface.
 * @see docs/analysis/hubclient-ssot-slice1.md
 */
export const HUBCLIENT_SSOT_GAPS = {
  /** Present on both desktop and web, missing from shared createHubClient return. */
  desktopAndWebNotShared: [
    'addAgentTeamMember',
    'addMessageReaction',
    'createAgentProfile',
    'createAgentTeam',
    'decideTeamApproval',
    'deleteAgentProfile',
    'deleteAgentTeam',
    'downloadAttachmentUrl',
    'editMessage',
    'fetchSettings',
    'getAgentTeam',
    'getTaskRunEventSummary',
    'getTeamRun',
    'getTeamRunState',
    'listAgentProfiles',
    'listAgentTeams',
    'listMessageReactions',
    'listTaskRunEvents',
    'listTaskRunEventsAfter',
    'listTeamEvents',
    'listTeamRuns',
    'listTeamTasks',
    'patchSettings',
    'probeAttachment',
    'removeMessageReaction',
    'resolveTeamConflict',
    'startTeamRun',
    'updateAgentProfile',
    'updateAgentTeam',
    'uploadAttachment',
  ],
  /** Desktop-only relative to web (keep desktop-local until product decision). */
  desktopOnly: [
    'createDocument',
    'createExecutionTarget',
    'deleteDocument',
    'getAgentProfile',
    'getDocument',
    'listDocuments',
    'postTeamRouteDecision',
    'removeAgentTeamMember',
    'streamTaskEvent',
    'updateDocument',
    'updateExecutionTarget',
  ],
  /** Web-only relative to desktop. */
  webOnly: ['decideTaskApproval', 'listTaskApprovals', 'listTaskArtifacts'],
} as const;

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
