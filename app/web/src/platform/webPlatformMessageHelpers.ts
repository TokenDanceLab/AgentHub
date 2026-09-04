import type { QueryClient } from '@tanstack/react-query';
import {
  isQueryKeyPrefix,
  webQueryKeys,
  type HubMessagesKeyFamily,
} from '@shared/stores/queryKeys';
import type { AttachmentRef, ComposerAttachment, ComposerIntent } from '@shared/composer';
import type { HubContentType } from '@shared/hub/hubClient';
import type { MessageResponse, SendMessageResponse } from '@/api/hubClient';

interface ComposerMessageContent {
  contentType: HubContentType;
  content: string;
}

export function buildAttachmentContentJSON(
  attachment: ComposerAttachment,
  text?: string,
): string {
  const ref = attachment.attachmentRef;
  if (!ref) return JSON.stringify({ name: attachment.name });
  const payload: Record<string, string> = {
    attachment_id: ref.id,
    name: ref.original_name ?? ref.name ?? attachment.name,
  };
  if (text?.trim()) {
    payload.caption = text.trim();
  }
  return JSON.stringify(payload);
}

export function firstUploadedAttachment(
  attachments: ComposerAttachment[],
  mimePrefix: string,
): ComposerAttachment | undefined {
  return attachments.find((a) => a.mime?.startsWith(mimePrefix) && a.attachmentRef);
}

export function buildHubComposerPrompt(intent: ComposerIntent): string {
  const lines = [intent.text.trim()];
  const attachmentContext = intent.attachments
    .filter((attachment) => attachment.contentPreview?.trim())
    .map((attachment) => {
      const source = attachment.source ? ` (${attachment.source})` : '';
      return `### ${attachment.name}${source}\n${attachment.contentPreview}`;
    });

  if (attachmentContext.length > 0) {
    lines.push('[AgentHub attachments]', attachmentContext.join('\n\n'));
  }

  const text = lines.filter(Boolean).join('\n\n');

  // #1406 @agent 派单：当有 dispatch mention 时，按 openapi 规范用 JSON 包装
  // content 以携带 @Agent mention 元数据（openapi.yaml:3577）。
  const dispatchMentions = intent.mentions.filter(
    (m) => m.dispatchRole === 'dispatch',
  );
  if (dispatchMentions.length > 0) {
    return JSON.stringify({
      text,
      mentions: dispatchMentions.map((mention) => ({
        id: mention.id,
        label: mention.label,
        ...(mention.runtimeId ? { runtime_id: mention.runtimeId } : {}),
        ...(mention.model ? { model: mention.model } : {}),
        dispatch_role: mention.dispatchRole,
      })),
    });
  }

  return text;
}

/** Resolve Hub content_type + content payload for a composer intent. */
export function resolveComposerMessageContent(intent: ComposerIntent): ComposerMessageContent {
  const hasAttachments = intent.attachments.length > 0;
  const firstImageAttachment = hasAttachments
    ? firstUploadedAttachment(intent.attachments, 'image/')
    : undefined;
  const firstFileAttachment = hasAttachments && !firstImageAttachment
    ? firstUploadedAttachment(intent.attachments, '')
    : undefined;

  if (firstImageAttachment?.attachmentRef) {
    return {
      contentType: 'image',
      content: buildAttachmentContentJSON(firstImageAttachment, intent.text.trim()),
    };
  }
  if (firstFileAttachment?.attachmentRef) {
    return {
      contentType: 'file',
      content: buildAttachmentContentJSON(firstFileAttachment, intent.text.trim()),
    };
  }
  return {
    contentType: 'text',
    content: buildHubComposerPrompt(intent),
  };
}

export function optimisticHubMessageFromIntent(
  intent: ComposerIntent,
  clientMessageId: string,
  createdAt: string,
): MessageResponse {
  const { contentType, content } = resolveComposerMessageContent(intent);

  const attachmentRefs = intent.attachments
    .filter((a): a is ComposerAttachment & { attachmentRef: AttachmentRef } => Boolean(a.attachmentRef));

  return {
    id: clientMessageId,
    session_id: intent.conversationId,
    seq_id: Number.MAX_SAFE_INTEGER,
    client_msg_id: clientMessageId,
    sender_type: 'user',
    sender_id: 'web-current-user',
    content_type: contentType,
    content,
    created_at: createdAt,
    ...(intent.replyTo
      ? {
          reply_to: {
            id: intent.replyTo.messageId,
            sender_id: intent.replyTo.author,
            content_type: 'text',
            content: '',
            recalled: false,
            created_at: createdAt,
          },
        }
      : {}),
    ...(attachmentRefs.length > 0
      ? {
          attachments: attachmentRefs.map((a) => ({
            id: a.attachmentRef.id,
            hash: a.attachmentRef.hash ?? '',
            size: a.attachmentRef.size,
            mime_type: a.attachmentRef.mime_type,
            ...(a.attachmentRef.original_name ? { original_name: a.attachmentRef.original_name } : {}),
            ...(a.attachmentRef.metadata ? { metadata: a.attachmentRef.metadata } : {}),
            ...(a.attachmentRef.created_at ? { created_at: a.attachmentRef.created_at } : {}),
          })),
        }
      : {}),
  };
}

/**
 * Broad prefix covering every cached Web transcript (#2252).
 *
 * Web keeps transcripts in its app-scoped `web-v4` cache-version namespace
 * rather than the shared `hubQueryKeys.threads` family, and three local cache
 * writers below (`upsertHubMessage` / `confirmOptimisticHubMessage` /
 * `removeOptimisticHubMessage`) `setQueryData` straight into this shape.
 *
 * The literal lives in `webQueryKeys.messages` — this module only re-exports it
 * as the `HubMessagesKeyFamily` that `resyncMessagesAfterReconnect` consumes.
 * (The comment here used to justify the split by claiming `['hub','threads']`
 * was Web's session-list key; it is not — Web's list is
 * `webQueryKeys.sessions.list(hubReady)`, and `hubQueryKeys.threads.list` had
 * no Web producer at all, which is why `contactQueries` / `useWebAuth` session
 * invalidations were silent no-ops, #2261.)
 *
 * Because the shape is Web-only, it is exported as a `HubMessagesKeyFamily` so
 * shared consumers (notably `resyncMessagesAfterReconnect`) match it instead of
 * guessing — a hardcoded threads-shape matcher is what made the #2101
 * reconnect/gap resync a silent no-op here.
 */
export const hubMessagesQueryRoot = webQueryKeys.messages.root;

/** Exact query key holding one session's Web transcript. */
export function hubMessagesQueryKey(sessionId: string): readonly unknown[] {
  return webQueryKeys.messages.of(sessionId);
}

/** Web's transcript key family — pass to `resyncMessagesAfterReconnect`. */
export const webHubMessagesFamily: HubMessagesKeyFamily = {
  root: hubMessagesQueryRoot,
  of: (sessionId) => hubMessagesQueryKey(sessionId),
  sessionIdOf: (key) =>
    key.length === 3 &&
    isQueryKeyPrefix(key, hubMessagesQueryRoot) &&
    typeof key[2] === 'string'
      ? key[2]
      : null,
};

export function upsertHubMessage(
  queryClient: QueryClient | undefined,
  message: MessageResponse,
): void {
  queryClient?.setQueryData<MessageResponse[]>(
    hubMessagesQueryKey(message.session_id),
    (current = []) => [
      ...current.filter((item) => item.client_msg_id !== message.client_msg_id && item.id !== message.id),
      message,
    ],
  );
}

export function confirmOptimisticHubMessage(
  queryClient: QueryClient | undefined,
  sessionId: string,
  clientMessageId: string,
  response: SendMessageResponse,
): void {
  queryClient?.setQueryData<MessageResponse[]>(
    hubMessagesQueryKey(sessionId),
    (current = []) => current.map((message) =>
      message.client_msg_id === clientMessageId
        ? {
            ...message,
            id: response.message_id,
            seq_id: response.seq_id,
            created_at: response.created_at,
          }
        : message,
    ),
  );
}

export function removeOptimisticHubMessage(
  queryClient: QueryClient | undefined,
  sessionId: string,
  clientMessageId: string,
): void {
  queryClient?.setQueryData<MessageResponse[]>(
    hubMessagesQueryKey(sessionId),
    (current = []) => current.filter((message) => message.client_msg_id !== clientMessageId),
  );
}
