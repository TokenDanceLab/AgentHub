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
}

export interface ComposerIntent {
  conversationId: string;
  text: string;
  mode: ComposerMode;
  mentions: ComposerMention[];
  attachments: ComposerAttachment[];
  approvalMode: ApprovalMode;
  workDir?: string;
}

export interface ComposerSubmitResult {
  intentId: string;
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
  | { type: 'resetAfterSubmit' };
