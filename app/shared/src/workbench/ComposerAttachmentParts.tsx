import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ComposerAttachment } from '../composer';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';
import styles from './AgentHubWorkbench.module.css';
import {
  buildAttachmentChipViewModel,
  resolveAttachmentUploadProgress,
} from './ComposerPartsHelpers';
import type { AttachmentUploadState } from './unifiedComposerHelpers';

/* ═══════════════════════════════════════════════════════════════════════
   Composer attachment bar + chip — residual extract for Phase 30 #706.

   CSS remains on shared AgentHubWorkbench.module.css.
   exactOptionalPropertyTypes-safe spreads for uploadProgress.
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
    sizeLabel,
    isUploading,
    uploadPercent,
    thumbPreview,
  } = buildAttachmentChipViewModel({
    attachment,
    uploadProgress,
  });

  return (
    <div className={styles.attachmentChip} {...(isUploading ? { 'data-uploading': 'true' } : {})}>
      {thumbPreview && (
        <span className={styles.attachmentChipThumb} aria-hidden="true">
          {thumbPreview}
        </span>
      )}
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
