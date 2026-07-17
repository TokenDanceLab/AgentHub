import type { QueryClient } from '@tanstack/react-query';
import type { AttachmentRef, ComposerAttachment, ComposerIntent } from '@shared/composer';
import type { HubContentType } from '@shared/hubClient';
import type { MessageResponse, SendMessageResponse } from '@/api/hubClient';

export interface ComposerMessageContent {
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

  return lines.filter(Boolean).join('\n\n');
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

export function hubMessagesQueryKey(sessionId: string): [string, string, string] {
  return ['web-v4', 'hub-messages', sessionId];
}

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
