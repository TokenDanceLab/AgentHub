/**
 * Hub client pure path/body/response builders used by multi-line createHubClient methods.
 * Extracted from hubClient.ts (#810) — pure only; methods stay thin request(...) wrappers.
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
