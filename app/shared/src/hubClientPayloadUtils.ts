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
