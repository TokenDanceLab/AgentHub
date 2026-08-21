import type { ComposerAttachment, ComposerMention } from '@shared/composer';
import { formatComposerAttachmentSize } from '@shared/composer';
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
  const label = selectedAgentLabel.trim();
  if (!label) return 'Agent 未选';
  return label.startsWith('@') ? `Agent ${label}` : `Agent @${label}`;
}

export function formatMainchainTargetLabel(
  selectedTargetLabel: string | undefined,
): string {
  return selectedTargetLabel ? `目标 ${selectedTargetLabel}` : '目标未选';
}

export function formatMainchainTaskLabel(
  mainchainTask: 'ready' | 'draft required',
): string {
  return mainchainTask === 'ready' ? '任务就绪' : '需填写内容';
}

export function mainchainDataState(
  selected: boolean,
): 'selected' | 'missing' {
  return selected ? 'selected' : 'missing';
}

export function agentPickerPlaceholder(
  availableCount: number,
): string {
  return availableCount > 0 ? '选择 Agent' : '已全部提及';
}

export function formatAgentOptionLabel(agent: ComposerMention): string {
  return agent.runtimeId ? `${agent.label} (${agent.runtimeId})` : agent.label;
}

export function targetPickerPlaceholder(
  availableCount: number,
): string {
  return availableCount > 0 ? '选择执行目标' : '无在线目标';
}

export interface ComposerAttachmentChipViewModel {
  isImage: boolean;
  isMedia: boolean;
  previewKind: ComposerAttachmentPreviewKind | undefined;
  sizeLabel: string | undefined;
  isUploading: boolean;
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
  const uploadPercent = uploadProgress?.percent ?? 0;

  return {
    isImage: previewKind === 'image',
    isMedia: previewKind === 'media',
    previewKind,
    sizeLabel,
    isUploading,
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
