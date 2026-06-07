import React from 'react';
import styles from './UserMessage.module.css';

interface UserMessageProps {
  children: React.ReactNode;
  time?: string;
  avatarInitials?: string;
}

export const UserMessage: React.FC<UserMessageProps> = ({
  children,
  time,
  avatarInitials = 'D',
}) => {
  return (
    <div className={styles.row}>
      <div className={styles.bubble} data-card-surface data-user-bubble>{children}</div>
      <div className={styles.avatar} aria-hidden="true">
        {avatarInitials}
      </div>
    </div>
  );
};
