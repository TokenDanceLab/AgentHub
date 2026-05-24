import { type ReactNode } from 'react';
import styles from './AppSidebar.module.css';

interface AppSidebarProps {
  width: number;
  isMobile: boolean;
  isOpen: boolean;
  children: ReactNode;
}

export default function AppSidebar({ width, isMobile, isOpen, children }: AppSidebarProps) {
  return (
    <div
      className={`${styles.sidebarWrapper} ${isOpen ? styles.sidebarOpen : ''}`}
      style={isMobile ? undefined : { width, flexShrink: 0 }}
    >
      {children}
    </div>
  );
}
