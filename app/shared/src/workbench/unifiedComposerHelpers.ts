import type { ComposerAttachment, ComposerMention, ComposerState } from '../composer';
import { canSubmitComposer } from '../composer';
import type { ComposerSubmitBehavior } from './workbenchPreferences';

/* ═══════════════════════════════════════════════════════════════════════
   unifiedComposerHelpers — pure residual slices from UnifiedComposer (#638).

   Status/label builders, mention filtering, and submit-key planners.
   No React hooks / no intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export interface AttachmentUploadState {
  percent: number;
  phase: 'hashing' | 'uploading' | 'done';
}

export interface ComposerExecutionTarget {
  id: string;
  label: string;
}

export interface ComposerStatusHints {
  dataMode?: string | undefined;
  replayLabel?: string | undefined;
  targetLabel?: string | undefined;
  targetState?: string | undefined;
}

export const COMPOSER_FILE_ACCEPT =
  'image/*,.pdf,.txt,.md,.json,.csv,.yaml,.yml,.toml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.go,.rs,.java,.c,.cpp,.h,.hpp,.log,.zip,.tar,.gz';

export function isTargetSelectionRequired(
  executionTargets: ComposerExecutionTarget[] | undefined,
  mentions: ComposerMention[],
): boolean {
  return Boolean(executionTargets) && mentions.length > 0;
}

export function isExecutionTargetSelected(
  targetSelectionRequired: boolean,
  executionTargetId: string,
): boolean {
  return !targetSelectionRequired || executionTargetId.trim().length > 0;
}

export function resolveSelectedTargetLabel(
  executionTargets: ComposerExecutionTarget[] | undefined,
  executionTargetId: string,
): string | undefined {
  return executionTargets?.find((target) => target.id === executionTargetId)?.label;
}

export function formatSelectedAgentLabel(mentions: ComposerMention[]): string {
  return mentions.map((mention) => `@${mention.label}`).join(', ');
}

export function resolveTargetStatus(params: {
  targetSelectionRequired: boolean;
  executionTargetId: string;
  executionTargets: ComposerExecutionTarget[] | undefined;
}): string | undefined {
  const { targetSelectionRequired, executionTargetId, executionTargets } = params;
  if (!targetSelectionRequired || executionTargetId) return undefined;
  if (executionTargets && executionTargets.length > 0) {
    return 'Select a Desktop/Edge target before starting.';
  }
  return 'No online Desktop/Edge target is available.';
}

export function filterAvailableMentionOptions(
  mentionableAgents: ComposerMention[],
  selectedMentions: ComposerMention[],
): ComposerMention[] {
  const selectedMentionIds = new Set(selectedMentions.map((mention) => mention.id));
  return mentionableAgents.filter((agent) => !selectedMentionIds.has(agent.id));
}

export function buildComposerStatusItems(params: {
  status: ComposerStatusHints | undefined;
  targetStatus: string | undefined;
}): string[] {
  const { status, targetStatus } = params;
  return [
    status?.dataMode ? `Data: ${status.dataMode}` : undefined,
    status?.targetState
      ? `Target: ${status.targetState}${status.targetLabel ? ` - ${status.targetLabel}` : ''}`
      : undefined,
    status?.replayLabel,
    targetStatus,
  ].filter((item): item is string => Boolean(item));
}

export function isComposerSubmitDisabled(params: {
  composer: ComposerState;
  isSubmitting: boolean;
  targetSelected: boolean;
}): boolean {
  const { composer, isSubmitting, targetSelected } = params;
  return !canSubmitComposer(composer) || isSubmitting || !targetSelected;
}

export function mainchainTaskState(params: {
  composer: ComposerState;
  targetSelected: boolean;
}): 'ready' | 'draft required' {
  const { composer, targetSelected } = params;
  return canSubmitComposer(composer) && targetSelected ? 'ready' : 'draft required';
}

export function isExecutionTargetStillValid(
  executionTargets: ComposerExecutionTarget[] | undefined,
  executionTargetId: string,
): boolean {
  if (!executionTargets || !executionTargetId) return true;
  return executionTargets.some((target) => target.id === executionTargetId);
}

export function shouldSubmitComposerKey(params: {
  key: string;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  submitBehavior: ComposerSubmitBehavior;
}): { shouldSubmit: boolean; insertNewline: boolean } {
  const {
    key,
    altKey,
    shiftKey,
    ctrlKey,
    metaKey,
    isComposing,
    submitBehavior,
  } = params;

  if (key !== 'Enter' || altKey || shiftKey || isComposing) {
    return { shouldSubmit: false, insertNewline: false };
  }

  const modifierPressed = ctrlKey || metaKey;
  const shouldSubmit = submitBehavior === 'enter-send' ? !modifierPressed : modifierPressed;
  if (!shouldSubmit && submitBehavior === 'enter-send' && modifierPressed) {
    return { shouldSubmit: false, insertNewline: true };
  }
  return { shouldSubmit, insertNewline: false };
}

export function buildTextWithNewline(params: {
  text: string;
  selectionStart: number | null;
  selectionEnd: number | null;
}): { nextText: string; caret: number } {
  const { text, selectionStart, selectionEnd } = params;
  const start = selectionStart ?? text.length;
  const end = selectionEnd ?? start;
  return {
    nextText: `${text.slice(0, start)}\n${text.slice(end)}`,
    caret: start + 1,
  };
}

export function canSubmitFromKeyDown(params: {
  currentText: string;
  attachments: ComposerAttachment[];
  isSubmitting: boolean;
  targetSelectionRequired: boolean;
  executionTargetId: string;
}): boolean {
  const {
    currentText,
    attachments,
    isSubmitting,
    targetSelectionRequired,
    executionTargetId,
  } = params;
  const hasText = currentText.trim().length > 0;
  const canSubmit = hasText || attachments.length > 0;
  const targetOk = !targetSelectionRequired || executionTargetId.trim().length > 0;
  return canSubmit && !isSubmitting && targetOk;
}

export function findMentionById(
  mentionableAgents: ComposerMention[],
  agentId: string,
): ComposerMention | undefined {
  return mentionableAgents.find((agent) => agent.id === agentId);
}

export function formatQuotePreview(quote: { author?: string | null; text: string }): string {
  const authorPrefix = quote.author ? `${quote.author}: ` : '';
  return `${authorPrefix}${quote.text.slice(0, 60)}`;
}

export function isImageAttachment(attachment: ComposerAttachment): boolean {
  return Boolean(attachment.mime?.startsWith('image/'));
}

export function isAttachmentUploading(
  uploadProgress: AttachmentUploadState | undefined,
  attachment: ComposerAttachment,
): boolean {
  return Boolean(uploadProgress && uploadProgress.phase !== 'done' && !attachment.attachmentRef);
}

export interface UnifiedComposerDerivedState {
  isSubmitting: boolean;
  targetSelectionRequired: boolean;
  targetSelected: boolean;
  submitDisabled: boolean;
  selectedTargetLabel: string | undefined;
  selectedAgentLabel: string;
  targetStatus: string | undefined;
  availableMentionOptions: ComposerMention[];
  statusItems: string[];
  mainchainTask: 'ready' | 'draft required';
}

export function deriveUnifiedComposerState(params: {
  composer: ComposerState;
  executionTargets: ComposerExecutionTarget[] | undefined;
  executionTargetId: string;
  mentionableAgents: ComposerMention[];
  status: ComposerStatusHints | undefined;
}): UnifiedComposerDerivedState {
  const {
    composer,
    executionTargets,
    executionTargetId,
    mentionableAgents,
    status,
  } = params;

  const isSubmitting = composer.submitState === 'submitting';
  const targetSelectionRequired = isTargetSelectionRequired(executionTargets, composer.mentions);
  const targetSelected = isExecutionTargetSelected(targetSelectionRequired, executionTargetId);
  const targetStatus = resolveTargetStatus({
    targetSelectionRequired,
    executionTargetId,
    executionTargets,
  });

  return {
    isSubmitting,
    targetSelectionRequired,
    targetSelected,
    submitDisabled: isComposerSubmitDisabled({
      composer,
      isSubmitting,
      targetSelected,
    }),
    selectedTargetLabel: resolveSelectedTargetLabel(executionTargets, executionTargetId),
    selectedAgentLabel: formatSelectedAgentLabel(composer.mentions),
    targetStatus,
    availableMentionOptions: filterAvailableMentionOptions(mentionableAgents, composer.mentions),
    statusItems: buildComposerStatusItems({ status, targetStatus }),
    mainchainTask: mainchainTaskState({ composer, targetSelected }),
  };
}
