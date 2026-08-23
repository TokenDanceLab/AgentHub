/**
 * Hub client core domain DTOs (auth, IM, workspace, task, execution, audit, relay).
 * Extracted from hubClient.ts (#777) — pure types only; re-exported by hubClient.
 * Keep public names stable for web/desktop imports via @shared/hub/hubClient.
 */

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
  | 'remote_ssh'
  | 'tailscale'
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
  // Server DTO (hub-server execution_target.go) serializes the last heartbeat
  // and the auth method; surfaced in the Devices health detail (#1819).
  last_seen_at?: string;
  auth_method?: string;
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
