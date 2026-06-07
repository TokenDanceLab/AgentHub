import React from 'react';
import styles from './AgentMessage.module.css';

interface AgentMessageProps {
  name: string;
  avatar?: string;
  avatarColor?: string;
  time?: string;
  /** Optional badge label shown in the header row (e.g. "运行中", "完成") */
  badgeLabel?: string;
  /** Badge variant determining color — matches demo badge-* classes */
  badgeVariant?: 'thinking' | 'success' | 'warning' | 'danger' | 'primary';
  children: React.ReactNode;
}

const badgeClassMap: Record<string, string> = {
  thinking: styles.badgeThinking ?? '',
  success: styles.badgeSuccess ?? '',
  warning: styles.badgeWarning ?? '',
  danger: styles.badgeDanger ?? '',
  primary: styles.badgePrimary ?? '',
};

export const AgentMessage: React.FC<AgentMessageProps> = ({
  name,
  avatar,
  avatarColor,
  time,
  badgeLabel,
  badgeVariant,
  children,
}) => {
  return (
    <div className={styles.msg}>
      <div className={styles.header}>
        {avatar && (
          <div
            className={styles.avatar}
            style={avatarColor ? { background: avatarColor } : undefined}
          >
            {avatar}
          </div>
        )}
        <span className={styles.name}>{name}</span>
        {badgeLabel && (
          <span className={`${styles.badge} ${badgeClassMap[badgeVariant ?? 'thinking'] ?? ''}`}>
            <span className={styles.badgeDot} />
            {badgeLabel}
          </span>
        )}
        {time && <span className={styles.time}>{time}</span>}
      </div>
      <div className={styles.bubble} data-card-surface>{children}</div>
    </div>
  );
};
