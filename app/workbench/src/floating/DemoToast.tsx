import React from 'react';
import styles from './Toast.module.css';

export interface DemoToastProps {
  message: string;
  visible: boolean;
}

export const DemoToast: React.FC<DemoToastProps> = ({ message, visible }) => {
  return (
    // A11y (#10): role=status + aria-live=polite turns the toast into a
    // polite status live region — message swaps are announced to screen
    // readers (role=status already implies polite + atomic per ARIA; the
    // explicit aria-live documents the intent).
    <div
      className={`${styles.toast}${visible ? ` ${styles.show}` : ''}`}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
};
