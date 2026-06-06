export type ComposerMode = 'ask' | 'code';
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
  submitState: ComposerSubmitState;
}

export interface ComposerIntent {
  conversationId: string;
  text: string;
  mode: ComposerMode;
  mentions: string[];
  attachments: ComposerAttachment[];
  approvalMode: ApprovalMode;
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
  | { type: 'setSubmitState'; submitState: ComposerSubmitState }
  | { type: 'addAttachment'; attachment: ComposerAttachment }
  | { type: 'removeAttachment'; attachmentId: string }
  | { type: 'resetAfterSubmit' };
