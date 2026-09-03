import type { ComposerAttachment, ComposerMention, ComposerState } from '@shared/composer';
import { canSubmitComposer, formatComposerAttachmentSize } from '@shared/composer';
import type { ComposerSubmitBehavior } from './workbenchPreferences';

/* ═══════════════════════════════════════════════════════════════════════
   unifiedComposerHelpers — pure residual slices from UnifiedComposer (#638).

   Status/label builders, mention filtering, and submit-key planners.
   No React hooks / no intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export interface AttachmentUploadState {
  percent: number;
  phase: 'hashing' | 'uploading' | 'done' | 'failed';
}

/** True while the upload is in flight (chip shows the progress bar). */
export function isAttachmentUploadInFlight(uploadProgress: AttachmentUploadState | undefined): boolean {
  return Boolean(
    uploadProgress &&
      (uploadProgress.phase === 'hashing' || uploadProgress.phase === 'uploading'),
  );
}

/** True when the upload failed and the chip should offer retry. */
export function isAttachmentUploadFailed(uploadProgress: AttachmentUploadState | undefined): boolean {
  return uploadProgress?.phase === 'failed';
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

/** Max attachable file size — 50 MB, mirrors the codeg composer limit. */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/** Attachment size-limit reject message, or null when the file is within limits. */
export function validateAttachment(file: File): string | null {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `「${file.name}」超出附件大小限制（${formatComposerAttachmentSize(
      MAX_ATTACHMENT_BYTES,
    )}），无法附加`;
  }
  return null;
}

/** Split a file batch into size-valid and rejected halves. */
export function partitionAttachmentsBySize(files: File[]): {
  accepted: File[];
  rejected: File[];
} {
  const accepted: File[] = [];
  const rejected: File[] = [];
  for (const file of files) {
    if (validateAttachment(file)) rejected.push(file);
    else accepted.push(file);
  }
  return { accepted, rejected };
}

/** Toast text for rejected files, or undefined when nothing was rejected. */
export function buildAttachmentOversizeToast(rejected: File[]): string | undefined {
  if (rejected.length === 0) return undefined;
  const first = rejected[0];
  if (rejected.length === 1) return (first ? validateAttachment(first) : undefined) ?? undefined;
  return `有 ${rejected.length} 个附件超出大小限制（${formatComposerAttachmentSize(
    MAX_ATTACHMENT_BYTES,
  )}）`;
}

export function isTargetSelectionRequired(
  executionTargets: ComposerExecutionTarget[] | undefined,
  mentions: ComposerMention[],
): boolean {
  return Boolean(executionTargets) && mentions.length > 0;
}

function isExecutionTargetSelected(
  targetSelectionRequired: boolean,
  executionTargetId: string,
): boolean {
  return !targetSelectionRequired || executionTargetId.trim().length > 0;
}

function resolveSelectedTargetLabel(
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
    return '请先选择执行目标再开始。';
  }
  return '当前无在线执行目标。';
}

export function filterAvailableMentionOptions(
  mentionableAgents: ComposerMention[],
  selectedMentions: ComposerMention[],
): ComposerMention[] {
  const selectedMentionIds = new Set(selectedMentions.map((mention) => mention.id));
  return mentionableAgents.filter((agent) => !selectedMentionIds.has(agent.id));
}

/** Map internal dataMode codes to Chinese product labels (P76). */
export function formatComposerDataModeLabel(dataMode: string): string {
  switch (dataMode) {
    case 'approved-real':
      return '真实数据';
    case 'observed':
      return '观测数据';
    case 'fixture':
      return '示例数据';
    case 'mock':
      return '模拟数据';
    case 'auto':
      return '自动';
    default:
      return dataMode;
  }
}

/** Map target readiness codes to Chinese product labels (P76). */
export function formatComposerTargetStateLabel(targetState: string): string {
  switch (targetState) {
    case 'ready':
      return '就绪';
    case 'offline':
      return '离线';
    case 'busy':
      return '忙碌';
    case 'error':
      return '异常';
    default:
      return targetState;
  }
}

export function buildComposerStatusItems(params: {
  status: ComposerStatusHints | undefined;
  targetStatus: string | undefined;
}): string[] {
  const { status, targetStatus } = params;
  return [
    status?.dataMode
      ? `数据：${formatComposerDataModeLabel(status.dataMode)}`
      : undefined,
    status?.targetState
      ? `目标：${formatComposerTargetStateLabel(status.targetState)}${
          status.targetLabel ? ` · ${status.targetLabel}` : ''
        }`
      : undefined,
    status?.replayLabel,
    targetStatus,
  ].filter((item): item is string => Boolean(item));
}

function isComposerSubmitDisabled(params: {
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
  isRunning: boolean;
}): boolean {
  const {
    currentText,
    attachments,
    isSubmitting,
    targetSelectionRequired,
    executionTargetId,
    isRunning,
  } = params;
  const hasText = currentText.trim().length > 0;
  const canSubmit = hasText || attachments.length > 0;
  const targetOk = !targetSelectionRequired || executionTargetId.trim().length > 0;
  return canSubmit && !isSubmitting && targetOk && !isRunning;
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
