import React from 'react';
import styles from './Toast.module.css';

export interface ToastProps {
  message: string;
  visible: boolean;
}

export const Toast: React.FC<ToastProps> = ({ message, visible }) => {
  return (
    <div className={`${styles.toast}${visible ? ` ${styles.show}` : ''}`}>
      {message}
    </div>
  );
};
