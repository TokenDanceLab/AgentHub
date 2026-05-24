import { type ReactNode } from 'react';
import styles from './RightPanel.module.css';

interface RightPanelProps {
  width: number;
  isMobile: boolean;
  isOpen: boolean;
  children: ReactNode;
}

export default function RightPanel({ width, isMobile, isOpen, children }: RightPanelProps) {
  return (
    <div
      className={`${styles.rightPanelWrapper} ${isOpen ? styles.rightPanelOpen : ''}`}
      style={isMobile ? undefined : { width, flexShrink: 0 }}
    >
      {children}
    </div>
  );
}
