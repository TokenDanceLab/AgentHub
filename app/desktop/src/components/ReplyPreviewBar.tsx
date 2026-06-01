import { Reply, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReplyTarget } from './ChatView.types';
import styles from './ReplyPreviewBar.module.css';

interface Props {
  replyTo: ReplyTarget;
  onCancel: () => void;
}

/**
 * ReplyPreviewBar renders above the chat input area, showing
 * which message is being replied to (WeChat/Feishu style).
 */
export default function ReplyPreviewBar({ replyTo, onCancel }: Props) {
  const { t } = useTranslation();

  return (
    <div className={styles.root} role="status" aria-label={t('chat.replyTo', { author: replyTo.author })}>
      <div className={styles.left}>
        <Reply size={14} className={styles.icon} />
        <div className={styles.info}>
          <span className={styles.label}>{t('chat.replyTo', { author: replyTo.author })}</span>
          <span className={styles.preview}>{replyTo.preview}</span>
        </div>
      </div>
      <button
        className={styles.cancelBtn}
        onClick={onCancel}
        title={t('chat.cancelReply')}
        aria-label={t('chat.cancelReply')}
        type="button"
      >
        <X size={14} />
      </button>
    </div>
  );
}
