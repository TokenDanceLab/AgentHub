import styles from './ChatBubble.module.css';

export interface ChatBubbleSender {
  name: string;
  avatar?: string;
}

export interface ChatBubbleProps {
  sender: ChatBubbleSender;
  content: string;
  timestamp: string;
  isAgent?: boolean;
  className?: string;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

function getInitials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

export function ChatBubble({
  sender,
  content,
  timestamp,
  isAgent = false,
  className,
}: ChatBubbleProps) {
  return (
    <article className={cx(styles.row, isAgent ? styles.agent : styles.user, className)}>
      <div className={styles.avatar} aria-hidden="true">
        {sender.avatar ?? getInitials(sender.name)}
      </div>

      <div className={styles.stack}>
        <div className={styles.meta}>
          <strong>{sender.name}</strong>
          <span className={styles.time}>{timestamp}</span>
        </div>

        <div className={styles.bubble}>
          {content}
        </div>
      </div>
    </article>
  );
}
