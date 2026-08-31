/**
 * Hub client pure path / query builders.
 * Peel companion of hubClientPayloadUtils (#1094). Pure only; zero behavior change.
 */

import { qs } from './hubClientRequestUtils';
import { withPublicCatalogParams } from './hubClientPayloadBodies';

// ── Pure path / query builders (#822 residual) ──────────────────────────────

export function buildSearchUserPath(targetUserId: string): string {
  return `/client/contacts/search?id=${encodeURIComponent(targetUserId)}`;
}

export function buildSearchSessionsPath(
  q: string,
  params?: { pageCursor?: string; pageSize?: number },
): string {
  // q is the only pre-existing param and keeps its historical %XX encoding
  // (encodeURIComponent); pagination params append via the shared qs helper.
  const extra = qs(params ?? {});
  return `/client/sessions/search?q=${encodeURIComponent(q)}${extra ? `&${extra.slice(1)}` : ''}`;
}

export function buildListMessageReactionsPath(messageId: string, sessionId: string): string {
  return `/client/messages/${encodeURIComponent(messageId)}/reactions?session_id=${encodeURIComponent(sessionId)}`;
}

export function buildListTaskRunEventsAfterPath(taskId: string, afterSeq: number): string {
  return `/web/agent-tasks/${encodeURIComponent(taskId)}/events${qs({ after_seq: afterSeq, limit: 500 })}`;
}

export function buildCancelAgentTaskPaths(taskId: string): [string, string] {
  const encoded = encodeURIComponent(taskId);
  return [`/web/agent-tasks/${encoded}:cancel`, `/web/agent-tasks/${encoded}/cancel`];
}

export function buildMarkNotificationReadPaths(id: string): [string, string] {
  const encoded = encodeURIComponent(id);
  return [`/client/notifications/${encoded}:read`, `/client/notifications/${encoded}/read`];
}

export function buildReadAllNotificationsPaths(): [string, string] {
  return ['/client/notifications:read-all', '/client/notifications/read-all'];
}

export function buildDecideTeamApprovalPath(
  teamId: string,
  runId: string,
  approvalId: string,
): string {
  return `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}/decide`;
}

export function buildResolveTeamConflictPath(
  teamId: string,
  runId: string,
  conflictId: string,
): string {
  return `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/conflicts/${encodeURIComponent(conflictId)}/resolve`;
}

export function buildPostTeamRouteDecisionPath(teamId: string, runId: string): string {
  return `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/route-decisions`;
}

// ── Pure path residual (#833) ────────────────────────────────────────────────

/** Colon-route first, slash fallback for requestWithFallback. */
export function buildRegisterDevicePaths(): [string, string] {
  return ['/edge/devices:register', '/edge/devices/register'];
}

export function buildAcceptFriendRequestPath(requestId: string): string {
  return `/client/contacts/friend-requests/${encodeURIComponent(requestId)}/accept`;
}

export function buildRejectFriendRequestPath(requestId: string): string {
  return `/client/contacts/friend-requests/${encodeURIComponent(requestId)}/reject`;
}

export function buildBlockContactPath(targetUserId: string): string {
  return `/client/contacts/${encodeURIComponent(targetUserId)}/block`;
}

export function buildUnblockContactPath(targetUserId: string): string {
  return `/client/contacts/${encodeURIComponent(targetUserId)}/unblock`;
}

export function buildContactRemarkPath(friendUserId: string): string {
  return `/client/contacts/${encodeURIComponent(friendUserId)}/remark`;
}

export function buildRemoveSessionMemberPath(sessionId: string, userId: string): string {
  return `/client/sessions/${encodeURIComponent(sessionId)}/members/${encodeURIComponent(userId)}`;
}

export function buildGetMessagesPath(
  sessionId: string,
  params?: { before_seq?: number; limit?: number },
): string {
  return `/client/sessions/${encodeURIComponent(sessionId)}/messages${qs(params ?? {})}`;
}

export function buildSyncMessagesPath(
  sessionId: string,
  params?: { after_seq?: number; limit?: number },
): string {
  return `/client/sessions/${encodeURIComponent(sessionId)}/messages/sync${qs(params ?? {})}`;
}

export function buildSearchSessionMessagesPath(
  sessionId: string,
  params: { q: string; content_type?: string; from?: string; to?: string; pageCursor?: string; pageSize?: number },
): string {
  return `/client/sessions/${encodeURIComponent(sessionId)}/messages/search${qs(params)}`;
}

export function buildListWorkspaceProjectThreadMessagesPath(
  projectId: string,
  threadId: string,
  params?: { limit?: number },
): string {
  return `/web/projects/${encodeURIComponent(projectId)}/threads/${encodeURIComponent(threadId)}/messages${qs(params ?? {})}`;
}

export function buildSendWorkspaceProjectThreadMessagePath(
  projectId: string,
  threadId: string,
): string {
  return `/web/projects/${encodeURIComponent(projectId)}/threads/${encodeURIComponent(threadId)}/messages`;
}

export function buildGetTeamRunPath(teamId: string, runId: string): string {
  return `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}`;
}

export function buildGetTeamRunStatePath(teamId: string, runId: string): string {
  return `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/state`;
}

export function buildListTeamEventsPath(teamId: string, runId: string): string {
  return `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/events`;
}

export function buildListTeamTasksPath(teamId: string, runId: string): string {
  return `/web/agent-teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}/tasks`;
}

export function buildRemoveAgentTeamMemberPath(teamId: string, memberId: string): string {
  return `/web/agent-teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(memberId)}`;
}

export function buildDecideTaskApprovalPath(taskId: string, approvalId: string): string {
  return `/web/agent-tasks/${encodeURIComponent(taskId)}/approvals/${encodeURIComponent(approvalId)}/decide`;
}

// ── Pure path residual (#901) ────────────────────────────────────────────────

export function buildRemoveContactPath(friendUserId: string): string {
  return `/client/contacts/${encodeURIComponent(friendUserId)}`;
}

export function buildSessionMembersPath(sessionId: string): string {
  return `/client/sessions/${encodeURIComponent(sessionId)}/members`;
}

export function buildLeaveSessionPath(sessionId: string): string {
  return `/client/sessions/${encodeURIComponent(sessionId)}/leave`;
}

export function buildTransferSessionOwnerPath(sessionId: string): string {
  return `/client/sessions/${encodeURIComponent(sessionId)}/transfer-owner`;
}

export function buildDissolveSessionPath(sessionId: string): string {
  return `/client/sessions/${encodeURIComponent(sessionId)}/dissolve`;
}

export function buildSessionInfoPath(sessionId: string): string {
  return `/client/sessions/${encodeURIComponent(sessionId)}/info`;
}

export function buildSessionSettingsPath(sessionId: string): string {
  return `/client/sessions/${encodeURIComponent(sessionId)}/settings`;
}

export function buildSessionPath(sessionId: string): string {
  return `/client/sessions/${encodeURIComponent(sessionId)}`;
}

export function buildMarkReadPath(sessionId: string): string {
  return `/client/sessions/${encodeURIComponent(sessionId)}/read`;
}

export function buildSessionPinsPath(sessionId: string): string {
  return `/client/sessions/${encodeURIComponent(sessionId)}/pins`;
}

export function buildSessionAgentsPath(sessionId: string): string {
  return `/client/sessions/${encodeURIComponent(sessionId)}/agents`;
}

export function buildRecallMessagePath(messageId: string): string {
  return `/client/messages/${encodeURIComponent(messageId)}/recall`;
}

export function buildPinMessagePath(messageId: string): string {
  return `/client/messages/${encodeURIComponent(messageId)}/pin`;
}

export function buildForwardMessagePath(messageId: string): string {
  return `/client/messages/${encodeURIComponent(messageId)}/forward`;
}

export function buildEditMessagePath(messageId: string): string {
  return `/client/messages/${encodeURIComponent(messageId)}`;
}

export function buildMessageReactionsPath(messageId: string): string {
  return `/client/messages/${encodeURIComponent(messageId)}/reactions`;
}

export function buildSearchMessagesPath(params: {
  q: string;
  session_id?: string;
  content_type?: string;
  from?: string;
  to?: string;
  pageCursor?: string;
  pageSize?: number;
}): string {
  return `/client/messages/search${qs(params)}`;
}

export function buildListNotificationsPath(params?: {
  unread_only?: boolean;
  limit?: number;
  offset?: number;
}): string {
  return `/client/notifications${qs(params ?? {})}`;
}

export function buildAckTaskPath(taskId: string): string {
  return `/edge/agent-tasks/${encodeURIComponent(taskId)}/ack`;
}

export function buildStreamTaskPath(taskId: string): string {
  return `/edge/agent-tasks/${encodeURIComponent(taskId)}/stream`;
}

export function buildDoneTaskPath(taskId: string): string {
  return `/edge/agent-tasks/${encodeURIComponent(taskId)}/done`;
}

export function buildFailTaskPath(taskId: string): string {
  return `/edge/agent-tasks/${encodeURIComponent(taskId)}/fail`;
}

export function buildRegenerateAgentTaskPath(taskId: string): string {
  return `/web/agent-tasks/${encodeURIComponent(taskId)}/regenerate`;
}

export function buildListExecutionTargetsPath(params?: {
  pageSize?: number;
  pageCursor?: string;
  target_type?: string;
}): string {
  return `/web/execution-targets${qs(params ?? {})}`;
}

export function buildExecutionTargetPath(id: string): string {
  return `/web/execution-targets/${encodeURIComponent(id)}`;
}

export function buildPingExecutionTargetPath(id: string): string {
  return `/web/execution-targets/${encodeURIComponent(id)}/ping`;
}

export function buildListAuditEventsPath(params?: {
  pageSize?: number;
  pageCursor?: string;
}): string {
  return `/web/audit-events${qs(params ?? {})}`;
}

export function buildRelayCommandPath(id: string): string {
  return `/web/relay/commands/${encodeURIComponent(id)}`;
}

export function buildAckRelayCommandPath(id: string): string {
  return `/web/relay/commands/${encodeURIComponent(id)}/device-ack`;
}

export function buildCustomAgentPath(id: string): string {
  return `/web/custom-agents/${encodeURIComponent(id)}`;
}

export function buildListPublicSkillsPath(params?: {
  skill_type?: string;
  q?: string;
  is_public?: string;
  pageCursor?: string;
  pageSize?: number;
}): string {
  return `/web/skills${qs(withPublicCatalogParams(params ?? {}))}`;
}

export function buildListPublicMCPServersPath(params?: {
  transport?: string;
  q?: string;
  is_public?: string;
  pageCursor?: string;
  pageSize?: number;
}): string {
  return `/web/mcp-servers${qs(withPublicCatalogParams(params ?? {}))}`;
}

export function buildListWorkspaceProjectsPath(params?: {
  pageSize?: number;
  pageCursor?: string;
  q?: string;
}): string {
  return `/web/projects${qs(params ?? {})}`;
}

export function buildWorkspaceProjectPath(id: string): string {
  return `/web/projects/${encodeURIComponent(id)}`;
}

export function buildWorkspaceProjectThreadsPath(projectId: string): string {
  return `/web/projects/${encodeURIComponent(projectId)}/threads`;
}

export function buildTaskRunEventSummaryPath(taskId: string): string {
  return `/web/agent-tasks/${encodeURIComponent(taskId)}/events/summary`;
}

export function buildListTaskRunEventsPath(taskId: string): string {
  return `/web/agent-tasks/${encodeURIComponent(taskId)}/events`;
}

export function buildAgentTeamPath(teamId: string): string {
  return `/web/agent-teams/${encodeURIComponent(teamId)}`;
}

export function buildAgentTeamMembersPath(teamId: string): string {
  return `/web/agent-teams/${encodeURIComponent(teamId)}/members`;
}

export function buildAgentTeamRunsPath(teamId: string): string {
  return `/web/agent-teams/${encodeURIComponent(teamId)}/runs`;
}

export function buildListAgentProfilesPath(params?: {
  runtime_id?: string;
  q?: string;
  pageCursor?: string;
  pageSize?: number;
}): string {
  return `/web/agent-profiles${qs(params ?? {})}`;
}

export function buildAgentProfilePath(id: string): string {
  return `/web/agent-profiles/${encodeURIComponent(id)}`;
}

export function buildListDocumentsPath(params?: {
  status?: string;
  source?: string;
  tag?: string;
  pageCursor?: string;
  pageSize?: number;
}): string {
  return `/web/documents${qs(params ?? {})}`;
}

export function buildDocumentPath(id: string): string {
  return `/web/documents/${encodeURIComponent(id)}`;
}

export function buildListTaskApprovalsPath(taskId: string): string {
  return `/web/agent-tasks/${encodeURIComponent(taskId)}/approvals`;
}

export function buildListTaskArtifactsPath(taskId: string): string {
  return `/web/agent-tasks/${encodeURIComponent(taskId)}/artifacts`;
}

// ── Static path residual (#913) ───────────────────────────────────────────────

export function buildRefreshPath(): string {
  return '/client/auth/refresh';
}

export function buildLogoutPath(): string {
  return '/client/auth/logout';
}

export function buildMePath(): string {
  return '/client/auth/me';
}

export function buildUpdateProfilePath(): string {
  return '/client/auth/profile';
}

export function buildOidcAuthorizePath(): string {
  return '/client/auth/oidc/authorize';
}

export function buildOidcCallbackPath(): string {
  return '/client/auth/oidc/callback';
}

export function buildListContactsPath(): string {
  return '/client/contacts';
}

export function buildFriendRequestsPath(): string {
  return '/client/contacts/friend-requests';
}

export function buildListSessionsPath(): string {
  return '/client/sessions';
}

export function buildCreatePrivateSessionPath(): string {
  return '/client/sessions/private';
}

export function buildCreateGroupSessionPath(): string {
  return '/client/sessions/group';
}

export function buildAgentTasksPath(): string {
  return '/web/agent-tasks';
}

export function buildExecutionTargetsPath(): string {
  return '/web/execution-targets';
}

export function buildRelayCommandsPath(): string {
  return '/web/relay/commands';
}

export function buildCustomAgentsPath(): string {
  return '/web/custom-agents';
}

export function buildAgentTeamsPath(): string {
  return '/web/agent-teams';
}

export function buildAgentProfilesPath(): string {
  return '/web/agent-profiles';
}

export function buildDocumentsPath(): string {
  return '/web/documents';
}

export function buildWorkspaceProjectsPath(): string {
  return '/web/projects';
}

export function buildSettingsPath(): string {
  return '/client/settings';
}

export function buildProbeAttachmentPath(): string {
  return '/client/attachments/probe';
}

export function buildAttachmentsPath(): string {
  return '/client/attachments';
}

