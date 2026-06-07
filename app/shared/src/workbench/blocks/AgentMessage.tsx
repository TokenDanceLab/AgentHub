import React from 'react';
import styles from './AgentMessage.module.css';

interface AgentMessageProps {
  name: string;
  avatar?: string | undefined;
  avatarColor?: string | undefined;
  time?: string | undefined;
  /** Optional badge label shown in the header row (e.g. "运行中", "完成") */
  badgeLabel?: string | undefined;
  /** Badge variant determining color — matches demo badge-* classes */
  badgeVariant?: 'thinking' | 'success' | 'warning' | 'danger' | 'primary' | undefined;
  avatarExpanded?: boolean | undefined;
  onAvatarClick?: ((name: string, anchor: HTMLElement) => void) | undefined;
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
  avatarExpanded = false,
  onAvatarClick,
  children,
}) => {
  function handleAvatarClick(event: React.MouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.stopPropagation();
    onAvatarClick?.(name, event.currentTarget);
  }

  function handleAvatarKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    onAvatarClick?.(name, event.currentTarget);
  }

  return (
    <div className={styles.msg}>
      <div className={styles.header}>
        {avatar && (
          <div
            aria-expanded={avatarExpanded}
            aria-haspopup="dialog"
            aria-label={`查看 ${name} 资料`}
            className={styles.avatar}
            data-agent-profile={name}
            onClick={handleAvatarClick}
            onKeyDown={handleAvatarKeyDown}
            role="button"
            style={avatarColor ? { background: avatarColor } : undefined}
            tabIndex={0}
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
      <div className={styles.bubble} data-agent-bubble>{children}</div>
    </div>
  );
};
