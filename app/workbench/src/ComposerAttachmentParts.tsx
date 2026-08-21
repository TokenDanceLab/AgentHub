import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComposerAttachment } from '@shared/composer';
import { CodePreviewCard } from '@shared/ui/CodePreviewCard';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import styles from './AgentHubWorkbench.module.css';
import {
  buildAttachmentChipViewModel,
  resolveAttachmentUploadProgress,
} from './ComposerPartsHelpers';
import { DesignFileIcon } from './designIcons';
import { isImageAttachment } from './unifiedComposerHelpers';
import type { AttachmentUploadState } from './unifiedComposerHelpers';

/* ═══════════════════════════════════════════════════════════════════════
   Composer attachment bar + chip — residual extract for Phase 30 #706.

   CSS remains on shared AgentHubWorkbench.module.css.
   exactOptionalPropertyTypes-safe spreads for uploadProgress.
   In-chip previews (fable UIUX gap #10): image object-URL thumbnail
   (30×30, revoked on unmount), registry file icon for media, and a
   CodePreviewCard (maxLines=3) for text/code files.
   ═══════════════════════════════════════════════════════════════════════ */

export function ComposerAttachmentBar({
  attachments,
  isSubmitting,
  uploadProgresses,
  onRemove,
}: {
  attachments: ComposerAttachment[];
  isSubmitting: boolean;
  uploadProgresses: Record<string, AttachmentUploadState> | undefined;
  onRemove: (attachmentId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <div className={styles.composerAttachmentBar} aria-label={t('aria.attachments')}>
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
  uploadProgress,
}: {
  attachment: ComposerAttachment;
  isSubmitting: boolean;
  onRemove: () => void;
  uploadProgress?: AttachmentUploadState;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const {
    isMedia,
    previewKind,
    sizeLabel,
    isUploading,
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
            <button
              aria-label={t('action.removeAttachment', { name: attachment.name })}
              className={styles.attachmentChipRemove}
              disabled={isSubmitting}
              onClick={onRemove}
              type="button"
            >
              &times;
            </button>
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
    <div
      className={styles.attachmentChip}
      {...(isUploading ? { 'data-uploading': 'true' } : {})}
      style={imageUrl ? { height: 34, maxWidth: 280, paddingLeft: 4 } : undefined}
    >
      {imageUrl ? (
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
      ) : previewKind === 'image' || isMedia ? (
        <span className={styles.attachmentChipThumb} aria-hidden="true">
          <DesignFileIcon name={attachment.name} type={attachment.mime} />
        </span>
      ) : null}
      <span className={styles.attachmentChipName}>
        {attachment.name}
      </span>
      {sizeLabel && (
        <span className={styles.attachmentChipSize}>{sizeLabel}</span>
      )}
      {isUploading ? (
        <span className={styles.attachmentUploadBar}>
          <span className={styles.attachmentUploadFill} style={{ width: `${uploadPercent}%` }} />
        </span>
      ) : (
        <button
          aria-label={t('action.removeAttachment', { name: attachment.name })}
          className={styles.attachmentChipRemove}
          disabled={isSubmitting}
          onClick={onRemove}
          type="button"
        >
          &times;
        </button>
      )}
    </div>
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
