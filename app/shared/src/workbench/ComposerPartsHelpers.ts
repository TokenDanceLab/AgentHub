import type { ComposerAttachment, ComposerMention } from '../composer';
import { formatComposerAttachmentSize } from '../composer';
import {
  type AttachmentUploadState,
  type ComposerExecutionTarget,
  isAttachmentUploading,
  isImageAttachment,
} from './unifiedComposerHelpers';

/* ═══════════════════════════════════════════════════════════════════════
   Pure residual helpers for UnifiedComposerParts (#706).

   Label builders and attachment chip view-model only — no React hooks,
   no intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export function formatReplyToLabel(replyTo: {
  author: string;
  preview: string;
}): string {
  return `回复至 ${replyTo.author}: ${replyTo.preview}`;
}

export function formatMentionChipLabel(mention: ComposerMention): string {
  return `@${mention.label}`;
}

export function formatMainchainAgentLabel(selectedAgentLabel: string): string {
  return `Agent ${selectedAgentLabel}`;
}

export function formatMainchainTargetLabel(
  selectedTargetLabel: string | undefined,
): string {
  return `Target ${selectedTargetLabel ?? 'missing'}`;
}

export function formatMainchainTaskLabel(
  mainchainTask: 'ready' | 'draft required',
): string {
  return `Task ${mainchainTask}`;
}

export function mainchainDataState(
  selected: boolean,
): 'selected' | 'missing' {
  return selected ? 'selected' : 'missing';
}

export function agentPickerPlaceholder(
  availableCount: number,
): string {
  return availableCount > 0 ? 'Mention agent' : 'All agents mentioned';
}

export function formatAgentOptionLabel(agent: ComposerMention): string {
  return agent.runtimeId ? `${agent.label} (${agent.runtimeId})` : agent.label;
}

export function targetPickerPlaceholder(
  availableCount: number,
): string {
  return availableCount > 0 ? 'Select target' : 'No online target';
}

export interface ComposerAttachmentChipViewModel {
  isImage: boolean;
  sizeLabel: string | undefined;
  isUploading: boolean;
  uploadPercent: number;
  thumbPreview: string | undefined;
}

export function buildAttachmentChipViewModel(params: {
  attachment: ComposerAttachment;
  uploadProgress: AttachmentUploadState | undefined;
}): ComposerAttachmentChipViewModel {
  const { attachment, uploadProgress } = params;
  const isImage = isImageAttachment(attachment);
  const sizeLabel = attachment.size
    ? formatComposerAttachmentSize(attachment.size)
    : undefined;
  const isUploading = isAttachmentUploading(uploadProgress, attachment);
  const uploadPercent = uploadProgress?.percent ?? 0;
  const thumbPreview =
    isImage && attachment.contentPreview
      ? attachment.contentPreview.slice(0, 2)
      : undefined;

  return {
    isImage,
    sizeLabel,
    isUploading,
    uploadPercent,
    thumbPreview,
  };
}

export function resolveAttachmentUploadProgress(
  uploadProgresses: Record<string, AttachmentUploadState> | undefined,
  attachmentId: string,
): AttachmentUploadState | undefined {
  return uploadProgresses?.[attachmentId];
}

export type { ComposerExecutionTarget, AttachmentUploadState };
