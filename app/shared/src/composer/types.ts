export type ComposerMode = 'ask' | 'plan' | 'code' | 'review' | 'deploy';
export type ComposerSubmitState = 'idle' | 'submitting' | 'error';
export type ApprovalMode = 'suggest' | 'workspace-write' | 'read-only';

export interface ComposerAttachment {
  id: string;
  name: string;
  kind?: string;
}

export interface ComposerState {
  conversationId: string;
  text: string;
  mode: ComposerMode;
  mentions: string[];
  attachments: ComposerAttachment[];
  approvalMode: ApprovalMode;
  workDir: string;
  submitState: ComposerSubmitState;
}

export interface ComposerIntent {
  conversationId: string;
  text: string;
  mode: ComposerMode;
  mentions: string[];
  attachments: ComposerAttachment[];
  approvalMode: ApprovalMode;
  workDir?: string;
}

export interface ComposerSubmitResult {
  intentId: string;
}

export type ComposerAction =
  | { type: 'setText'; text: string }
  | { type: 'setMode'; mode: ComposerMode }
  | { type: 'addMention'; agentId: string }
  | { type: 'removeMention'; agentId: string }
  | { type: 'setApprovalMode'; approvalMode: ApprovalMode }
  | { type: 'setWorkDir'; workDir: string }
  | { type: 'setSubmitState'; submitState: ComposerSubmitState }
  | { type: 'addAttachment'; attachment: ComposerAttachment }
  | { type: 'removeAttachment'; attachmentId: string }
  | { type: 'resetAfterSubmit' };
