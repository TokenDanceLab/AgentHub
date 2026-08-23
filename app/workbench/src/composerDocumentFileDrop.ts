import type { Dispatch } from 'react';
import type { ComposerAction } from '@shared/composer';
import { browserFilesToComposerAttachments } from '@shared/composer';
import {
  buildAttachmentOversizeToast,
  partitionAttachmentsBySize,
} from './unifiedComposerHelpers';
import { dispatchComposerAttachmentAdds } from './unifiedComposerHostHelpers';

/* ═══════════════════════════════════════════════════════════════════════
   composerDocumentFileDrop — document-level file drop routing (#1822).

   Files dragged onto the transcript/sidebar/headers used to open in the
   browser. These handlers intercept any Files drag outside the composer
   form and route it to the composer attachment chips instead. Extracted
   from ConversationHost so the routing decisions are unit-testable;
   ConversationHost only owns listener registration and the dragging flag.
   ═══════════════════════════════════════════════════════════════════════ */

export interface ComposerDocumentFileDropCallbacks {
  dispatchComposer: Dispatch<ComposerAction>;
  onToast: (message: string) => void;
  onDraggingChange: (dragging: boolean) => void;
  /** Live conversation id — the host updates this on every render. */
  getCurrentConversationId: () => string;
}

/** Whether the event target lives inside the composer form (its own
 *  drag/drop handlers keep precedence). */
export function isFileDropInsideComposer(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('[data-composer-form]'));
}

export function handleDocumentDragOver(
  callbacks: ComposerDocumentFileDropCallbacks,
  event: DragEvent,
): void {
  if (!event.dataTransfer?.types?.includes('Files')) return;
  if (isFileDropInsideComposer(event.target)) {
    callbacks.onDraggingChange(false);
    return;
  }
  event.preventDefault();
  callbacks.onDraggingChange(true);
}

export function handleDocumentDragLeave(
  callbacks: ComposerDocumentFileDropCallbacks,
  event: DragEvent,
): void {
  if (
    !(event.relatedTarget instanceof Node) ||
    !document.body.contains(event.relatedTarget)
  ) {
    callbacks.onDraggingChange(false);
  }
}

export function handleDocumentDrop(
  callbacks: ComposerDocumentFileDropCallbacks,
  event: DragEvent,
): void {
  callbacks.onDraggingChange(false);
  if (!event.dataTransfer?.types?.includes('Files')) return;
  if (isFileDropInsideComposer(event.target)) return;
  event.preventDefault();
  const files = Array.from(event.dataTransfer.files);
  if (files.length === 0) return;
  const { accepted, rejected } = partitionAttachmentsBySize(files);
  const oversizeToast = buildAttachmentOversizeToast(rejected);
  if (oversizeToast) callbacks.onToast(oversizeToast);
  if (accepted.length === 0) return;
  // #1853 review: capture the source conversation before the async
  // conversion — a switch while File.text() is pending resets the composer,
  // and the unscoped continuation would land the attachment in the new one.
  const sourceConversationId = callbacks.getCurrentConversationId();
  void browserFilesToComposerAttachments(accepted).then((attachments) => {
    if (callbacks.getCurrentConversationId() !== sourceConversationId) return;
    dispatchComposerAttachmentAdds(callbacks.dispatchComposer, attachments);
  });
}
