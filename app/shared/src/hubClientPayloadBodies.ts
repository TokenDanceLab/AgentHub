/**
 * Hub client pure body / response / form builders.
 * Peel companion of hubClientPayloadUtils (#1094). Pure only; zero behavior change.
 */

import type {
  HubExecutionTarget,
  HubExecutionTargetListResponse,
  HubOidcAuthorizeRequest,
  HubTriggerAgentTaskOptions,
} from './hubClientDomainTypes';
import type { HubAgentTaskStreamEventOptions } from './hubClientTeamTypes';

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

export function buildOptionalJsonBody(
  payload: unknown | undefined,
): { body: string } | Record<string, never> {
  return payload === undefined ? {} : { body: JSON.stringify(payload) };
}
