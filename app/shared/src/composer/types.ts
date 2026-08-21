export type ComposerMode = 'ask' | 'plan' | 'code' | 'review' | 'deploy';
export type ComposerSubmitState = 'idle' | 'submitting' | 'error';
export type ApprovalMode = 'suggest' | 'workspace-write' | 'read-only';

export interface ComposerMention {
  id: string;
  label: string;
  description?: string;
  status?: 'available' | 'unavailable' | 'configuring';
  model?: string;
  provider?: string;
  runtimeId?: string;
  /**
   * #1406 @agent 派单：区分「上下文附注」vs「派单指令」。
   * - 'context'（default）：仅附注到消息上下文，不触发 agent-tasks
   * - 'dispatch'：触发 POST /web/agent-tasks 派单
   * mapAgentsToComposerMentions 标记 agent 类为 dispatch。
   */
  dispatchRole?: 'context' | 'dispatch';
}

/**
 * Reference to an attachment stored on the Hub server.
 * Returned by `POST /client/attachments` and embedded in messages
 * with `content_type: "file"` or `content_type: "image"`.
 */
export interface AttachmentRef {
  id: string;
  name: string;
  /** Original filename from the Hub server (maps to `original_name` in the API). */
  original_name?: string;
  size: number;
  mime_type: string;
  hash?: string;
  /** Download URL relative to the Hub server base (e.g. `/client/attachments/:id`). */
  url?: string;
  metadata?: string;
  created_at?: string;
}

export interface ComposerAttachment {
  id: string;
  name: string;
  source?: 'browser' | 'desktop';
  kind?: string;
  path?: string;
  size?: number;
  mime?: string;
  contentPreview?: string;
  truncated?: boolean;
  /** Populated after a successful Hub upload. */
  attachmentRef?: AttachmentRef;
  /**
   * Transient file reference retained during the composer editing session.
   * Used to upload the file on submit. Not serialized or persisted.
   */
  file?: File;
}

export interface ReplyToContext {
  messageId: string;
  author: string;
  preview: string;
}

export interface QuoteContext {
  text: string;
  author?: string;
  messageId?: string;
}

/**
 * Composer content captured right before a submit attempt (#1821).
 *
 * A send clears the composer optimistically; when the request then fails the
 * snapshot is dispatched back so the user's text, mentions, attachments and
 * reply/quote context are never silently dropped.
 */
export interface ComposerDraftSnapshot {
  text: string;
  mentions: ComposerMention[];
  attachments: ComposerAttachment[];
  replyTo: ReplyToContext | null;
  quote: QuoteContext | null;
}

export interface ComposerState {
  conversationId: string;
  text: string;
  mode: ComposerMode;
  mentions: ComposerMention[];
  attachments: ComposerAttachment[];
  approvalMode: ApprovalMode;
  workDir: string;
  submitState: ComposerSubmitState;
  replyTo: ReplyToContext | null;
  quote: QuoteContext | null;
  /**
   * When non-null, the composer is editing an already-sent message (block id)
   * instead of composing a new one. Submit then routes to `editMessage`
   * (#1462 CF16) rather than `submitComposerIntent`.
   */
  editingMessageId: string | null;
}

export interface ComposerIntent {
  conversationId: string;
  text: string;
  mode: ComposerMode;
  mentions: ComposerMention[];
  attachments: ComposerAttachment[];
  approvalMode: ApprovalMode;
  workDir?: string;
  replyTo?: ReplyToContext;
  quote?: QuoteContext;
  /**
   * Present when the composer is editing an existing message instead of
   * sending a new one. Carries the transcript block id of the edited message.
   */
  editingMessageId?: string;
}

export interface ComposerSubmitResult {
  intentId: string;
  /**
   * Present when the Hub returned a recoverable 409 `turn_in_progress` — the
   * agent instance already has a non-terminal task (#1430). The composer
   * message was already sent (SendMessage is independent); only task dispatch
   * was rejected. The shell should treat this as recoverable: restore the
   * composer to idle (not error) and surface an info toast, not a hard error.
   */
  turnInProgress?: boolean;
}

export type ComposerAction =
  | { type: 'setConversationId'; conversationId: string }
  | { type: 'setText'; text: string }
  /**
   * Insert text at the start of the existing draft without discarding it
   * (e.g. quote-reply prepends the quoted block, #1821).
   */
  | { type: 'prependText'; text: string }
  | { type: 'setMode'; mode: ComposerMode }
  | { type: 'addMention'; mention: ComposerMention }
  | { type: 'removeMention'; mentionId: string }
  | { type: 'setApprovalMode'; approvalMode: ApprovalMode }
  | { type: 'setWorkDir'; workDir: string }
  | { type: 'setSubmitState'; submitState: ComposerSubmitState }
  | { type: 'addAttachment'; attachment: ComposerAttachment }
  | { type: 'removeAttachment'; attachmentId: string }
  | { type: 'setReplyTo'; replyTo: ReplyToContext | null }
  | { type: 'setQuote'; quote: QuoteContext | null }
  | { type: 'setEditingMessage'; messageId: string | null }
  /** Attach the Hub upload result to an already-listed attachment (#1821). */
  | { type: 'setAttachmentRef'; attachmentId: string; attachmentRef: AttachmentRef }
  /** Put a captured draft back after a failed submit (#1821). */
  | { type: 'restoreDraft'; draft: ComposerDraftSnapshot }
  | { type: 'resetAfterSubmit' };
