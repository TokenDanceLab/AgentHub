/**
 * Transient workbench UI intent for the global status bar (#1994, UX F5).
 *
 * The frame-level awaiting-approval chip dispatches this intent when the
 * active conversation has a pending approval block on the chat page; the
 * mounted ConversationHost owns the transcript highlight/scroll. It is not
 * persisted state — a late event with no listener is simply dropped.
 */
export const WORKBENCH_APPROVAL_JUMP_EVENT = 'agenthub:approval-jump';
