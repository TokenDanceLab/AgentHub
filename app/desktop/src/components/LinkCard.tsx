import { ExternalLink, Globe } from 'lucide-react';
import type { MessageBlock } from './ChatView.types';
import styles from './LinkCard.module.css';

interface Props {
  block: Extract<MessageBlock, { kind: 'link_card' }>;
}

export default function LinkCard({ block }: Props) {
  const displayTitle = block.title || block.url;
  const hostname = block.siteName ?? (() => {
    try {
      return new URL(block.url).hostname.replace(/^www\./, '');
    } catch {
      return undefined;
    }
  })();

  return (
    <a
      className={styles.card}
      href={block.url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="link-card"
    >
      <div className={styles.body}>
        <div className={styles.textContent}>
          <div className={styles.titleRow}>
            <span className={styles.title}>{displayTitle}</span>
            <ExternalLink size={12} className={styles.externalIcon} />
          </div>
          {block.description && (
            <p className={styles.description}>{block.description}</p>
          )}
          {hostname && (
            <div className={styles.sourceRow}>
              <Globe size={12} className={styles.sourceIcon} />
              <span className={styles.siteName}>{hostname}</span>
            </div>
          )}
        </div>
        {block.thumbnailUrl && (
          <div className={styles.thumbnail}>
            <img
              src={block.thumbnailUrl}
              alt=""
              className={styles.thumbnailImage}
              loading="lazy"
            />
          </div>
        )}
      </div>
    </a>
  );
}
