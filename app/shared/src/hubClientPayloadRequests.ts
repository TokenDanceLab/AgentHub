/**
 * Hub client pure JSON RequestInit + path+init composite builders.
 * Peel companion of hubClientPayloadUtils (#1094). Pure only; zero behavior change.
 */

import type {
  HubOidcAuthorizeRequest,
  HubTriggerAgentTaskOptions,
} from './hubClientDomainTypes';
import type { HubAgentTaskStreamEventOptions } from './hubClientTeamTypes';
import {
  buildAttachmentFormData,
  buildForwardMessageBody,
  buildFriendRequestBody,
  buildMarkReadBody,
  buildMemberIdsBody,
  buildOidcAuthorizeBody,
  buildOptionalJsonBody,
  buildPatchSettingsBody,
  buildProbeAttachmentBody,
  buildRefreshBody,
  buildRemarkBody,
  buildSessionIdBody,
  buildStreamTaskEventBody,
  buildTaskAckBody,
  buildTaskDoneBody,
  buildTaskFailBody,
  buildTaskStreamBody,
  buildTransferOwnerBody,
  buildTriggerAgentTaskBody,
} from './hubClientPayloadBodies';
import {
  buildAcceptFriendRequestPath,
  buildAckRelayCommandPath,
  buildAckTaskPath,
  buildAgentProfilePath,
  buildAgentProfilesPath,
  buildAgentTasksPath,
  buildAgentTeamMembersPath,
  buildAgentTeamPath,
  buildAgentTeamRunsPath,
  buildAgentTeamsPath,
  buildAttachmentsPath,
  buildBlockContactPath,
  buildChangePasswordFallbackPath,
  buildChangePasswordPath,
  buildContactRemarkPath,
  buildCreateGroupSessionPath,
  buildCreatePrivateSessionPath,
  buildCustomAgentPath,
  buildCustomAgentsPath,
  buildDecideTaskApprovalPath,
  buildDecideTeamApprovalPath,
  buildDissolveSessionPath,
  buildDocumentPath,
  buildDocumentsPath,
  buildDoneTaskPath,
  buildEditMessagePath,
  buildExecutionTargetPath,
  buildExecutionTargetsPath,
  buildFailTaskPath,
  buildForwardMessagePath,
  buildFriendRequestsPath,
  buildGetMessagesPath,
  buildLeaveSessionPath,
  buildLoginPath,
  buildLogoutPath,
  buildMarkReadPath,
  buildOidcAuthorizePath,
  buildOidcCallbackPath,
  buildPinMessagePath,
  buildPingExecutionTargetPath,
  buildPostTeamRouteDecisionPath,
  buildProbeAttachmentPath,
  buildRecallMessagePath,
  buildRefreshPath,
  buildRegenerateAgentTaskPath,
  buildRegisterPath,
  buildRejectFriendRequestPath,
  buildRelayCommandsPath,
  buildRemoveAgentTeamMemberPath,
  buildRemoveContactPath,
  buildRemoveSessionMemberPath,
  buildResolveTeamConflictPath,
  buildSendWorkspaceProjectThreadMessagePath,
  buildSessionAgentsPath,
  buildSessionInfoPath,
  buildSessionMembersPath,
  buildSessionPath,
  buildSessionSettingsPath,
  buildSettingsPath,
  buildStreamTaskPath,
  buildTransferSessionOwnerPath,
  buildUnblockContactPath,
  buildUpdateProfilePath,
  buildWorkspaceProjectPath,
  buildWorkspaceProjectThreadsPath,
  buildWorkspaceProjectsPath,
} from './hubClientPayloadPaths';

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

export function buildRemoveMessageReactionRequest(
  messageId: string,
  sessionId: string,
  reaction: { emoji: string },

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

