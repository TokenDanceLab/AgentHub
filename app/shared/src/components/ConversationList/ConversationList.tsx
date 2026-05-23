import styles from './ConversationList.module.css';

export interface ConversationData {
  id: string;
  name: string;
  lastMessage: string;
  avatar?: string;
  unread?: number;
}

export interface ConversationListProps {
  conversations: ConversationData[];
  activeId?: string;
  onSelect: (id: string) => void;
  className?: string;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

function getInitials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

export function ConversationList({
  conversations,
  activeId,
  onSelect,
  className,
}: ConversationListProps) {
  if (conversations.length === 0) {
    return (
      <div className={cx(styles.empty, className)}>
        No conversations found.
      </div>
    );
  }

  return (
    <div className={cx(styles.list, className)}>
      {conversations.map((conv) => (
        <button
          key={conv.id}
          className={cx(styles.card, conv.id === activeId && styles.active)}
          onClick={() => onSelect(conv.id)}
          type="button"
        >
          <div className={styles.avatar} aria-hidden="true">
            {conv.avatar ?? getInitials(conv.name)}
          </div>

          <div className={styles.body}>
            <h3>{conv.name}</h3>
            <p>{conv.lastMessage}</p>
          </div>

          <div className={styles.meta}>
            {conv.unread != null && conv.unread > 0 && (
              <span className={styles.unread}>{conv.unread}</span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
