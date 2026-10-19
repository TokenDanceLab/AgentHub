import type { TFunction } from 'i18next';
import type { ComposerAttachment, ComposerMention } from '@shared/composer';
import { formatComposerAttachmentSize } from '@shared/composer';
import {
  type AttachmentUploadState,
  type ComposerExecutionTarget,
  isAttachmentUploadFailed,
  isAttachmentUploadInFlight,
  isAttachmentUploading,
  isImageAttachment,
} from './unifiedComposerHelpers';

export function formatReplyToLabel(
  replyTo: {
    author: string;
    preview: string;
  },
  t?: TFunction,
): string {
  return t?.('composer.replyTo', { author: replyTo.author, preview: replyTo.preview })
    ?? `回复至 ${replyTo.author}: ${replyTo.preview}`;
}

export function formatMentionChipLabel(mention: ComposerMention): string {
  return `@${mention.label}`;
}

export function agentPickerPlaceholder(
  availableCount: number,
  t?: TFunction,
): string {
  return availableCount > 0
    ? (t?.('composer.agentPicker.available') ?? '选择 Agent')
    : (t?.('composer.agentPicker.exhausted') ?? '已全部提及');
}

export function formatAgentOptionLabel(agent: ComposerMention): string {
  return agent.runtimeId ? `${agent.label} (${agent.runtimeId})` : agent.label;
}

export function targetPickerPlaceholder(
  availableCount: number,
  t?: TFunction,
): string {
  return availableCount > 0
    ? (t?.('composer.targetPicker.available') ?? '选择执行目标')
    : (t?.('composer.targetPicker.exhausted') ?? '无在线目标');
}

export interface ComposerAttachmentChipViewModel {
  isImage: boolean;
  isMedia: boolean;
  previewKind: ComposerAttachmentPreviewKind | undefined;
  sizeLabel: string | undefined;
  isUploading: boolean;
  isUploadInFlight: boolean;
  isUploadFailed: boolean;
  uploadPercent: number;
}

const MEDIA_FILE_NAME_PATTERN = /\.(mp4|mov|webm|mkv|avi|mp3|wav|flac|m4a|ogg|aac|oga|opus)$/i;

/** video/audio attachment — MIME prefix or media extension. */
export function isMediaAttachment(attachment: ComposerAttachment): boolean {
  const mime = attachment.mime ?? '';
  if (mime.startsWith('video/') || mime.startsWith('audio/')) return true;
  return MEDIA_FILE_NAME_PATTERN.test(attachment.name);
}

export type ComposerAttachmentPreviewKind = 'image' | 'media' | 'code';

/** Which in-chip preview applies to this attachment, if any. */
export function resolveAttachmentPreviewKind(
  attachment: ComposerAttachment,
): ComposerAttachmentPreviewKind | undefined {
  if (isImageAttachment(attachment)) return 'image';
  if (isMediaAttachment(attachment)) return 'media';
  if (attachment.contentPreview) return 'code';
  return undefined;
}

export function buildAttachmentChipViewModel(params: {
  attachment: ComposerAttachment;
  uploadProgress: AttachmentUploadState | undefined;
}): ComposerAttachmentChipViewModel {
  const { attachment, uploadProgress } = params;
  const previewKind = resolveAttachmentPreviewKind(attachment);
  const sizeLabel = attachment.size
    ? formatComposerAttachmentSize(attachment.size)
    : undefined;
  const isUploading = isAttachmentUploading(uploadProgress, attachment);
  const isUploadInFlight = isAttachmentUploadInFlight(uploadProgress);
  const isUploadFailed = isAttachmentUploadFailed(uploadProgress);
  const uploadPercent = uploadProgress?.percent ?? 0;

  return {
    isImage: previewKind === 'image',
    isMedia: previewKind === 'media',
    previewKind,
    sizeLabel,
    isUploading,
    isUploadInFlight,
    isUploadFailed,
    uploadPercent,
  };
}

export function resolveAttachmentUploadProgress(
  uploadProgresses: Record<string, AttachmentUploadState> | undefined,
  attachmentId: string,
): AttachmentUploadState | undefined {
  return uploadProgresses?.[attachmentId];
}

export type { ComposerExecutionTarget, AttachmentUploadState };
