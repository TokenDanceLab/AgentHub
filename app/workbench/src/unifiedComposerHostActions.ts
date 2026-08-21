import type { Dispatch } from 'react';
import type {
  ComposerAction,
  ComposerAttachment,
  ComposerMention,
} from '@shared/composer';
import { findMentionById } from './unifiedComposerHelpers';

/* ═══════════════════════════════════════════════════════════════════════
   unifiedComposerHostActions — pure action residual slices from
   unifiedComposerHostHelpers (#780).

   Mention/attachment/text/reply/quote action builders and attachment
   dispatch helpers. No React hooks / no intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

/** Plan mention add action from a picker selection. */
export function planAddMentionAction(
  mentionableAgents: ComposerMention[],
  agentId: string,
): Extract<ComposerAction, { type: 'addMention' }> | null {
  const mention = findMentionById(mentionableAgents, agentId);
  if (!mention) return null;
  return { type: 'addMention', mention };
}

/** Map attachments into composer addAttachment actions. */
export function composerAttachmentAddActions(
  attachments: ComposerAttachment[],
): Array<Extract<ComposerAction, { type: 'addAttachment' }>> {
  return attachments.map((attachment) => ({
    type: 'addAttachment',
    attachment,
  }));
}

/** Cancel reply bar → setReplyTo null. */
export function cancelReplyAction(): Extract<ComposerAction, { type: 'setReplyTo' }> {
  return { type: 'setReplyTo', replyTo: null };
}

/** Cancel quote bar → setQuote null. */
export function cancelQuoteAction(): Extract<ComposerAction, { type: 'setQuote' }> {
  return { type: 'setQuote', quote: null };
}

/**
 * Enter edit mode for an already-sent message (#1462 CF16). Carries the
 * transcript block id of the message being edited.
 */
export function setEditingMessageAction(
  messageId: string,
): Extract<ComposerAction, { type: 'setEditingMessage' }> {
  return { type: 'setEditingMessage', messageId };
}

/** Cancel the edit bar → clear editingMessageId. */
export function cancelEditAction(): Extract<ComposerAction, { type: 'setEditingMessage' }> {
  return { type: 'setEditingMessage', messageId: null };
}

/** Remove a mention chip. */
export function removeMentionAction(
  mentionId: string,
): Extract<ComposerAction, { type: 'removeMention' }> {
  return { type: 'removeMention', mentionId };
}

/** Remove an attachment chip. */
export function removeAttachmentAction(
  attachmentId: string,
): Extract<ComposerAction, { type: 'removeAttachment' }> {
  return { type: 'removeAttachment', attachmentId };
}

/** Textarea onChange → setText. */
export function setComposerTextAction(
  text: string,
): Extract<ComposerAction, { type: 'setText' }> {
  return { type: 'setText', text };
}

/** Dispatch every attachment-add action through the provided dispatcher. */
export function dispatchComposerAttachmentAdds(
  dispatchComposer: Dispatch<ComposerAction>,
  attachments: ComposerAttachment[],
): void {
  for (const action of composerAttachmentAddActions(attachments)) {
    dispatchComposer(action);
  }
}
