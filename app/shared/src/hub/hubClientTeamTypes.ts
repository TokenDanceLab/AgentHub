/**
 * Hub client team / profile / document / task-approval DTO surface.
 * Extracted from hubClient.ts (#767) — pure types only; re-exported by hubClient.
 * Keep public names stable for web/desktop imports via @shared/hub/hubClient.
 */

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
  // Hub-side backfill audit fields (Go model.CoordinatorRouteDecision,
  // internal/model/agent_team_tasks.go:146-152; all omitempty).
  accepted?: boolean;
  subtask_id?: string;
  parent_task_id?: string;
  agent_id?: string;
  reason?: string;
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
  // Go json:"mode" is not omitempty (always serialized; default "supervisor").
  mode: 'supervisor' | 'compete' | string;
  status: 'queued' | 'running' | 'pending_review' | 'completed' | 'failed' | 'cancelled' | string;
  // Migration 0066 counter; omitempty — absent for runs recorded before the
  // column existed (no backfill yet). Consumers must treat undefined as
  // "not recorded", never as 0 (#1819).
  token_usage_total?: number;
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
  // Go AgentTeamTask.InputRefs is a string column (jsonb serialized as a JSON
  // string literal, e.g. "{}"); it is NOT an object on the wire.
  input_refs?: string;
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

export interface HubTeamEventsPage {
  items: HubAgentTeamEvent[];
  page: {
    nextCursor: string;
    hasMore: boolean;
  };
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

// Mirrors Go model.TeamTaskDependencyState (internal/model/agent_team_state.go:69-73).
export interface HubTeamTaskDependencyState {
  task_id: string;
  depends_on_task_id: string;
  kind: string;
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

// Mirrors Go model.TeamRouteAuditState (internal/model/agent_team_state.go:33-42).
export interface HubTeamRouteAuditState {
  status: 'accepted' | 'rejected' | string;
  action?: string;
  subtask_id?: string;
  parent_task_id?: string;
  agent_id?: string;
  reason?: string;
  correlation_id?: string;
  created_at?: string;
}

// Mirrors Go model.HumanReviewChange (internal/model/agent_team_state.go:261-264).
export interface HubHumanReviewChange {
  field: string;
  value: string;
}

// Mirrors Go model.HumanReviewState (internal/model/agent_team_state.go:267-276).
export interface HubHumanReviewState {
  review_id: string;
  run_id: string;
  action: 'approve' | 'discuss' | 'modify' | string;
  comment?: string;
  changes?: HubHumanReviewChange[];
  decided_by?: string;
  created_at: string;
  decided_at?: string;
}

export interface HubTeamRunState {
  run_id: string;
  team_id: string;
  status: string;
  members?: HubTeamMemberState[];
  tasks?: HubTeamTaskState[];
  dependencies?: HubTeamTaskDependencyState[];
  assignments?: HubTeamAssignmentState[];
  approvals?: HubTeamApprovalState[];
  artifacts?: HubTeamArtifactState[];
  conflicts?: HubTeamConflictState[];
  run_events?: HubTeamRunEventState[];
  route_log?: HubCoordinatorRouteDecision[];
  route_audit_log?: HubTeamRouteAuditState[];
  reviews?: HubHumanReviewState[];
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
