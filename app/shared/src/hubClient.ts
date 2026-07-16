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
  code_challenge_method?: 'S256' | 'plain' | string;
  device_type?: string;
  device_id?: string;
  redirect_uri?: string;
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
  redirect_uri?: string;
}

export interface HubOidcCallbackResponse extends HubAuthResponse {
  // Desktop/Web auth layers historically require a user object on callback success.
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
  content_type: HubContentType | string;
  /** Full reply body when available; clients may send a stub without content. */
  content?: string;
  recalled?: boolean;
  created_at?: string;
}

export interface HubMessageAttachment {
  id: string;
  hash: string;
  size: number;
  mime_type: string;
  original_name?: string;
  /** Present on server-persisted attachments; may be omitted on optimistic local stubs. */
  uploader_user_id?: string;
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
  owner_id?: string;
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
  type?: HubExecutionTargetType;
  target_type?: HubExecutionTargetType | string;
  status?: string;
  endpoint?: string;
  host?: string;
  port?: number | string;
  workspace_root?: string;
  workspace_allowlist?: string[] | string;
  trust_level?: string;
  health_state?: string;
  is_online?: boolean;
  device_id?: string;
  owner_id?: string;
  capabilities?: Record<string, unknown> | string;
  metadata?: Record<string, unknown> | string;
  config?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface HubExecutionTargetRequest {
  name: string;
  type?: HubExecutionTargetType;
  config?: Record<string, unknown>;
  // desktop-rich fields accepted and folded into config by callers/wrappers
  target_type?: string;
  host?: string;
  port?: number | string;
  workspace_root?: string;
  workspace_allowlist?: string[] | string;
  trust_level?: string;
  device_id?: string;
  capabilities?: Record<string, unknown> | string;
  metadata?: Record<string, unknown> | string;
  auth_method?: string;
}

export interface HubExecutionTargetListResponse {
  items: HubExecutionTarget[];
  page: {
    nextCursor?: string;
    hasMore: boolean;
  };
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

export function isHubSuccessCode(code: string): boolean {
  return String(code).toUpperCase() === 'OK';
}

export function unwrapHubResponse<T>(body: unknown, status = 200): T {
  if (!isHubResponseEnvelope(body)) {
    return body as T;
  }

  // Accept case-insensitive OK/ok so fixtures and legacy mocks stay compatible.
  if (!isHubSuccessCode(body.code)) {
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


// ── T3.2 Team / profile / attachment types (ported from desktop∩web) ──
export interface HubAgentRunEventSummary {
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

export interface HubAgentRunEvent {
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

export interface HubCoordinatorRouteDecision {
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

export interface HubAgentTeam {
  id: string;
  owner_id?: string;
  name: string;
  description?: string;
  avatar_url?: string;
  created_at?: string;
  updated_at?: string;
}

export interface HubAgentTeamMember {
  id: string;
  team_id: string;
  agent_profile_id?: string;
  role: 'supervisor' | 'executor' | 'reviewer' | string;
  position?: number;
  created_at?: string;
}

export interface HubAgentTeamDetail extends HubAgentTeam {
  members?: HubAgentTeamMember[];
}

export interface HubAgentTeamRun {
  id: string;
  team_id: string;
  session_id?: string;
  trigger_user_id?: string;
  trigger_message?: string;
  target_id?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | string;
  created_at?: string;
  updated_at?: string;
}

export interface HubAgentTeamAssignment {
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

export interface HubAgentTeamTask {
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

export interface HubAgentTeamEvent {
  id: string;
  team_run_id: string;
  seq: number;
  type: string;
  payload?: string | Record<string, unknown>;
  created_at?: string;
}

export interface HubTeamMemberState {
  member_id: string;
  agent_profile_id?: string;
  role: string;
  active_tasks?: number;
  completed_tasks?: number;
}

export interface HubTeamTaskState {
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

export interface HubTeamAssignmentState {
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

export interface HubTeamApprovalState {
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

export interface HubTeamArtifactState {
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

export interface HubTeamConflictState {
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

export interface HubTeamRunEventState {
  agent_task_id: string;
  edge_run_id?: string;
  event_seq: number;
  event_type: string;
  payload?: string;
  created_at?: string;
}

export interface HubTeamBudget {
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

export interface HubTeamRunState {
  run_id: string;
  team_id: string;
  status: string;
  members?: HubTeamMemberState[];
  tasks?: HubTeamTaskState[];
  dependencies?: Array<Record<string, unknown>>;
  assignments?: HubTeamAssignmentState[];
  approvals?: HubTeamApprovalState[];
  artifacts?: HubTeamArtifactState[];
  conflicts?: HubTeamConflictState[];
  run_events?: HubTeamRunEventState[];
  route_log?: HubCoordinatorRouteDecision[];
  budget?: HubTeamBudget;
  terminal_reason?: string;
}

export interface HubTeamApprovalDecisionRequest {
  decision: 'allow' | 'deny';
  reason?: string;
}

export interface HubTeamConflictResolutionRequest {
  resolution: string;
  path?: string;
  selected_agent_task_id?: string;
  reason?: string;
}

export interface HubCreateAgentTeamRequest {
  name: string;
  description?: string;
}

export interface HubUpdateAgentTeamRequest {
  name: string;
  description?: string;
}

export interface HubAddAgentTeamMemberRequest {
  agent_profile_id: string;
  role: 'supervisor' | 'executor' | 'reviewer' | string;
}

export interface HubStartAgentTeamRunRequest {
  trigger_message: string;
  target_id?: string;
}

export interface HubAttachmentRef {
  id: string;
  hash: string;
  size: number;
  mime_type: string;
  original_name?: string;
  uploader_user_id?: string;
  metadata?: string;
  created_at?: string;
}

export interface HubProbeAttachmentResponse {
  exists: boolean;
  attachment?: HubAttachmentRef;
}

export interface HubAgentProfile {
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
  memory_policy?: string;
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

export interface HubAgentProfileListResponse {
  items: HubAgentProfile[];
  page: {
    nextCursor?: string;
    hasMore: boolean;
  };
}

export interface HubCreateAgentProfileRequest {
  name: string;
  description?: string;
  runtime_id: string;
  model?: string;
  provider?: string;
  reasoning_effort?: string;
  permission_mode?: string;
  skills?: string;
  mcp_servers?: string;
  tool_allowlist?: string;
  approval_policy?: string;
  target_preferences?: string;
  context_budget_max_tokens?: number;
}

export type HubUpdateAgentProfileRequest = Partial<HubCreateAgentProfileRequest>;

// ── Hub workspace projects ──────────────────

// Compatibility aliases (desktop/web historical names)
export type AgentRunEventSummary = HubAgentRunEventSummary;
export type AgentRunEvent = HubAgentRunEvent;
export type CoordinatorRouteDecision = HubCoordinatorRouteDecision;
export type AgentTeam = HubAgentTeam;
export type AgentTeamMember = HubAgentTeamMember;
export type AgentTeamDetail = HubAgentTeamDetail;
export type AgentTeamRun = HubAgentTeamRun;
export type AgentTeamAssignment = HubAgentTeamAssignment;
export type AgentTeamTask = HubAgentTeamTask;
export type AgentTeamEvent = HubAgentTeamEvent;
export type TeamMemberState = HubTeamMemberState;
export type TeamTaskState = HubTeamTaskState;
export type TeamAssignmentState = HubTeamAssignmentState;
export type TeamApprovalState = HubTeamApprovalState;
export type TeamArtifactState = HubTeamArtifactState;
export type TeamConflictState = HubTeamConflictState;
export type TeamRunEventState = HubTeamRunEventState;
export type TeamBudget = HubTeamBudget;
export type TeamRunState = HubTeamRunState;
export type TeamApprovalDecisionRequest = HubTeamApprovalDecisionRequest;
export type TeamConflictResolutionRequest = HubTeamConflictResolutionRequest;
export type CreateAgentTeamRequest = HubCreateAgentTeamRequest;
export type UpdateAgentTeamRequest = HubUpdateAgentTeamRequest;
export type AddAgentTeamMemberRequest = HubAddAgentTeamMemberRequest;
export type StartAgentTeamRunRequest = HubStartAgentTeamRunRequest;
export type AttachmentRef = HubAttachmentRef;
export type ProbeAttachmentResponse = HubProbeAttachmentResponse;
export type AgentProfile = HubAgentProfile;
export type AgentProfileListResponse = HubAgentProfileListResponse;
export type CreateAgentProfileRequest = HubCreateAgentProfileRequest;
export type UpdateAgentProfileRequest = HubUpdateAgentProfileRequest;


// ── T3.3 desktop-only remainder (documents + stream event options) ──
export interface HubDocumentListItem {
  id: string;
  owner_id: string;
  project_id?: string;
  title: string;
  type: string;
  source: string;
  source_ref?: string;
  tag?: string;
  location: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface HubDocumentListResponse {
  items: HubDocumentListItem[];
  page: {
    nextCursor?: string;
    hasMore: boolean;
  };
}

export interface HubCreateDocumentRequest {
  title: string;
  type?: string;
  source?: string;
  tag?: string;
  location?: string;
  content?: string;
  metadata?: string;
  project_id?: string;
}

export interface HubUpdateDocumentRequest {
  title?: string;
  type?: string;
  source?: string;
  tag?: string;
  location?: string;
  status?: string;
  content?: string;
  metadata?: string;
  project_id?: string;
}

export interface HubDocument {
  id: string;
  owner_id: string;
  project_id?: string;
  title: string;
  type: string;
  source: 'user' | 'artifact' | 'upload' | 'external' | string;
  source_ref?: string;
  tag?: string;
  location: string;
  status: 'active' | 'archived' | 'deleted' | string;
  content?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface HubAgentTaskStreamEventOptions {
  runId?: string;
  clientMsgId?: string;
}

export type CreateHubDocumentRequest = HubCreateDocumentRequest;
export type UpdateHubDocumentRequest = HubUpdateDocumentRequest;
export type AgentTaskStreamEventOptions = HubAgentTaskStreamEventOptions;


// ── T3.4 web-only task approval/artifact types ──
export interface HubAgentTaskApproval {
  approval_id: string;
  task_id?: string;
  edge_run_id?: string;
  session_id?: string;
  source_event_id?: string;
  event_seq?: number;
  request_id?: string;
  tool_name?: string;
  tool_use_id?: string;
  status?: string;
  reason?: string;
  decided_by?: string;
  created_at?: string;
  decided_at?: string;
  edge_control?: Record<string, unknown>;
}

export interface HubAgentTaskApprovalList {
  task_id: string;
  edge_run_id?: string;
  session_id?: string;
  approvals: HubAgentTaskApproval[];
  pending?: HubAgentTaskApproval[];
  decided?: HubAgentTaskApproval[];
  last_event_seq?: number;
}

export interface HubAgentTaskArtifact {
  task_id?: string;
  edge_run_id?: string;
  session_id?: string;
  source_event_id?: string;
  event_seq?: number;
  path?: string;
  action?: string;
  tool_name?: string;
  status?: string;
  artifact_id?: string;
  name?: string;
  mime_type?: string;
  size_bytes?: number;
  diff?: string;
  patch?: string;
  edit_id?: string;
  review_status?: string;
  can_apply?: boolean;
  can_revert?: boolean;
  type?: string;
  kind?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface HubAgentTaskArtifactList {
  task_id: string;
  edge_run_id?: string;
  session_id?: string;
  artifacts: HubAgentTaskArtifact[];
  last_event_seq?: number;
}

export interface HubTaskApprovalDecisionRequest {
  decision: 'allow' | 'deny';
  reason?: string;
}

export type AgentTaskApproval = HubAgentTaskApproval;
export type AgentTaskApprovalList = HubAgentTaskApprovalList;
export type AgentTaskArtifact = HubAgentTaskArtifact;
export type AgentTaskArtifactList = HubAgentTaskArtifactList;
export type TaskApprovalDecisionRequest = HubTaskApprovalDecisionRequest;

export interface HubAgentInstance {
  id: string;
  agent_type: string;
  custom_agent_id?: string;
  session_id: string;
  inviter_user_id: string;
  workspace_id?: string;
  display_name: string;
  created_at?: string;
}

export interface HubPendingAgentTask {
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

export type AgentInstance = HubAgentInstance;
export type PendingAgentTask = HubPendingAgentTask;

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


  async function uploadMultipart<T>(path: string, formData: FormData): Promise<T> {
    const token = opts.getToken?.();
    const headers = new Headers();
    // Let the runtime set multipart boundary; do not force JSON content-type.
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await (fetchImpl ?? globalThis.fetch)(`${baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        throw await parseHubError(response);
      }
      if (response.status === 204) {
        return undefined as T;
      }
      return unwrapHubResponse<T>(await readJson(response), response.status);
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
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
      request<HubAgentInstance>(
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

    listExecutionTargets: async (params?: {
      pageSize?: number;
      pageCursor?: string;
      target_type?: string;
    }) => {
      const data = await request<HubExecutionTarget[] | HubExecutionTargetListResponse>(
        `/web/execution-targets${qs(params ?? {})}`,
      );
      if (Array.isArray(data)) {
        return { items: data, page: { hasMore: false } };
      }
      return {
        items: Array.isArray(data.items) ? data.items : [],
        page: data.page ?? { hasMore: false },
      };
    },
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

    // ── T3.2 parity: team/settings/attachments/message extras (desktop∩web) ──
    editMessage: (messageId: string, body: { content: string }) =>
      request<HubMessage>(`/client/messages/${encodeURIComponent(messageId)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),

    addMessageReaction: (messageId: string, sessionId: string, reaction: { emoji: string }) =>
      request<undefined>(`/client/messages/${encodeURIComponent(messageId)}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId, ...reaction }),
      }),

    removeMessageReaction: (messageId: string, sessionId: string, reaction: { emoji: string }) =>
      request<undefined>(`/client/messages/${encodeURIComponent(messageId)}/reactions`, {
        method: 'DELETE',
        body: JSON.stringify({ session_id: sessionId, ...reaction }),
      }),

    listMessageReactions: (messageId: string, sessionId: string) =>
      request<Record<string, unknown>[]>(`/client/messages/${encodeURIComponent(messageId)}/reactions?session_id=${encodeURIComponent(sessionId)}`),

    getTaskRunEventSummary: (taskId: string) =>
      request<HubAgentRunEventSummary>(`/web/agent-tasks/${encodeURIComponent(taskId)}/events/summary`),

    /** List all run events for a task (used for initial load / full replay). */
    listTaskRunEvents: (taskId: string) =>
      request<HubAgentRunEvent[]>(`/web/agent-tasks/${encodeURIComponent(taskId)}/events`),

    /** Fetch task run events with event_seq strictly after the given value (for replay gap fill). */
    listTaskRunEventsAfter: (taskId: string, afterSeq: number) =>
      request<HubAgentRunEvent[]>(`/web/agent-tasks/${encodeURIComponent(taskId)}/events${qs({ after_seq: afterSeq, limit: 500 })}`),

    createAgentTeam: (data: HubCreateAgentTeamRequest) =>
      request<HubAgentTeam>('/web/agent-teams', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    listAgentTeams: () =>
      request<HubAgentTeam[]>('/web/agent-teams'),

    getAgentTeam: (teamId: string) =>
      request<HubAgentTeamDetail>(`/web/agent-teams/${encodeURIComponent(teamId)}`),

    updateAgentTeam: (teamId: string, data: HubUpdateAgentTeamRequest) =>
      request<void>(`/web/agent-teams/${encodeURIComponent(teamId)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    deleteAgentTeam: (teamId: string) =>
      request<void>(`/web/agent-teams/${encodeURIComponent(teamId)}`, { method: 'DELETE' }),

    addAgentTeamMember: (teamId: string, data: HubAddAgentTeamMemberRequest) =>
      request<void>(`/web/agent-teams/${encodeURIComponent(teamId)}/members`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    startTeamRun: (teamId: string, data: HubStartAgentTeamRunRequest) =>
      request<HubAgentTeamRun>(`/web/agent-teams/${encodeURIComponent(teamId)}/runs`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    listTeamRuns: (teamId: string) =>
      request<HubAgentTeamRun[]>(`/web/agent-teams/${encodeURIComponent(teamId)}/runs`),

    getTeamRun: (teamId: string, runId: string) =>
      request<HubAgentTeamRun>(
        `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}`,
      ),

    getTeamRunState: (teamId: string, runId: string) =>
      request<HubTeamRunState>(
        `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/state`,
      ),

    listTeamEvents: (teamId: string, runId: string) =>
      request<HubAgentTeamEvent[]>(
        `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/events`,
      ),

    listTeamTasks: (teamId: string, runId: string) =>
      request<HubAgentTeamTask[]>(
        `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/tasks`,
      ),

    decideTeamApproval: (
      teamId: string,
      runId: string,
      approvalId: string,
      decision: HubTeamApprovalDecisionRequest,
    ) =>
      request<HubTeamApprovalState>(
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
      resolution: HubTeamConflictResolutionRequest,
    ) =>
      request<HubTeamConflictState>(
        `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/conflicts/${encodeURIComponent(conflictId)}/resolve`,
        {
          method: 'POST',
          body: JSON.stringify(resolution),
        },
      ),

    listAgentProfiles: (params?: {
      runtime_id?: string;
      q?: string;
      pageCursor?: string;
      pageSize?: number;
    }) =>
      request<HubAgentProfileListResponse>(`/web/agent-profiles${qs(params ?? {})}`),

    createAgentProfile: (data: HubCreateAgentProfileRequest) =>
      request<HubAgentProfile>('/web/agent-profiles', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    updateAgentProfile: (id: string, data: HubUpdateAgentProfileRequest) =>
      request<HubAgentProfile>(`/web/agent-profiles/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    deleteAgentProfile: (id: string) =>
      request<undefined>(`/web/agent-profiles/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    fetchSettings: () =>
      request<Record<string, string>>('/client/settings'),

    patchSettings: (values: Record<string, string>) =>
      request<Record<string, string>>('/client/settings', {
        method: 'PATCH',
        body: JSON.stringify({ values }),
      }),

    /** Check if an attachment with the given SHA-256 hash already exists. */
    probeAttachment: (hash: string) =>
      request<HubProbeAttachmentResponse>('/client/attachments/probe', {
        method: 'POST',
        body: JSON.stringify({ hash }),
      }),

    /** Upload a file as multipart/form-data. The client must compute the SHA-256 hash. */
    uploadAttachment: (file: File, hash: string) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('hash', hash);
      formData.append('original_name', file.name);
      return uploadMultipart<HubAttachmentRef>('/client/attachments', formData);
    },

    /** Get the download URL for an attachment (relative to Hub base). */
    downloadAttachmentUrl: (attachmentId: string) =>
      `${baseUrl}/client/attachments/${encodeURIComponent(attachmentId)}`,



    // ── T3.3 desktop remainder methods ──
    listDocuments: (params?: {
      status?: string;
      source?: string;
      tag?: string;
      pageCursor?: string;
      pageSize?: number;
    }) =>
      request<HubDocumentListResponse>(`/web/documents${qs(params ?? {})}`),

    getDocument: (id: string) =>
      request<HubDocument>(`/web/documents/${encodeURIComponent(id)}`),

    createDocument: (data: HubCreateDocumentRequest) =>
      request<HubDocument>('/web/documents', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    updateDocument: (id: string, data: HubUpdateDocumentRequest) =>
      request<HubDocument>(`/web/documents/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    deleteDocument: (id: string) =>
      request<undefined>(`/web/documents/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    getAgentProfile: (id: string) =>
      request<HubAgentProfile>(`/web/agent-profiles/${encodeURIComponent(id)}`),

    removeAgentTeamMember: (teamId: string, memberId: string) =>
      request<undefined>(
        `/web/agent-teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(memberId)}`,
        { method: 'DELETE' },
      ),

    postTeamRouteDecision: (teamId: string, runId: string, decision: HubCoordinatorRouteDecision) =>
      request<Record<string, unknown>>(
        `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/route-decisions`,
        {
          method: 'POST',
          body: JSON.stringify(decision),
        },
      ),

    streamTaskEvent: (
      taskId: string,
      eventType: string,
      payload: unknown,
      options: HubAgentTaskStreamEventOptions = {},
    ) =>
      request<undefined>(`/edge/agent-tasks/${encodeURIComponent(taskId)}/stream`, {
        method: 'POST',
        body: JSON.stringify({
          event_type: eventType,
          payload,
          ...(options.runId ? { run_id: options.runId } : {}),
          ...(options.clientMsgId ? { client_msg_id: options.clientMsgId } : {}),
        }),
      }),


    // ── T3.4 web task approvals/artifacts ──
    listTaskApprovals: (taskId: string) =>
      request<HubAgentTaskApprovalList>(`/web/agent-tasks/${encodeURIComponent(taskId)}/approvals`),

    decideTaskApproval: (taskId: string, approvalId: string, decision: HubTaskApprovalDecisionRequest) =>
      request<HubAgentTaskApproval>(
        `/web/agent-tasks/${encodeURIComponent(taskId)}/approvals/${encodeURIComponent(approvalId)}/decide`,
        {
          method: 'POST',
          body: JSON.stringify(decision),
        },
      ),

    listTaskArtifacts: (taskId: string) =>
      request<HubAgentTaskArtifactList>(`/web/agent-tasks/${encodeURIComponent(taskId)}/artifacts`),

  };
}

export type HubClient = ReturnType<typeof createHubClient>;
export type EmptyHubResponse = undefined;

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
export type ExecutionTargetListResponse = HubExecutionTargetListResponse;
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
    // T3.2 landed these on shared createHubClient
  ],
  /** Desktop-only relative to web (keep desktop-local until product decision). */
  desktopOnly: [
    // create/updateExecutionTarget request-shape differences may remain surface-local
  ],
  /** Web-only relative to desktop. */
  webOnly: [
    // T3.4 landed task approvals/artifacts on shared
  ],
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
