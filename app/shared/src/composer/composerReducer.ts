import type { ComposerAction, ComposerIntent, ComposerState } from './types';

export function createInitialComposerState(conversationId: string): ComposerState {
  return {
    conversationId,
    text: '',
    mode: 'ask',
    mentions: [],
    attachments: [],
    approvalMode: 'suggest',
    workDir: '',
    submitState: 'idle',
    replyTo: null,
    quote: null,
    editingMessageId: null,
  };
}

export function composerReducer(
  state: ComposerState,
  action: ComposerAction,
): ComposerState {
  switch (action.type) {
    case 'setConversationId':
      return state.conversationId === action.conversationId
        ? state
        : {
            ...state,
            conversationId: action.conversationId,
            submitState: 'idle',
            // A stale edit context must not survive a conversation switch (#1462).
            editingMessageId: null,
          };
    case 'setText':
      return {
        ...state,
        text: action.text,
        submitState: state.submitState === 'error' ? 'idle' : state.submitState,
      };
    case 'setMode':
      return {
        ...state,
        mode: action.mode,
      };
    case 'addMention':
      if (state.mentions.some((mention) => mention.id === action.mention.id)) return state;
      return {
        ...state,
        mentions: [...state.mentions, action.mention],
      };
    case 'removeMention':
      return {
        ...state,
        mentions: state.mentions.filter((mention) => mention.id !== action.mentionId),
      };
    case 'setApprovalMode':
      return {
        ...state,
        approvalMode: action.approvalMode,
      };
    case 'setWorkDir':
      return {
        ...state,
        workDir: action.workDir,
      };
    case 'setSubmitState':
      return {
        ...state,
        submitState: action.submitState,
      };
    case 'setReplyTo':
      return {
        ...state,
        replyTo: action.replyTo,
      };
    case 'setQuote':
      return {
        ...state,
        quote: action.quote,
      };
    case 'setEditingMessage':
      return {
        ...state,
        editingMessageId: action.messageId,
        // Clearing an in-flight edit must restore idle submit chrome; setting a
        // new edit target must not inherit a stale error state.
        submitState: state.submitState === 'error' ? 'idle' : state.submitState,
      };
    case 'addAttachment':
      if (state.attachments.some((attachment) => attachment.id === action.attachment.id)) {
        return state;
      }
      return {
        ...state,
        attachments: [...state.attachments, action.attachment],
      };
    case 'removeAttachment':
      return {
        ...state,
        attachments: state.attachments.filter((attachment) => attachment.id !== action.attachmentId),
      };
    case 'resetAfterSubmit':
      return {
        ...state,
        text: '',
        mentions: [],
        attachments: [],
        submitState: 'idle',
        replyTo: null,
        quote: null,
        editingMessageId: null,
      };
    default:
      return state;
  }
}

export function canSubmitComposer(state: ComposerState): boolean {
  return state.text.trim().length > 0 || state.attachments.length > 0;
}

export function buildComposerIntent(state: ComposerState): ComposerIntent {
  return {
    conversationId: state.conversationId,
    text: state.text.trim(),
    mode: state.mode,
    mentions: [...state.mentions],
    attachments: [...state.attachments],
    approvalMode: state.approvalMode,
    ...(state.workDir.trim() ? { workDir: state.workDir.trim() } : {}),
    ...(state.replyTo ? { replyTo: state.replyTo } : {}),
    ...(state.quote ? { quote: state.quote } : {}),
    ...(state.editingMessageId ? { editingMessageId: state.editingMessageId } : {}),
  };
}
