import React from 'react';
import { DesignNavIcon } from '../designIcons';
import styles from './PinnedAnnouncement.module.css';

interface PinnedAnnouncementProps {
  /** The bold title text shown before the colon in the first line */
  title: string;
  /** The body text shown after the title */
  content: string;
  /** Name of the person who pinned the announcement (defaults to "系统") */
  author?: string | undefined;
  /** Optional timestamp string */
  time?: string | undefined;
  /** Called when the open/external-link action button is clicked */
  onCopy?: (() => void) | undefined;
  /** Called when the dismiss (close) button is clicked */
  onDismiss?: (() => void) | undefined;
}

export const PinnedAnnouncement: React.FC<PinnedAnnouncementProps> = ({
  title,
  content,
  author = '系统',
  time,
  onCopy,
  onDismiss,
}) => {
  return (
    <div className={styles.card}>
      <div className={styles.mark}>
        <DesignNavIcon name="pin" />
      </div>

      <div className={styles.copy}>
        <div className={styles.line}>
          <strong>{title}:</strong>
          <span>{content}</span>
        </div>
        <div className={styles.meta}>
          {time ? (
            <>
              由 <a>{author}</a> 置顶 · {time}
            </>
          ) : (
            <>
              由 <a>{author}</a> 置顶
            </>
          )}
        </div>
      </div>

      {onCopy && (
        <button
          className={styles.action}
          type="button"
          title="打开置顶内容"
          aria-label="打开置顶内容"
          onClick={onCopy}
        >
          <DesignNavIcon name="link" />
        </button>
      )}

      {onDismiss && (
        <button
          className={styles.actionMuted}
          type="button"
          title="关闭置顶"
          aria-label="关闭置顶"
          onClick={onDismiss}
        >
          <DesignNavIcon name="close" />
        </button>
      )}
    </div>
  );
};
