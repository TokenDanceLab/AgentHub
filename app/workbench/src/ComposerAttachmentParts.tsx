import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComposerAttachment } from '@shared/composer';
import { CodePreviewCard } from '@shared/ui/CodePreviewCard';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import {
  Attachment,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from '@shared/shadcn/ui/attachment';
import { Button } from '@shared/shadcn/ui/button';
import { cn } from '@shared/lib/utils';
import {
  buildAttachmentChipViewModel,
  resolveAttachmentUploadProgress,
} from './ComposerPartsHelpers';
import { DesignFileIcon, DesignNavIcon } from './designIcons';
import { isImageAttachment } from './unifiedComposerHelpers';
import type { AttachmentUploadState } from './unifiedComposerHelpers';

/* ═══════════════════════════════════════════════════════════════════════
   Composer attachment bar and chip (#706).

   exactOptionalPropertyTypes-safe spreads for uploadProgress.
   In-chip previews: image object-URL thumbnail
   (30×30, revoked on unmount), registry file icon for media, and a
   CodePreviewCard (maxLines=3) for text/code files.
   ═══════════════════════════════════════════════════════════════════════ */

export function ComposerAttachmentBar({
  attachments,
  isSubmitting,
  uploadProgresses,
  onRemove,
  onRetryUpload,
}: {
  attachments: ComposerAttachment[];
  isSubmitting: boolean;
  uploadProgresses: Record<string, AttachmentUploadState> | undefined;
  onRemove: (attachmentId: string) => void;
  onRetryUpload?: ((attachmentId: string) => void) | undefined;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <div
      aria-label={t('aria.attachments')}
      className="flex w-full flex-wrap items-stretch gap-2"
    >
      {attachments.map((attachment) => {
        const progress = resolveAttachmentUploadProgress(
          uploadProgresses,
          attachment.id,
        );
        return (
          <ComposerAttachmentChip
            attachment={attachment}
            isSubmitting={isSubmitting}
            key={attachment.id}
            onRemove={() => onRemove(attachment.id)}
            {...(onRetryUpload ? { onRetryUpload: () => onRetryUpload(attachment.id) } : {})}
            {...(progress ? { uploadProgress: progress } : {})}
          />
        );
      })}
    </div>
  );
}

export function ComposerAttachmentChip({
  attachment,
  isSubmitting,
  onRemove,
  onRetryUpload,
  uploadProgress,
}: {
  attachment: ComposerAttachment;
  isSubmitting: boolean;
  onRemove: () => void;
  onRetryUpload?: (() => void) | undefined;
  uploadProgress?: AttachmentUploadState;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const {
    isMedia,
    previewKind,
    sizeLabel,
    isUploading,
    isUploadInFlight,
    isUploadFailed,
    uploadPercent,
  } = buildAttachmentChipViewModel({
    attachment,
    uploadProgress,
  });
  const imageUrl = useAttachmentImageUrl(attachment);

  if (previewKind === 'code' && !isUploading) {
    return (
      <div style={{ minWidth: 0, width: 'min(100%, 340px)' }}>
        <CodePreviewCard
          actions={
            <Button
              aria-label={t('action.removeAttachment', { name: attachment.name })}
              className="text-muted-foreground"
              disabled={isSubmitting}
              size="icon-xs"
              onClick={onRemove}
              type="button"
              variant="ghost"
            >
              <DesignNavIcon name="close" size={12} />
            </Button>
          }
          code={attachment.contentPreview ?? ''}
          maxLines={3}
          meta={sizeLabel}
          title={attachment.name}
        />
      </div>
    );
  }

  return (
    <Attachment
      className="max-w-[20rem] rounded-lg border-line-strong bg-muted shadow-none"
      size="xs"
      state={isUploadFailed ? 'error' : isUploadInFlight ? 'uploading' : 'done'}
      {...(isUploadInFlight ? { 'data-uploading': 'true' } : {})}
      {...(isUploadFailed ? { 'data-upload-failed': 'true' } : {})}
      style={imageUrl ? { height: 38, maxWidth: 280, paddingLeft: 4 } : undefined}
    >
      {imageUrl ? (
        <AttachmentMedia variant="image">
          <img
            alt=""
            aria-hidden="true"
            src={imageUrl}
            style={{
              width: 30,
              height: 30,
              borderRadius: 6,
              objectFit: 'cover',
              flexShrink: 0,
            }}
          />
        </AttachmentMedia>
      ) : previewKind === 'image' || isMedia ? (
        <AttachmentMedia aria-hidden="true" className="size-7 rounded-md">
          <DesignFileIcon name={attachment.name} type={attachment.mime} />
        </AttachmentMedia>
      ) : null}
      <AttachmentContent className="py-0.5">
        <AttachmentTitle>{attachment.name}</AttachmentTitle>
        <AttachmentDescription
          {...(isUploadFailed ? { role: 'status' } : {})}
          className={cn(isUploadFailed && 'font-medium text-destructive')}
        >
          {isUploadFailed
            ? t('composer.attachmentUploadFailed', { defaultValue: 'Upload failed' })
            : isUploadInFlight
              ? `${uploadPercent}%`
              : sizeLabel}
        </AttachmentDescription>
      </AttachmentContent>
      {isUploadInFlight ? (
        <span className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden rounded-b-xl bg-muted">
          <span
            className="block h-full bg-primary transition-[width] duration-150"
            style={{ width: `${uploadPercent}%` }}
          />
        </span>
      ) : (
        <AttachmentActions>
          <Button
            aria-label={t('action.removeAttachment', { name: attachment.name })}
            className="text-muted-foreground"
            disabled={isSubmitting}
            size="icon-xs"
            onClick={onRemove}
            type="button"
            variant="ghost"
          >
            <DesignNavIcon name="close" size={12} />
          </Button>
        </AttachmentActions>
      )}
      {isUploadFailed && onRetryUpload && (
        <Button
          aria-label={t('action.retryAttachmentUpload', { name: attachment.name, defaultValue: `重试上传 ${attachment.name}` })}
          className="rounded-md"
          size="xs"
          onClick={onRetryUpload}
          type="button"
          variant="outline"
        >
          <DesignNavIcon name="refresh" size={12} />
          {t('action.retryAttachmentUpload', { name: attachment.name, defaultValue: '重试' })}
        </Button>
      )}
    </Attachment>
  );
}

/**
 * Object-URL for the image thumbnail. URL.createObjectURL is a side effect:
 * the URL is created per image attachment and revoked on unmount / change.
 */
function useAttachmentImageUrl(attachment: ComposerAttachment): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!isImageAttachment(attachment) || !attachment.file) {
      setUrl(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(attachment.file);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [attachment]);
  return url;
}
