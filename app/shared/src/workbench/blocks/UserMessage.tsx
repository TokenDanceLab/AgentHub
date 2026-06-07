import React from 'react';
import styles from './UserMessage.module.css';

interface UserMessageProps {
  children: React.ReactNode;
  time?: string;
  avatarInitials?: string;
  hideAvatar?: boolean;
}

export const UserMessage: React.FC<UserMessageProps> = ({
  children,
  hideAvatar = false,
  time,
  avatarInitials = 'D',
}) => {
  return (
    <div className={styles.row}>
      <div className={styles.bubble} data-card-surface data-user-bubble>{children}</div>
      {hideAvatar ? (
        <div className={styles.avatarSpacer} aria-hidden="true" />
      ) : (
        <div className={styles.avatar} aria-hidden="true">
          {avatarInitials}
        </div>
      )}
    </div>
  );
};
