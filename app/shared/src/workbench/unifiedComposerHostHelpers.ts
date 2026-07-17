import type {
  Dispatch,
  FormEvent,
  Ref,
} from 'react';
import type {
  ComposerAction,
  ComposerAttachment,
  ComposerMention,
  ComposerState,
  QuoteContext,
  ReplyToContext,
} from '../composer';
import type { ComposerSubmitBehavior } from './workbenchPreferences';
import {
  buildTextWithNewline,
  canSubmitFromKeyDown,
  COMPOSER_FILE_ACCEPT,
  deriveUnifiedComposerState,
  findMentionById,
  isExecutionTargetStillValid,
  shouldSubmitComposerKey,
  type AttachmentUploadState,
  type ComposerExecutionTarget,
  type ComposerStatusHints,
  type UnifiedComposerDerivedState,
} from './unifiedComposerHelpers';

export { COMPOSER_FILE_ACCEPT };

/* ═══════════════════════════════════════════════════════════════════════
   unifiedComposerHostHelpers — pure residual slices from UnifiedComposer
   host shell (#718).

   Props types, runtime defaults, derived host view-model, chrome render
   model, keydown/file-picker/mention planners, and action builders.
   No React hooks / no intentional UX change.
   exactOptionalPropertyTypes: only assign `?: T` fields when defined,
   unless the public field type explicitly allows `| undefined`.
   ═══════════════════════════════════════════════════════════════════════ */

export type {
  AttachmentUploadState,
  ComposerExecutionTarget,
  ComposerStatusHints,
};

export interface UnifiedComposerProps {
  composer: ComposerState;
  dispatchComposer: Dispatch<ComposerAction>;
  executionTargets?: Array<{ id: string; label: string }> | undefined;
  executionTargetId?: string | undefined;
  mentionableAgents?: ComposerMention[];
  onExecutionTargetChange?: ((executionTargetId: string) => void) | undefined;
  onPickLocalAttachments?: (() => Promise<ComposerAttachment[]>) | undefined;
  submitBehavior?: ComposerSubmitBehavior | undefined;
  status?: {
    dataMode?: string | undefined;
    replayLabel?: string | undefined;
    targetLabel?: string | undefined;
    targetState?: string | undefined;
  } | undefined;
  uploadProgresses?: Record<string, AttachmentUploadState>;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  inputRef?: Ref<HTMLTextAreaElement>;
  targetLabel?: string | undefined;
}

export interface ComposerChromeVisibility {
  replyBar: boolean;
  quoteBar: boolean;
  mentionChips: boolean;
  mainchainStrip: boolean;
  attachmentBar: boolean;
  agentPicker: boolean;
  targetPicker: boolean;
  statusStrip: boolean;
}

export interface ComposerHostRuntimeDefaults {
  executionTargetId: string;
  mentionableAgents: ComposerMention[];
  submitBehavior: ComposerSubmitBehavior;
  targetLabel: string;
  hasNativePicker: boolean;
}

export interface ComposerHostMainchainModel {
  mainchainTask: 'ready' | 'draft required';
  selectedAgentLabel: string;
  selectedTargetLabel: string | undefined;
  targetSelected: boolean;
}

export interface ComposerHostAttachmentModel {
  attachments: ComposerAttachment[];
  uploadProgresses: Record<string, AttachmentUploadState> | undefined;
}

export interface ComposerHostTargetPickerModel {
  executionTargetId: string;
  executionTargets: ComposerExecutionTarget[];
}

export interface ComposerHostChromeModel {
  replyTo: ReplyToContext | null;
  quote: QuoteContext | null;
  mentions: ComposerMention[] | null;
  mainchain: ComposerHostMainchainModel | null;
  attachment: ComposerHostAttachmentModel | null;
  agentOptions: ComposerMention[] | null;
  targetPicker: ComposerHostTargetPickerModel | null;
  statusItems: string[] | null;
}

export interface ComposerHostViewModel extends UnifiedComposerDerivedState {
  chrome: ComposerChromeVisibility;
  chromeModel: ComposerHostChromeModel;
  hasMentions: boolean;
  inputPlaceholder: string;
  fileAccept: string;
}

export type ComposerHostKeyDownPlan =
  | { kind: 'none' }
  | { kind: 'insert-newline'; nextText: string; caret: number }
  | { kind: 'submit' }
  | { kind: 'blocked-submit' };

export type ComposerFilePickPlan =
  | { kind: 'noop' }
  | { kind: 'native' }
  | { kind: 'browser'; files: File[] };

export type ComposerOpenFilePickerPlan =
  | { kind: 'native' }
  | { kind: 'web-input' };

export interface ComposerKeyDownEventFields {
  key: string;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  selectionStart: number | null;
  selectionEnd: number | null;
  currentText: string;
}

export interface ComposerCaretRestore {
  selectionStart: number;
  selectionEnd: number;
}

/** Build the input placeholder for the current conversation target. */
export function composerInputPlaceholder(targetLabel: string): string {
  return `发消息给 ${targetLabel}`;
}

/**
 * Resolve host prop defaults that used to live as destructuring defaults
 * on UnifiedComposer.
 */
export function resolveComposerHostRuntime(params: {
  executionTargetId?: string | undefined;
  mentionableAgents?: ComposerMention[] | undefined;
  submitBehavior?: ComposerSubmitBehavior | undefined;
  targetLabel?: string | undefined;
  onPickLocalAttachments?: (() => Promise<ComposerAttachment[]>) | undefined;
}): ComposerHostRuntimeDefaults {
  return {
    executionTargetId: params.executionTargetId ?? '',
    mentionableAgents: params.mentionableAgents ?? [],
    submitBehavior: params.submitBehavior ?? 'enter-send',
    targetLabel: params.targetLabel ?? 'AgentHub',
    hasNativePicker: Boolean(params.onPickLocalAttachments),
  };
}

/** Whether the selected execution target must be cleared as stale. */
export function shouldClearExecutionTarget(
  executionTargets: ComposerExecutionTarget[] | undefined,
  executionTargetId: string,
): boolean {
  return !isExecutionTargetStillValid(executionTargets, executionTargetId);
}

/** Derive which host chrome regions should render. */
export function deriveComposerChromeVisibility(params: {
  composer: ComposerState;
  mentionableAgentsCount: number;
  hasExecutionTargets: boolean;
  statusItemsCount: number;
}): ComposerChromeVisibility {
  const {
    composer,
    mentionableAgentsCount,
    hasExecutionTargets,
    statusItemsCount,
  } = params;
  const hasMentions = composer.mentions.length > 0;

  return {
    replyBar: Boolean(composer.replyTo),
    quoteBar: Boolean(composer.quote),
    mentionChips: hasMentions,
    mainchainStrip: hasMentions,
    attachmentBar: composer.attachments.length > 0,
    agentPicker: mentionableAgentsCount > 0,
    targetPicker: hasExecutionTargets,
    statusStrip: statusItemsCount > 0,
  };
}

/**
 * Build nullable chrome payloads so the host only renders defined regions.
 * exactOptionalPropertyTypes-safe: nested optionals stay explicit.
 */
export function buildComposerHostChromeModel(params: {
  composer: ComposerState;
  derived: UnifiedComposerDerivedState;
  executionTargets: ComposerExecutionTarget[] | undefined;
  executionTargetId: string;
  uploadProgresses: Record<string, AttachmentUploadState> | undefined;
  chrome: ComposerChromeVisibility;
}): ComposerHostChromeModel {
  const {
    composer,
    derived,
    executionTargets,
    executionTargetId,
    uploadProgresses,
    chrome,
  } = params;

  return {
    replyTo: chrome.replyBar && composer.replyTo ? composer.replyTo : null,
    quote: chrome.quoteBar && composer.quote ? composer.quote : null,
    mentions: chrome.mentionChips ? composer.mentions : null,
    mainchain: chrome.mainchainStrip
      ? {
          mainchainTask: derived.mainchainTask,
          selectedAgentLabel: derived.selectedAgentLabel,
          selectedTargetLabel: derived.selectedTargetLabel,
          targetSelected: derived.targetSelected,
        }
      : null,
    attachment: chrome.attachmentBar
      ? {
          attachments: composer.attachments,
          uploadProgresses,
        }
      : null,
    agentOptions: chrome.agentPicker ? derived.availableMentionOptions : null,
    targetPicker: chrome.targetPicker && executionTargets
      ? {
          executionTargetId,
          executionTargets,
        }
      : null,
    statusItems: chrome.statusStrip ? derived.statusItems : null,
  };
}

/**
 * Compose derived submit/status state with chrome visibility + render model
 * + placeholder for the host shell.
 */
export function buildComposerHostViewModel(params: {
  composer: ComposerState;
  executionTargets: ComposerExecutionTarget[] | undefined;
  executionTargetId: string;
  mentionableAgents: ComposerMention[];
  status: ComposerStatusHints | undefined;
  targetLabel: string;
  uploadProgresses: Record<string, AttachmentUploadState> | undefined;
  fileAccept?: string | undefined;
}): ComposerHostViewModel {
  const {
    composer,
    executionTargets,
    executionTargetId,
    mentionableAgents,
    status,
    targetLabel,
    uploadProgresses,
  } = params;
  const fileAccept = params.fileAccept ?? COMPOSER_FILE_ACCEPT;

  const derived = deriveUnifiedComposerState({
    composer,
    executionTargets,
    executionTargetId,
    mentionableAgents,
    status,
  });
  const chrome = deriveComposerChromeVisibility({
    composer,
    mentionableAgentsCount: mentionableAgents.length,
    hasExecutionTargets: Boolean(executionTargets),
    statusItemsCount: derived.statusItems.length,
  });
  const chromeModel = buildComposerHostChromeModel({
    composer,
    derived,
    executionTargets,
    executionTargetId,
    uploadProgresses,
    chrome,
  });

  return {
    ...derived,
    chrome,
    chromeModel,
    hasMentions: composer.mentions.length > 0,
    inputPlaceholder: composerInputPlaceholder(targetLabel),
    fileAccept,
  };
}

export interface UnifiedComposerHostState {
  runtime: ComposerHostRuntimeDefaults;
  view: ComposerHostViewModel;
}

/**
 * Resolve host runtime defaults + view-model in one pure step for the shell.
 */
export function buildUnifiedComposerHostState(params: {
  composer: ComposerState;
  executionTargets: ComposerExecutionTarget[] | undefined;
  executionTargetId?: string | undefined;
  mentionableAgents?: ComposerMention[] | undefined;
  submitBehavior?: ComposerSubmitBehavior | undefined;
  targetLabel?: string | undefined;
  onPickLocalAttachments?: (() => Promise<ComposerAttachment[]>) | undefined;
  status: ComposerStatusHints | undefined;
  uploadProgresses: Record<string, AttachmentUploadState> | undefined;
}): UnifiedComposerHostState {
  const runtime = resolveComposerHostRuntime({
    executionTargetId: params.executionTargetId,
    mentionableAgents: params.mentionableAgents,
    submitBehavior: params.submitBehavior,
    targetLabel: params.targetLabel,
    onPickLocalAttachments: params.onPickLocalAttachments,
  });
  const view = buildComposerHostViewModel({
    composer: params.composer,
    executionTargets: params.executionTargets,
    executionTargetId: runtime.executionTargetId,
    mentionableAgents: runtime.mentionableAgents,
    status: params.status,
    targetLabel: runtime.targetLabel,
    uploadProgresses: params.uploadProgresses,
  });
  return { runtime, view };
}

export type ComposerHostKeyDownEffect =
  | { kind: 'none' }
  | { kind: 'insert-newline'; textAction: Extract<ComposerAction, { type: 'setText' }>; caret: ComposerCaretRestore }
  | { kind: 'submit' }
  | { kind: 'blocked-submit' };

/** Map a keydown plan into host side-effect descriptors. */
export function composerHostKeyDownEffect(
  plan: ComposerHostKeyDownPlan,
): ComposerHostKeyDownEffect {
  if (plan.kind === 'insert-newline') {
    return {
      kind: 'insert-newline',
      textAction: setComposerTextAction(plan.nextText),
      caret: composerCaretRestore(plan.caret),
    };
  }
  if (plan.kind === 'submit') return { kind: 'submit' };
  if (plan.kind === 'blocked-submit') return { kind: 'blocked-submit' };
  return { kind: 'none' };
}

/** Full keydown event → host effect planner. */
export function planComposerHostKeyDownEffect(params: {
  event: {
    key: string;
    altKey: boolean;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    nativeEvent: { isComposing: boolean };
    currentTarget: {
      selectionStart: number | null;
      selectionEnd: number | null;
      value: string;
    };
  };
  submitBehavior: ComposerSubmitBehavior;
  composerText: string;
  attachments: ComposerAttachment[];
  isSubmitting: boolean;
  targetSelectionRequired: boolean;
  executionTargetId: string;
}): ComposerHostKeyDownEffect {
  return composerHostKeyDownEffect(planComposerHostKeyDownFromEvent(params));
}

/** Snapshot keyboard event fields used by the host keydown planner. */
export function readComposerKeyDownEventFields(event: {
  key: string;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  nativeEvent: { isComposing: boolean };
  currentTarget: {
    selectionStart: number | null;
    selectionEnd: number | null;
    value: string;
  };
}): ComposerKeyDownEventFields {
  return {
    key: event.key,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    isComposing: event.nativeEvent.isComposing,
    selectionStart: event.currentTarget.selectionStart,
    selectionEnd: event.currentTarget.selectionEnd,
    // Prefer the textarea DOM value over React state to avoid stale submit
    // when Enter races an in-flight onChange batch.
    currentText: event.currentTarget.value ?? '',
  };
}

/**
 * Plan host keydown behavior for the composer textarea.
 * `blocked-submit` means preventDefault without requestSubmit (mirrors shell).
 */
export function planComposerHostKeyDown(params: {
  key: string;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  submitBehavior: ComposerSubmitBehavior;
  composerText: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  currentText: string;
  attachments: ComposerAttachment[];
  isSubmitting: boolean;
  targetSelectionRequired: boolean;
  executionTargetId: string;
}): ComposerHostKeyDownPlan {
  const keyPlan = shouldSubmitComposerKey({
    key: params.key,
    altKey: params.altKey,
    shiftKey: params.shiftKey,
    ctrlKey: params.ctrlKey,
    metaKey: params.metaKey,
    isComposing: params.isComposing,
    submitBehavior: params.submitBehavior,
  });

  if (keyPlan.insertNewline) {
    const { nextText, caret } = buildTextWithNewline({
      text: params.composerText,
      selectionStart: params.selectionStart,
      selectionEnd: params.selectionEnd,
    });
    return { kind: 'insert-newline', nextText, caret };
  }

  if (!keyPlan.shouldSubmit) return { kind: 'none' };

  if (canSubmitFromKeyDown({
    currentText: params.currentText,
    attachments: params.attachments,
    isSubmitting: params.isSubmitting,
    targetSelectionRequired: params.targetSelectionRequired,
    executionTargetId: params.executionTargetId,
  })) {
    return { kind: 'submit' };
  }

  return { kind: 'blocked-submit' };
}

/** Read + plan keydown in one pure step for the host handler. */
export function planComposerHostKeyDownFromEvent(params: {
  event: {
    key: string;
    altKey: boolean;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    nativeEvent: { isComposing: boolean };
    currentTarget: {
      selectionStart: number | null;
      selectionEnd: number | null;
      value: string;
    };
  };
  submitBehavior: ComposerSubmitBehavior;
  composerText: string;
  attachments: ComposerAttachment[];
  isSubmitting: boolean;
  targetSelectionRequired: boolean;
  executionTargetId: string;
}): ComposerHostKeyDownPlan {
  const fields = readComposerKeyDownEventFields(params.event);
  return planComposerHostKeyDown({
    ...fields,
    submitBehavior: params.submitBehavior,
    composerText: params.composerText,
    attachments: params.attachments,
    isSubmitting: params.isSubmitting,
    targetSelectionRequired: params.targetSelectionRequired,
    executionTargetId: params.executionTargetId,
  });
}

/** Pure caret restore values after insert-newline. */
export function composerCaretRestore(caret: number): ComposerCaretRestore {
  return {
    selectionStart: caret,
    selectionEnd: caret,
  };
}

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

/**
 * Plan file-input change handling.
 * Native picker wins when provided (desktop), even if the hidden input fired.
 */
export function planComposerFilePick(params: {
  fileList: FileList | null;
  hasNativePicker: boolean;
}): ComposerFilePickPlan {
  if (params.hasNativePicker) return { kind: 'native' };
  if (!params.fileList || params.fileList.length === 0) return { kind: 'noop' };
  return { kind: 'browser', files: Array.from(params.fileList) };
}

/** Plan attach-button click: native desktop picker vs hidden web input. */
export function planOpenFilePicker(
  hasNativePicker: boolean,
): ComposerOpenFilePickerPlan {
  return hasNativePicker ? { kind: 'native' } : { kind: 'web-input' };
}

/**
 * Resolve attachments for a planned file pick.
 * Keeps browser conversion injectable so the helper stays testable/pure-ish.
 */
export async function resolveComposerFilePickAttachments(params: {
  plan: ComposerFilePickPlan;
  onPickLocalAttachments?: (() => Promise<ComposerAttachment[]>) | undefined;
  browserFilesToAttachments: (files: File[]) => Promise<ComposerAttachment[]>;
}): Promise<ComposerAttachment[]> {
  const { plan, onPickLocalAttachments, browserFilesToAttachments } = params;
  if (plan.kind === 'native') {
    if (!onPickLocalAttachments) return [];
    try {
      return await onPickLocalAttachments();
    } catch {
      // User cancelled or picker failed — nothing to do
      return [];
    }
  }
  if (plan.kind === 'browser') {
    return browserFilesToAttachments(plan.files);
  }
  return [];
}

/** Resolve attachments for an attach-button open plan. */
export async function resolveOpenFilePickerAttachments(params: {
  plan: ComposerOpenFilePickerPlan;
  onPickLocalAttachments?: (() => Promise<ComposerAttachment[]>) | undefined;
}): Promise<ComposerAttachment[] | null> {
  const { plan, onPickLocalAttachments } = params;
  if (plan.kind !== 'native') return null;
  if (!onPickLocalAttachments) return [];
  try {
    return await onPickLocalAttachments();
  } catch {
    // User cancelled
    return [];
  }
}

/** Cancel reply bar → setReplyTo null. */
export function cancelReplyAction(): Extract<ComposerAction, { type: 'setReplyTo' }> {
  return { type: 'setReplyTo', replyTo: null };
}

/** Cancel quote bar → setQuote null. */
export function cancelQuoteAction(): Extract<ComposerAction, { type: 'setQuote' }> {
  return { type: 'setQuote', quote: null };
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

export type ComposerFilePickResolution =
  | { kind: 'noop' }
  | { kind: 'attachments'; attachments: ComposerAttachment[]; resetInput: true };

/**
 * Plan + resolve a hidden file-input change into host dispatch payloads.
 * Returns noop when the file list is empty and no native picker is configured.
 */
export async function resolveComposerFilePickChange(params: {
  fileList: FileList | null;
  hasNativePicker: boolean;
  onPickLocalAttachments?: (() => Promise<ComposerAttachment[]>) | undefined;
  browserFilesToAttachments: (files: File[]) => Promise<ComposerAttachment[]>;
}): Promise<ComposerFilePickResolution> {
  const plan = planComposerFilePick({
    fileList: params.fileList,
    hasNativePicker: params.hasNativePicker,
  });
  if (plan.kind === 'noop') return { kind: 'noop' };
  const attachments = await resolveComposerFilePickAttachments({
    plan,
    onPickLocalAttachments: params.onPickLocalAttachments,
    browserFilesToAttachments: params.browserFilesToAttachments,
  });
  return { kind: 'attachments', attachments, resetInput: true };
}

export type ComposerOpenFilePickerResolution =
  | { kind: 'web-input' }
  | { kind: 'attachments'; attachments: ComposerAttachment[] };

/** Plan + resolve attach-button click into host dispatch payloads. */
export async function resolveComposerOpenFilePicker(params: {
  hasNativePicker: boolean;
  onPickLocalAttachments?: (() => Promise<ComposerAttachment[]>) | undefined;
}): Promise<ComposerOpenFilePickerResolution> {
  const attachments = await resolveOpenFilePickerAttachments({
    plan: planOpenFilePicker(params.hasNativePicker),
    onPickLocalAttachments: params.onPickLocalAttachments,
  });
  if (attachments === null) return { kind: 'web-input' };
  return { kind: 'attachments', attachments };
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
