import React, { useState, useCallback } from 'react';
import type { AttachmentRef } from '../../composer';
import { formatComposerAttachmentSize } from '../../composer';
import { DesignNavIcon } from '../designIcons';
import styles from './AttachmentBlock.module.css';

interface AttachmentBlockProps {
  attachmentRef: AttachmentRef;
  contentType: 'image' | 'file';
}

export function AttachmentBlock({ attachmentRef, contentType }: AttachmentBlockProps): React.ReactElement {
  if (contentType === 'image') {
    return <ImageAttachmentBlock attachmentRef={attachmentRef} />;
  }
  return <FileAttachmentBlock attachmentRef={attachmentRef} />;
}

function ImageAttachmentBlock({ attachmentRef }: { attachmentRef: AttachmentRef }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const src = attachmentRef.url ?? `/client/attachments/${attachmentRef.id}`;

  const handleOpen = useCallback(() => setExpanded(true), []);
  const handleClose = useCallback(() => setExpanded(false), []);

  return (
    <div className={styles.imageWrap}>
      <button
        className={styles.imageThumb}
        onClick={handleOpen}
        type="button"
      >
        <img
          alt={attachmentRef.original_name ?? attachmentRef.name}
          className={styles.imageImg}
          loading="lazy"
          src={src}
        />
      </button>
      {expanded && (
        <div className={styles.lightbox} onClick={handleClose} role="dialog" aria-label="Image preview">
          <img
            alt={attachmentRef.original_name ?? attachmentRef.name}
            className={styles.lightboxImg}
            src={src}
          />
          <button
            aria-label="Close preview"
            className={styles.lightboxClose}
            onClick={handleClose}
            type="button"
          >
            <DesignNavIcon name="close" size={20} />
          </button>
        </div>
      )}
    </div>
  );
}

function FileAttachmentBlock({ attachmentRef }: { attachmentRef: AttachmentRef }): React.ReactElement {
  const downloadUrl = attachmentRef.url ?? `/client/attachments/${attachmentRef.id}`;
  const sizeLabel = formatComposerAttachmentSize(attachmentRef.size);

  return (
    <div className={styles.fileCard} data-card-surface>
      <span className={styles.fileIcon}>
        <DesignNavIcon name="fileText" size={17} />
      </span>
      <div className={styles.fileCopy}>
        <span className={styles.fileName}>
          {attachmentRef.original_name ?? attachmentRef.name}
        </span>
        {sizeLabel && (
          <span className={styles.fileSize}>{sizeLabel}</span>
        )}
      </div>
      <a
        className={styles.fileDownload}
        download={attachmentRef.original_name ?? attachmentRef.name}
        href={downloadUrl}
        rel="noopener noreferrer"
        target="_blank"
      >
        <DesignNavIcon name="download" size={15} />
      </a>
    </div>
  );
}
