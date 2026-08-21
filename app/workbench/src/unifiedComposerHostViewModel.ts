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
} from '@shared/composer';
import type { ComposerSubmitBehavior } from './workbenchPreferences';
import {
  COMPOSER_FILE_ACCEPT,
  deriveUnifiedComposerState,
  isExecutionTargetStillValid,
  type AttachmentUploadState,
  type ComposerExecutionTarget,
  type ComposerStatusHints,
  type UnifiedComposerDerivedState,
} from './unifiedComposerHelpers';

/* ═══════════════════════════════════════════════════════════════════════
   unifiedComposerHostViewModel — pure host view/chrome residual slices
   from unifiedComposerHostHelpers (#780).

   Props types, runtime defaults, chrome visibility, chrome render model,
   and combined host view-model builders.
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
  /**
   * Whether an agent run is currently active. When true (and `onCancel` is
   * provided) the send button morphs into a stop button (#1462 CF13).
   */
  isRunning?: boolean | undefined;
  /** Cancel the active agent run (stop button handler). */
  onCancel?: (() => void) | undefined;
  /** Non-blocking feedback sink (e.g. oversize-attachment toast). */
  onToast?: ((message: string) => void) | undefined;
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

export interface UnifiedComposerHostState {
  runtime: ComposerHostRuntimeDefaults;
  view: ComposerHostViewModel;
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
    /* P76: show mainchain when mentions or targets exist so Agent/目标/任务 always readable. */
    mainchainStrip: hasMentions || hasExecutionTargets,
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
