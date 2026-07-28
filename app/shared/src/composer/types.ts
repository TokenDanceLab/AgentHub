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
  | { type: 'resetAfterSubmit' };
