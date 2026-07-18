/**
 * Hub client pure path/body/response builders used by multi-line createHubClient methods.
 * Extracted from hubClient.ts (#810, #822) — pure only; methods stay thin request(...) wrappers.
 */

import type {
  HubExecutionTarget,
  HubExecutionTargetListResponse,
  HubOidcAuthorizeRequest,
  HubTriggerAgentTaskOptions,
} from './hubClientDomainTypes';
import type { HubAgentTaskStreamEventOptions } from './hubClientTeamTypes';
import { qs } from './hubClientRequestUtils';

export function normalizeExecutionTargetsResponse(
  data: HubExecutionTarget[] | HubExecutionTargetListResponse,
): HubExecutionTargetListResponse {
  if (Array.isArray(data)) {
    return { items: data, page: { hasMore: false } };
  }
  return {
    items: Array.isArray(data.items) ? data.items : [],
    page: data.page ?? { hasMore: false },
  };
}

export function buildOidcAuthorizeBody(
  body: HubOidcAuthorizeRequest,
): HubOidcAuthorizeRequest & { code_challenge_method: string } {
  return {
    code_challenge_method: 'S256',
    ...body,
  };
}

export function buildRefreshBody(refreshToken: string): { refresh_token: string } {
  return { refresh_token: refreshToken };
}

export function buildFriendRequestBody(
  friendId: string,
  message?: string,
): { friend_id: string; message?: string } {
  return message === undefined
    ? { friend_id: friendId }
    : { friend_id: friendId, message };
}

export function buildRemarkBody(remark: string): { remark: string } {
  return { remark };
}

export function buildMemberIdsBody(memberIds: string[]): { member_ids: string[] } {
  return { member_ids: memberIds };
}

export function buildTransferOwnerBody(newOwnerId: string): { new_owner_id: string } {
  return { new_owner_id: newOwnerId };
}

export function buildMarkReadBody(lastReadSeq: number): { last_read_seq: number } {
  return { last_read_seq: lastReadSeq };
}

export function buildSessionIdBody(sessionId: string): { session_id: string } {
  return { session_id: sessionId };
}

export function buildForwardMessageBody(
  targetSessionIds: string[],
): { target_session_ids: string[] } {
  return { target_session_ids: targetSessionIds };
}

export function buildTaskAckBody(runId?: string): { run_id: string } | undefined {
  return runId ? { run_id: runId } : undefined;
}

export function buildTaskStreamBody(
  content: string,
  runId?: string,
): { content: string; run_id?: string } {
  return {
    content,
    ...(runId ? { run_id: runId } : {}),
  };
}

export function buildTaskDoneBody(
  finalContent?: string,
  runId?: string,
): { final_content: string; run_id?: string } {
  return {
    final_content: finalContent ?? '',
    ...(runId ? { run_id: runId } : {}),
  };
}

export function buildTaskFailBody(
  error: string,
  runId?: string,
): { error: string; run_id?: string } {
  return {
    error,
    ...(runId ? { run_id: runId } : {}),
  };
}

export function buildStreamTaskEventBody(
  eventType: string,
  payload: unknown,
  options: HubAgentTaskStreamEventOptions = {},
): {
  event_type: string;
  payload: unknown;
  run_id?: string;
  client_msg_id?: string;
} {
  return {
    event_type: eventType,
    payload,
    ...(options.runId ? { run_id: options.runId } : {}),
    ...(options.clientMsgId ? { client_msg_id: options.clientMsgId } : {}),
  };
}

export function buildTriggerAgentTaskBody(
  triggerMessageId: string,
  options: HubTriggerAgentTaskOptions = {},
): { trigger_message_id: string } & HubTriggerAgentTaskOptions {
  return { trigger_message_id: triggerMessageId, ...options };
}

export function buildAttachmentFormData(file: File, hash: string): FormData {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('hash', hash);
  formData.append('original_name', file.name);
  return formData;
}

export function buildAttachmentDownloadUrl(baseUrl: string, attachmentId: string): string {
  return `${baseUrl}/client/attachments/${encodeURIComponent(attachmentId)}`;
}

export function withPublicCatalogParams<T extends Record<string, unknown>>(
  params?: T,
): { is_public: 'true' } & T {
  return { is_public: 'true', ...(params ?? ({} as T)) };
}

export function buildReactionBody(
  sessionId: string,
  reaction: { emoji: string },
): { session_id: string; emoji: string } {
  return { session_id: sessionId, ...reaction };
}

export function buildPatchSettingsBody(
  values: Record<string, string>,
): { values: Record<string, string> } {
  return { values };
}

export function buildProbeAttachmentBody(hash: string): { hash: string } {
  return { hash };
}

// ── Pure path / query builders (#822 residual) ──────────────────────────────

export function buildSearchUserPath(targetUserId: string): string {
  return `/client/contacts/search?id=${encodeURIComponent(targetUserId)}`;
}

export function buildSearchSessionsPath(q: string): string {
  return `/client/sessions/search?q=${encodeURIComponent(q)}`;
}

export function buildListMessageReactionsPath(messageId: string, sessionId: string): string {
  return `/client/messages/${encodeURIComponent(messageId)}/reactions?session_id=${encodeURIComponent(sessionId)}`;
}

/** Replay gap-fill query: event_seq strictly after `afterSeq`, fixed server page size. */
export function buildListTaskRunEventsAfterPath(taskId: string, afterSeq: number): string {
  return `/web/agent-tasks/${encodeURIComponent(taskId)}/events${qs({ after_seq: afterSeq, limit: 500 })}`;
}

/** Colon-route first, slash fallback for requestWithFallback. */
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

/** RequestInit fragment: include JSON body only when payload is defined (exactOptional-safe). */
export function buildOptionalJsonBody(
  payload: unknown | undefined,
): { body: string } | Record<string, never> {
  return payload === undefined ? {} : { body: JSON.stringify(payload) };
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
  params: { q: string; content_type?: string; from?: string; to?: string },
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
  return `/web/execution-targets/${encodeURIComponent(id)}:ping`;
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
  return `/web/relay/commands/${encodeURIComponent(id)}:ack`;
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

// ── Pure JSON RequestInit builders (#901) ────────────────────────────────────

export function buildJsonPostInit(body: unknown): { method: 'POST'; body: string } {
  return { method: 'POST', body: JSON.stringify(body) };
}

export function buildJsonPutInit(body: unknown): { method: 'PUT'; body: string } {
  return { method: 'PUT', body: JSON.stringify(body) };
}

export function buildJsonPatchInit(body: unknown): { method: 'PATCH'; body: string } {
  return { method: 'PATCH', body: JSON.stringify(body) };
}

export function buildJsonDeleteInit(body: unknown): { method: 'DELETE'; body: string } {
  return { method: 'DELETE', body: JSON.stringify(body) };
}

export function buildPostInit(): { method: 'POST' } {
  return { method: 'POST' };
}

export function buildDeleteInit(): { method: 'DELETE' } {
  return { method: 'DELETE' };
}

export function buildPutInit(): { method: 'PUT' } {
  return { method: 'PUT' };
}

/**
 * POST RequestInit with optional JSON body key (exactOptional-safe).
 * Omits `body` entirely when payload is undefined.
 */
export function buildPostWithOptionalJsonBody(
  payload: unknown | undefined,
): { method: 'POST' } | { method: 'POST'; body: string } {
  return {
    ...buildPostInit(),
    ...buildOptionalJsonBody(payload),
  };
}

// ── Static path residual (#913) ───────────────────────────────────────────────

export function buildRegisterPath(): string {
  return '/client/auth/register';
}

export function buildLoginPath(): string {
  return '/client/auth/login';
}

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

export function buildChangePasswordPath(): string {
  return '/client/auth/change-password';
}

export function buildChangePasswordFallbackPath(): string {
  return '/client/auth/password';
}

/** Primary change-password attempt (POST /change-password). */
export function buildChangePasswordPrimary(
  body: unknown,
): { path: string; init: { method: 'POST'; body: string } } {
  return {
    path: buildChangePasswordPath(),
    init: buildJsonPostInit(body),
  };
}

/** Fallback change-password attempt (PUT /password) for older hubs. */
export function buildChangePasswordFallback(
  body: unknown,
): { path: string; init: { method: 'PUT'; body: string } } {
  return {
    path: buildChangePasswordFallbackPath(),
    init: buildJsonPutInit(body),
  };
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

// ── Composite path+init residual (#978) ───────────────────────────────────────

export type HubJsonPathInit = {
  path: string;
  init: { method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body: string };
};

export type HubMethodPathInit = {
  path: string;
  init: { method: 'POST' } | { method: 'POST'; body: string } | { method: 'DELETE' };
};

export function buildRefreshRequest(refreshToken: string): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildRefreshPath(),
    init: buildJsonPostInit(buildRefreshBody(refreshToken)),
  };
}

export function buildOidcAuthorizeRequest(body: HubOidcAuthorizeRequest): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildOidcAuthorizePath(),
    init: buildJsonPostInit(buildOidcAuthorizeBody(body)),
  };
}

export function buildSendFriendRequest(friendId: string, message?: string): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildFriendRequestsPath(),
    init: buildJsonPostInit(buildFriendRequestBody(friendId, message)),
  };
}

export function buildUpdateContactRemarkRequest(
  friendUserId: string,
  remark: string,
): {
  path: string;
  init: { method: 'PUT'; body: string };
} {
  return {
    path: buildContactRemarkPath(friendUserId),
    init: buildJsonPutInit(buildRemarkBody(remark)),
  };
}

export function buildAddSessionMembersRequest(
  sessionId: string,
  memberIds: string[],
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildSessionMembersPath(sessionId),
    init: buildJsonPostInit(buildMemberIdsBody(memberIds)),
  };
}

export function buildTransferSessionOwnershipRequest(
  sessionId: string,
  newOwnerId: string,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildTransferSessionOwnerPath(sessionId),
    init: buildJsonPostInit(buildTransferOwnerBody(newOwnerId)),
  };
}

export function buildMarkReadRequest(
  sessionId: string,
  lastReadSeq: number,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildMarkReadPath(sessionId),
    init: buildJsonPostInit(buildMarkReadBody(lastReadSeq)),
  };
}

export function buildPinMessageRequest(
  messageId: string,
  sessionId: string,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildPinMessagePath(messageId),
    init: buildJsonPostInit(buildSessionIdBody(sessionId)),
  };
}

export function buildUnpinMessageRequest(
  messageId: string,
  sessionId: string,
): {
  path: string;
  init: { method: 'DELETE'; body: string };
} {
  return {
    path: buildPinMessagePath(messageId),
    init: buildJsonDeleteInit(buildSessionIdBody(sessionId)),
  };
}

export function buildForwardMessageRequest(
  messageId: string,
  targetSessionIds: string[],
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildForwardMessagePath(messageId),
    init: buildJsonPostInit(buildForwardMessageBody(targetSessionIds)),
  };
}

export function buildAckTaskRequest(
  taskId: string,
  runId?: string,
): {
  path: string;
  init: { method: 'POST' } | { method: 'POST'; body: string };
} {
  return {
    path: buildAckTaskPath(taskId),
    init: buildPostWithOptionalJsonBody(buildTaskAckBody(runId)),
  };
}

export function buildStreamTaskRequest(
  taskId: string,
  content: string,
  runId?: string,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildStreamTaskPath(taskId),
    init: buildJsonPostInit(buildTaskStreamBody(content, runId)),
  };
}

export function buildDoneTaskRequest(
  taskId: string,
  finalContent?: string,
  runId?: string,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildDoneTaskPath(taskId),
    init: buildJsonPostInit(buildTaskDoneBody(finalContent, runId)),
  };
}

export function buildFailTaskRequest(
  taskId: string,
  error: string,
  runId?: string,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildFailTaskPath(taskId),
    init: buildJsonPostInit(buildTaskFailBody(error, runId)),
  };
}

export function buildTriggerAgentTaskRequest(
  triggerMessageId: string,
  options: HubTriggerAgentTaskOptions = {},
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildAgentTasksPath(),
    init: buildJsonPostInit(buildTriggerAgentTaskBody(triggerMessageId, options)),
  };
}

export function buildAddMessageReactionRequest(
  messageId: string,
  sessionId: string,
  reaction: { emoji: string },
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildMessageReactionsPath(messageId),
    init: buildJsonPostInit(buildReactionBody(sessionId, reaction)),
  };
}

export function buildRemoveMessageReactionRequest(
  messageId: string,
  sessionId: string,
  reaction: { emoji: string },
): {
  path: string;
  init: { method: 'DELETE'; body: string };
} {
  return {
    path: buildMessageReactionsPath(messageId),
    init: buildJsonDeleteInit(buildReactionBody(sessionId, reaction)),
  };
}

export function buildPatchSettingsRequest(values: Record<string, string>): {
  path: string;
  init: { method: 'PATCH'; body: string };
} {
  return {
    path: buildSettingsPath(),
    init: buildJsonPatchInit(buildPatchSettingsBody(values)),
  };
}

export function buildProbeAttachmentRequest(hash: string): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildProbeAttachmentPath(),
    init: buildJsonPostInit(buildProbeAttachmentBody(hash)),
  };
}

export function buildStreamTaskEventRequest(
  taskId: string,
  eventType: string,
  payload: unknown,
  options: HubAgentTaskStreamEventOptions = {},
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildStreamTaskPath(taskId),
    init: buildJsonPostInit(buildStreamTaskEventBody(eventType, payload, options)),
  };
}

export function buildUploadAttachmentRequest(
  file: File,
  hash: string,
): {
  path: string;
  formData: FormData;
} {
  return {
    path: buildAttachmentsPath(),
    formData: buildAttachmentFormData(file, hash),
  };
}

// ── Composite path+init residual (#1055) ──────────────────────────────────────

export function buildRegisterRequest(body: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildRegisterPath(),
    init: buildJsonPostInit(body),
  };
}

export function buildLoginRequest(body: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildLoginPath(),
    init: buildJsonPostInit(body),
  };
}

export function buildUpdateProfileRequest(body: unknown): {
  path: string;
  init: { method: 'PUT'; body: string };
} {
  return {
    path: buildUpdateProfilePath(),
    init: buildJsonPutInit(body),
  };
}

export function buildOidcCallbackPathInit(body: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildOidcCallbackPath(),
    init: buildJsonPostInit(body),
  };
}

export function buildAcceptFriendRequest(requestId: string): {
  path: string;
  init: { method: 'POST' };
} {
  return {
    path: buildAcceptFriendRequestPath(requestId),
    init: buildPostInit(),
  };
}

export function buildRejectFriendRequest(requestId: string): {
  path: string;
  init: { method: 'POST' };
} {
  return {
    path: buildRejectFriendRequestPath(requestId),
    init: buildPostInit(),
  };
}

export function buildRemoveContactRequest(friendUserId: string): {
  path: string;
  init: { method: 'DELETE' };
} {
  return {
    path: buildRemoveContactPath(friendUserId),
    init: buildDeleteInit(),
  };
}

export function buildCreatePrivateSessionRequest(body: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildCreatePrivateSessionPath(),
    init: buildJsonPostInit(body),
  };
}

export function buildCreateGroupSessionRequest(body: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildCreateGroupSessionPath(),
    init: buildJsonPostInit(body),
  };
}

export function buildRemoveSessionMemberRequest(
  sessionId: string,
  userId: string,
): {
  path: string;
  init: { method: 'DELETE' };
} {
  return {
    path: buildRemoveSessionMemberPath(sessionId, userId),
    init: buildDeleteInit(),
  };
}

export function buildUpdateSessionInfoRequest(
  sessionId: string,
  body: unknown,
): {
  path: string;
  init: { method: 'PUT'; body: string };
} {
  return {
    path: buildSessionInfoPath(sessionId),
    init: buildJsonPutInit(body),
  };
}

export function buildUpdateSessionSettingsRequest(
  sessionId: string,
  body: unknown,
): {
  path: string;
  init: { method: 'PUT'; body: string };
} {
  return {
    path: buildSessionSettingsPath(sessionId),
    init: buildJsonPutInit(body),
  };
}

export function buildSendMessageRequest(
  sessionId: string,
  body: unknown,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildGetMessagesPath(sessionId),
    init: buildJsonPostInit(body),
  };
}

export function buildAddAgentToSessionRequest(
  sessionId: string,
  body: unknown,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildSessionAgentsPath(sessionId),
    init: buildJsonPostInit(body),
  };
}

export function buildRegenerateAgentTaskRequest(taskId: string): {
  path: string;
  init: { method: 'POST' };
} {
  return {
    path: buildRegenerateAgentTaskPath(taskId),
    init: buildPostInit(),
  };
}

export function buildCreateExecutionTargetRequest(body: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildExecutionTargetsPath(),
    init: buildJsonPostInit(body),
  };
}

export function buildUpdateExecutionTargetRequest(
  id: string,
  body: unknown,
): {
  path: string;
  init: { method: 'PATCH'; body: string };
} {
  return {
    path: buildExecutionTargetPath(id),
    init: buildJsonPatchInit(body),
  };
}

export function buildPingExecutionTargetRequest(id: string): {
  path: string;
  init: { method: 'POST' };
} {
  return {
    path: buildPingExecutionTargetPath(id),
    init: buildPostInit(),
  };
}

export function buildCreateRelayCommandRequest(body: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildRelayCommandsPath(),
    init: buildJsonPostInit(body),
  };
}

export function buildCreateCustomAgentRequest(body: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildCustomAgentsPath(),
    init: buildJsonPostInit(body),
  };
}

export function buildUpdateCustomAgentRequest(
  id: string,
  body: unknown,
): {
  path: string;
  init: { method: 'PUT'; body: string };
} {
  return {
    path: buildCustomAgentPath(id),
    init: buildJsonPutInit(body),
  };
}

export function buildCreateWorkspaceProjectRequest(data: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildWorkspaceProjectsPath(),
    init: buildJsonPostInit(data),
  };
}

export function buildUpdateWorkspaceProjectRequest(
  id: string,
  data: unknown,
): {
  path: string;
  init: { method: 'PATCH'; body: string };
} {
  return {
    path: buildWorkspaceProjectPath(id),
    init: buildJsonPatchInit(data),
  };
}

export function buildCreateWorkspaceProjectThreadRequest(
  projectId: string,
  data: unknown,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildWorkspaceProjectThreadsPath(projectId),
    init: buildJsonPostInit(data),
  };
}

export function buildSendWorkspaceProjectThreadMessageRequest(
  projectId: string,
  threadId: string,
  data: unknown,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildSendWorkspaceProjectThreadMessagePath(projectId, threadId),
    init: buildJsonPostInit(data),
  };
}

export function buildEditMessageRequest(
  messageId: string,
  body: unknown,
): {
  path: string;
  init: { method: 'PUT'; body: string };
} {
  return {
    path: buildEditMessagePath(messageId),
    init: buildJsonPutInit(body),
  };
}

export function buildCreateAgentTeamRequest(data: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildAgentTeamsPath(),
    init: buildJsonPostInit(data),
  };
}

export function buildUpdateAgentTeamRequest(
  teamId: string,
  data: unknown,
): {
  path: string;
  init: { method: 'PUT'; body: string };
} {
  return {
    path: buildAgentTeamPath(teamId),
    init: buildJsonPutInit(data),
  };
}

export function buildAddAgentTeamMemberRequest(
  teamId: string,
  data: unknown,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildAgentTeamMembersPath(teamId),
    init: buildJsonPostInit(data),
  };
}

export function buildStartTeamRunRequest(
  teamId: string,
  data: unknown,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildAgentTeamRunsPath(teamId),
    init: buildJsonPostInit(data),
  };
}

export function buildDecideTeamApprovalRequest(
  teamId: string,
  runId: string,
  approvalId: string,
  decision: unknown,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildDecideTeamApprovalPath(teamId, runId, approvalId),
    init: buildJsonPostInit(decision),
  };
}

export function buildResolveTeamConflictRequest(
  teamId: string,
  runId: string,
  conflictId: string,
  resolution: unknown,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildResolveTeamConflictPath(teamId, runId, conflictId),
    init: buildJsonPostInit(resolution),
  };
}

export function buildCreateAgentProfileRequest(data: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildAgentProfilesPath(),
    init: buildJsonPostInit(data),
  };
}

export function buildUpdateAgentProfileRequest(
  id: string,
  data: unknown,
): {
  path: string;
  init: { method: 'PATCH'; body: string };
} {
  return {
    path: buildAgentProfilePath(id),
    init: buildJsonPatchInit(data),
  };
}

export function buildCreateDocumentRequest(data: unknown): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildDocumentsPath(),
    init: buildJsonPostInit(data),
  };
}

export function buildUpdateDocumentRequest(
  id: string,
  data: unknown,
): {
  path: string;
  init: { method: 'PATCH'; body: string };
} {
  return {
    path: buildDocumentPath(id),
    init: buildJsonPatchInit(data),
  };
}

export function buildRemoveAgentTeamMemberRequest(
  teamId: string,
  memberId: string,
): {
  path: string;
  init: { method: 'DELETE' };
} {
  return {
    path: buildRemoveAgentTeamMemberPath(teamId, memberId),
    init: buildDeleteInit(),
  };
}

export function buildPostTeamRouteDecisionRequest(
  teamId: string,
  runId: string,
  decision: unknown,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildPostTeamRouteDecisionPath(teamId, runId),
    init: buildJsonPostInit(decision),
  };
}

export function buildDecideTaskApprovalRequest(
  taskId: string,
  approvalId: string,
  decision: unknown,
): {
  path: string;
  init: { method: 'POST'; body: string };
} {
  return {
    path: buildDecideTaskApprovalPath(taskId, approvalId),
    init: buildJsonPostInit(decision),
  };
}

export function buildLogoutRequest(): {
  path: string;
  init: { method: 'POST' };
} {
  return {
    path: buildLogoutPath(),
    init: buildPostInit(),
  };
}

export function buildBlockContactRequest(targetUserId: string): {
  path: string;
  init: { method: 'POST' };
} {
  return {
    path: buildBlockContactPath(targetUserId),
    init: buildPostInit(),
  };
}

export function buildUnblockContactRequest(targetUserId: string): {
  path: string;
  init: { method: 'POST' };
} {
  return {
    path: buildUnblockContactPath(targetUserId),
    init: buildPostInit(),
  };
}

export function buildLeaveSessionRequest(sessionId: string): {
  path: string;
  init: { method: 'POST' };
} {
  return {
    path: buildLeaveSessionPath(sessionId),
    init: buildPostInit(),
  };
}

export function buildDissolveSessionRequest(sessionId: string): {
  path: string;
  init: { method: 'POST' };
} {
  return {
    path: buildDissolveSessionPath(sessionId),
    init: buildPostInit(),
  };
}

export function buildDeleteSessionRequest(sessionId: string): {
  path: string;
  init: { method: 'DELETE' };
} {
  return {
    path: buildSessionPath(sessionId),
    init: buildDeleteInit(),
  };
}

export function buildRecallMessageRequest(messageId: string): {
  path: string;
  init: { method: 'POST' };
} {
  return {
    path: buildRecallMessagePath(messageId),
    init: buildPostInit(),
  };
}

export function buildDeleteExecutionTargetRequest(id: string): {
  path: string;
  init: { method: 'DELETE' };
} {
  return {
    path: buildExecutionTargetPath(id),
    init: buildDeleteInit(),
  };
}

export function buildAckRelayCommandRequest(id: string): {
  path: string;
  init: { method: 'POST' };
} {
  return {
    path: buildAckRelayCommandPath(id),
    init: buildPostInit(),
  };
}

export function buildDeleteCustomAgentRequest(id: string): {
  path: string;
  init: { method: 'DELETE' };
} {
  return {
    path: buildCustomAgentPath(id),
    init: buildDeleteInit(),
  };
}

export function buildDeleteAgentTeamRequest(teamId: string): {
  path: string;
  init: { method: 'DELETE' };
} {
  return {
    path: buildAgentTeamPath(teamId),
    init: buildDeleteInit(),
  };
}

export function buildDeleteAgentProfileRequest(id: string): {
  path: string;
  init: { method: 'DELETE' };
} {
  return {
    path: buildAgentProfilePath(id),
    init: buildDeleteInit(),
  };
}

export function buildDeleteDocumentRequest(id: string): {
  path: string;
  init: { method: 'DELETE' };
} {
  return {
    path: buildDocumentPath(id),
    init: buildDeleteInit(),
  };
}
