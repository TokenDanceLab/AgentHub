// Typed REST client for Hub Server.
// Handles JWT auth header injection, error parsing, and typed endpoints.
// Covers all routes defined in hub-server/internal/router/router.go.
//
// Uses the same error convention as edgeClient.ts: AppError from @shared/errors.

import { HUB_URL } from '@/config';
import { AppError, reportApiError } from '@shared/errors';

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

export interface MessageAttachment {
  id: string;
  hash: string;
  size: number;
  mime_type: string;
  original_name?: string;
  uploader_user_id?: string;
  metadata?: string;
  created_at?: string;
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
  attachments?: MessageAttachment[];
  edited?: boolean;
  edited_at?: string;
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

export interface AgentInstance {
  id: string;
  agent_type: string;
  custom_agent_id?: string;
  session_id: string;
  inviter_user_id: string;
  workspace_id?: string;
  display_name: string;
  created_at?: string;
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

export interface AgentTaskApproval {
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

export interface AgentTaskApprovalList {
  task_id: string;
  edge_run_id?: string;
  session_id?: string;
  approvals: AgentTaskApproval[];
  pending?: AgentTaskApproval[];
  decided?: AgentTaskApproval[];
  last_event_seq?: number;
}

export interface AgentTaskArtifact {
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
}

export interface AgentTaskArtifactList {
  task_id: string;
  edge_run_id?: string;
  session_id?: string;
  artifacts: AgentTaskArtifact[];
  last_event_seq?: number;
}

export interface TaskApprovalDecisionRequest {
  decision: 'allow' | 'deny';
  reason?: string;
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

export interface AgentProfileListResponse {
  items: AgentProfile[];
  page: {
    nextCursor?: string;
    hasMore: boolean;
  };
}

export interface CreateAgentProfileRequest {
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

export type UpdateAgentProfileRequest = Partial<CreateAgentProfileRequest>;

// 鈹€鈹€ Execution targets 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export type ExecutionTargetType = 'local_edge' | 'hub_relay' | 'remote_ssh' | 'tailscale' | 'cloud_edge';
export type ExecutionTargetTrustLevel = 'local' | 'remote' | 'cloud' | 'relay';
export type ExecutionTargetHealthState =
  | 'unknown'
  | 'healthy'
  | 'online'
  | 'degraded'
  | 'offline'
  | 'mismatch'
  | 'stale';

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

// ── Hub workspace projects ─────────────────────

export interface WorkspaceProject {
  id: string;
  name: string;
  description?: string;
  owner_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface WorkspaceProjectListResponse {
  items: WorkspaceProject[];
  page: {
    nextCursor?: string;
    hasMore: boolean;
  };
}

export interface CreateWorkspaceProjectRequest {
  name: string;
  description?: string;
}

export type UpdateWorkspaceProjectRequest = Partial<CreateWorkspaceProjectRequest>;

export interface WorkspaceProjectThread {
  id: string;
  project_id: string;
  type: string;
  name: string;
  owner_user_id?: string;
  role?: string;
  member_count: number;
  last_message_at?: string;
  created_at: string;
}

export interface CreateWorkspaceProjectThreadRequest {
  name: string;
}

export interface SendWorkspaceProjectThreadMessageRequest {
  client_msg_id?: string;
  content_type?: string;
  content: string;
}

export interface WorkspaceProjectThreadMessage {
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
  target_id?: string;
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
  target_id?: string;
}

// ── Attachments ──────────────────────────────────

export interface AttachmentRef {
  id: string;
  hash: string;
  size: number;
  mime_type: string;
  original_name?: string;
  uploader_user_id?: string;
  metadata?: string;
  created_at?: string;
}

export interface ProbeAttachmentResponse {
  exists: boolean;
  attachment?: AttachmentRef;
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
  /**
   * Called when a 401 response is received.  If provided, the client will:
   * 1. Call onRefreshToken() to attempt a token refresh.
   * 2. Retry the original request once with the new token.
   * If not provided, 401 errors are thrown immediately.
   */
  onRefreshToken?: () => Promise<string | null>;
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

    const timeoutMs = 30_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${base}${path}`, { ...options, headers, signal: controller.signal });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if (fetchErr instanceof DOMException && fetchErr.name === 'AbortError') {
        const timeoutError = new AppError(
          {
            error: {
              code: 'TIMEOUT',
              message: `Hub request timed out after ${timeoutMs}ms: ${options.method ?? 'GET'} ${path}`,
            },
          },
          0,
        );
        console.error(`[hubClient] ${timeoutError.message}`);
        reportApiError(timeoutError, { path, method: options.method ?? 'GET', timeoutMs });
        throw timeoutError;
      }
      if (fetchErr instanceof TypeError && String(fetchErr.message).includes('fetch')) {
        const netError = new AppError(
          {
            error: {
              code: 'NETWORK_ERROR',
              message: `Network request failed: ${(fetchErr as Error).message}`,
            },
          },
          0,
        );
        console.error(`[hubClient] ${netError.message}`);
        reportApiError(netError, { path, method: options.method ?? 'GET' });
        throw netError;
      }
      throw fetchErr;
    }
    clearTimeout(timeoutId);
    const body = res.status === 204 ? undefined : await readJsonBody(res);

    // ── Token refresh recovery on 401 ──────────────────
    if (res.status === 401 && opts.onRefreshToken) {
      try {
        const newToken = await opts.onRefreshToken();
        if (newToken) {
          // Retry once with fresh token
          headers.Authorization = `Bearer ${newToken}`;
          const retryController = new AbortController();
          const retryTimeoutId = setTimeout(() => retryController.abort(), timeoutMs);
          let retryRes: Response;
          try {
            retryRes = await fetch(`${base}${path}`, { ...options, headers, signal: retryController.signal });
          } catch (retryErr) {
            clearTimeout(retryTimeoutId);
            throw retryErr;
          }
          clearTimeout(retryTimeoutId);
          const retryBody = retryRes.status === 204 ? undefined : await readJsonBody(retryRes);

          if (!retryRes.ok) {
            if (isSharedErrorBody(retryBody)) {
              throw new AppError({ error: retryBody.error }, retryRes.status, retryBody);
            }
            if (isHubEnvelope(retryBody)) {
              throw new AppError(
                {
                  error: {
                    code: retryBody.code || 'hub_error',
                    message: retryBody.message || retryRes.statusText || 'Hub request failed',
                  },
                },
                retryRes.status,
                retryBody,
              );
            }
            throw new AppError(
              {
                error: {
                  code: retryRes.status >= 500 ? 'internal_error' : 'bad_request',
                  message: `HTTP ${retryRes.status}: ${retryRes.statusText}`,
                },
              },
              retryRes.status,
              retryBody,
            );
          }

          if (retryRes.status === 204) return undefined as T;
          if (isHubEnvelope<T>(retryBody)) return retryBody.data as T;
          return retryBody as T;
        }
      } catch (refreshErr) {
        if (refreshErr instanceof AppError) {
          reportApiError(refreshErr, { path, method: options.method ?? 'GET', context: 'token_refresh_retry' });
          throw refreshErr;
        }
        console.error('[hubClient] Token refresh failed, proceeding with original 401', refreshErr);
        reportApiError(
          refreshErr instanceof Error ? refreshErr : new Error(String(refreshErr)),
          { path, context: 'token_refresh' },
        );
      }
    }

    if (!res.ok) {
      const appErr = isSharedErrorBody(body)
        ? new AppError({ error: body.error }, res.status, body)
        : isHubEnvelope(body)
          ? new AppError(
              {
                error: {
                  code: body.code || 'hub_error',
                  message: body.message || res.statusText || 'Hub request failed',
                },
              },
              res.status,
              body,
            )
          : new AppError(
              {
                error: {
                  code: res.status >= 500 ? 'internal_error' : 'bad_request',
                  message: `HTTP ${res.status}: ${res.statusText}`,
                },
              },
              res.status,
              body,
            );
      reportApiError(appErr, { path, method: options.method ?? 'GET' });
      throw appErr;
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

  /** Upload a file via multipart/form-data (does NOT set Content-Type header; browser sets it with boundary). */
  async function uploadMultipart<T>(path: string, formData: FormData): Promise<T> {
    const token = opts.getToken?.();
    const headers: Record<string, string> = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    const res = await fetch(`${base}${path}`, { method: 'POST', headers, body: formData, signal: controller.signal });
    clearTimeout(timeoutId);
    const body = res.status === 204 ? undefined : await readJsonBody(res);

    // ── Token refresh recovery on 401 ──────────────────
    if (res.status === 401 && opts.onRefreshToken) {
      try {
        const newToken = await opts.onRefreshToken();
        if (newToken) {
          // Retry once with fresh token
          headers.Authorization = `Bearer ${newToken}`;
          const retryController = new AbortController();
          const retryTimeoutId = setTimeout(() => retryController.abort(), 30_000);
          let retryRes: Response;
          try {
            retryRes = await fetch(`${base}${path}`, { method: 'POST', headers, body: formData, signal: retryController.signal });
          } catch (retryErr) {
            clearTimeout(retryTimeoutId);
            throw retryErr;
          }
          clearTimeout(retryTimeoutId);
          const retryBody = retryRes.status === 204 ? undefined : await readJsonBody(retryRes);

          if (!retryRes.ok) {
            if (isSharedErrorBody(retryBody)) {
              throw new AppError({ error: retryBody.error }, retryRes.status, retryBody);
            }
            if (isHubEnvelope(retryBody)) {
              throw new AppError(
                {
                  error: {
                    code: retryBody.code || 'hub_error',
                    message: retryBody.message || retryRes.statusText || 'Hub upload failed',
                  },
                },
                retryRes.status,
                retryBody,
              );
            }
            throw new AppError(
              {
                error: {
                  code: retryRes.status >= 500 ? 'internal_error' : 'bad_request',
                  message: `HTTP ${retryRes.status}: ${retryRes.statusText}`,
                },
              },
              retryRes.status,
              retryBody,
            );
          }

          if (retryRes.status === 204) return undefined as T;
          if (isHubEnvelope<T>(retryBody)) return retryBody.data as T;
          return retryBody as T;
        }
      } catch (refreshErr) {
        if (refreshErr instanceof AppError) throw refreshErr;
        console.error('[hubClient] Token refresh failed during upload, proceeding with original 401', refreshErr);
      }
    }

    if (!res.ok) {
      if (isSharedErrorBody(body)) {
        throw new AppError({ error: body.error }, res.status, body);
      }
      if (isHubEnvelope(body)) {
        throw new AppError(
          {
            error: {
              code: body.code || 'hub_error',
              message: body.message || res.statusText || 'Hub upload failed',
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
    if (res.status === 204) return undefined as T;
    if (isHubEnvelope<T>(body)) return body.data as T;
    return body as T;
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
    editMessage: (messageId: string, body: { content: string }) =>
      request<MessageResponse>(`/client/messages/${encodeURIComponent(messageId)}`, {
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
      request<AgentInstance>(`/client/sessions/${encodeURIComponent(sessionId)}/agents`, {
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

    regenerateAgentTask: (taskId: string) =>
      request<PendingAgentTask>(`/web/agent-tasks/${encodeURIComponent(taskId)}/regenerate`, { method: 'POST' }),

    listTaskRunEvents: (taskId: string) =>
      request<AgentRunEvent[]>(`/web/agent-tasks/${encodeURIComponent(taskId)}/events`),

    /** Fetch task run events with event_seq strictly after the given value (for replay gap fill). */
    listTaskRunEventsAfter: (taskId: string, afterSeq: number) =>
      request<AgentRunEvent[]>(`/web/agent-tasks/${encodeURIComponent(taskId)}/events${qs({ after_seq: afterSeq, limit: 500 })}`),

    getTaskRunEventSummary: (taskId: string) =>
      request<AgentRunEventSummary>(`/web/agent-tasks/${encodeURIComponent(taskId)}/summary`),

    listTaskApprovals: (taskId: string) =>
      request<AgentTaskApprovalList>(`/web/agent-tasks/${encodeURIComponent(taskId)}/approvals`),

    decideTaskApproval: (taskId: string, approvalId: string, decision: TaskApprovalDecisionRequest) =>
      request<AgentTaskApproval>(`/web/agent-tasks/${encodeURIComponent(taskId)}/approvals/${encodeURIComponent(approvalId)}/decide`, {
        method: 'POST',
        body: JSON.stringify(decision),
      }),

    listTaskArtifacts: (taskId: string) =>
      request<AgentTaskArtifactList>(`/web/agent-tasks/${encodeURIComponent(taskId)}/artifacts`),

    // ── Custom agents ──────────────────────────────────

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

    createAgentProfile: (data: CreateAgentProfileRequest) =>
      request<AgentProfile>('/web/agent-profiles', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    updateAgentProfile: (id: string, data: UpdateAgentProfileRequest) =>
      request<AgentProfile>(`/web/agent-profiles/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    deleteAgentProfile: (id: string) =>
      request<undefined>(`/web/agent-profiles/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    // 鈹€鈹€ Execution targets 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

    listExecutionTargets: (params?: {
      target_type?: ExecutionTargetType | string;
      pageCursor?: string;
      pageSize?: number;
    }) =>
      request<ExecutionTargetListResponse>(`/web/execution-targets${qs(params ?? {})}`),

    pingExecutionTarget: (id: string) =>
      request<undefined>(`/web/execution-targets/${encodeURIComponent(id)}/ping`, { method: 'POST' }),

    // ── Hub workspace projects ─────────────────

    listWorkspaceProjects: (params?: {
      q?: string;
      pageCursor?: string;
      pageSize?: number;
    }) =>
      request<WorkspaceProjectListResponse>(`/web/projects${qs(params ?? {})}`),

    getWorkspaceProject: (id: string) =>
      request<WorkspaceProject>(`/web/projects/${encodeURIComponent(id)}`),

    createWorkspaceProject: (data: CreateWorkspaceProjectRequest) =>
      request<WorkspaceProject>('/web/projects', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    updateWorkspaceProject: (id: string, data: UpdateWorkspaceProjectRequest) =>
      request<WorkspaceProject>(`/web/projects/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    listWorkspaceProjectThreads: (projectId: string) =>
      request<WorkspaceProjectThread[]>(`/web/projects/${encodeURIComponent(projectId)}/threads`),

    createWorkspaceProjectThread: (projectId: string, data: CreateWorkspaceProjectThreadRequest) =>
      request<WorkspaceProjectThread>(`/web/projects/${encodeURIComponent(projectId)}/threads`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    listWorkspaceProjectThreadMessages: (projectId: string, threadId: string, params?: { limit?: number }) =>
      request<WorkspaceProjectThreadMessage[]>(
        `/web/projects/${encodeURIComponent(projectId)}/threads/${encodeURIComponent(threadId)}/messages${qs(params ?? {})}`,
      ),

    sendWorkspaceProjectThreadMessage: (
      projectId: string,
      threadId: string,
      data: SendWorkspaceProjectThreadMessageRequest,
    ) =>
      request<WorkspaceProjectThreadMessage>(
        `/web/projects/${encodeURIComponent(projectId)}/threads/${encodeURIComponent(threadId)}/messages`,
        { method: 'POST', body: JSON.stringify(data) },
      ),

    // ── Agent teams / TeamRun console ────────────────

    /** List all agent teams for the current user. */
    listAgentTeams: () =>
      request<AgentTeam[]>('/web/agent-teams'),

    /** Get a single agent team (with members). */
    getAgentTeam: (teamId: string) =>
      request<AgentTeamDetail>(`/web/agent-teams/${encodeURIComponent(teamId)}`),

    /** Create an agent team. */
    createAgentTeam: (data: CreateAgentTeamRequest) =>
      request<AgentTeam>('/web/agent-teams', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    /** Update an agent team. */
    updateAgentTeam: (teamId: string, data: UpdateAgentTeamRequest) =>
      request<AgentTeam>(`/web/agent-teams/${encodeURIComponent(teamId)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    /** Delete an agent team. */
    deleteAgentTeam: (teamId: string) =>
      request<undefined>(`/web/agent-teams/${encodeURIComponent(teamId)}`, { method: 'DELETE' }),

    /** Add a member (agent profile) to a team. */
    addAgentTeamMember: (teamId: string, data: AddAgentTeamMemberRequest) =>
      request<undefined>(`/web/agent-teams/${encodeURIComponent(teamId)}/members`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    /** List all runs for a team. */
    listTeamRuns: (teamId: string) =>
      request<AgentTeamRun[]>(`/web/agent-teams/${encodeURIComponent(teamId)}/runs`),

    /** Start a new team run. */
    startTeamRun: (teamId: string, data: StartAgentTeamRunRequest) =>
      request<AgentTeamRun>(`/web/agent-teams/${encodeURIComponent(teamId)}/runs`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    /** Get a single team run. */
    getTeamRun: (teamId: string, runId: string) =>
      request<AgentTeamRun>(`/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}`),

    /** Get comprehensive run state (members, tasks, approvals, conflicts, etc.). */
    getTeamRunState: (teamId: string, runId: string) =>
      request<TeamRunState>(`/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/state`),

    /** List tasks for a team run. */
    listTeamTasks: (teamId: string, runId: string) =>
      request<AgentTeamTask[]>(`/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/tasks`),

    /** List events for a team run. */
    listTeamEvents: (teamId: string, runId: string) =>
      request<AgentTeamEvent[]>(`/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/events`),

    /** Decide on a pending approval. */
    decideTeamApproval: (teamId: string, runId: string, approvalId: string, decision: TeamApprovalDecisionRequest) =>
      request<undefined>(`/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}/decide`, {
        method: 'POST',
        body: JSON.stringify(decision),
      }),

    /** Resolve a file conflict. */
    resolveTeamConflict: (teamId: string, runId: string, conflictId: string, resolution: TeamConflictResolutionRequest) =>
      request<undefined>(`/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/conflicts/${encodeURIComponent(conflictId)}/resolve`, {
        method: 'POST',
        body: JSON.stringify(resolution),
      }),

    // ── Attachments ──────────────────────────────

    /** Check if an attachment with the given SHA-256 hash already exists. */
    probeAttachment: (hash: string) =>
      request<ProbeAttachmentResponse>('/client/attachments/probe', {
        method: 'POST',
        body: JSON.stringify({ hash }),
      }),

    /** Upload a file as multipart/form-data. The client must compute the SHA-256 hash. */
    uploadAttachment: (file: File, hash: string) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('hash', hash);
      formData.append('original_name', file.name);
      return uploadMultipart<AttachmentRef>('/client/attachments', formData);
    },

    /** Get the download URL for an attachment (relative to Hub base). */
    downloadAttachmentUrl: (attachmentId: string) =>
      `${base}/client/attachments/${encodeURIComponent(attachmentId)}`,

    // ── Skills ─────────────────────────────────────

    listPublicSkills: (params?: {
      skill_type?: string;
      q?: string;
      is_public?: boolean;
      pageCursor?: string;
      pageSize?: number;
    }) =>
      request<{ items: Record<string, unknown>[]; page: { nextCursor?: string; hasMore: boolean } }>(
        `/web/skills${qs({ is_public: 'true', ...params ?? {} })}`,
      ),

    // ── MCP Servers ─────────────────────────────────

    listPublicMCPServers: (params?: {
      transport?: string;
      q?: string;
      is_public?: boolean;
      pageCursor?: string;
      pageSize?: number;
    }) =>
      request<{ items: Record<string, unknown>[]; page: { nextCursor?: string; hasMore: boolean } }>(
        `/web/mcp-servers${qs({ is_public: 'true', ...params ?? {} })}`,
      ),

    // ── Settings (user preferences) ────────────────────

    fetchSettings: () =>
      request<Record<string, string>>('/client/settings'),

    patchSettings: (values: Record<string, string>) =>
      request<Record<string, string>>('/client/settings', {
        method: 'PATCH',
        body: JSON.stringify({ values }),
      }),
  };
}

export type HubClient = ReturnType<typeof createHubClient>;
