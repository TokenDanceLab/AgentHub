import { useEffect } from 'react';
import { isEditableShortcutTarget } from '@/utils/appUtils';

export interface UseShellShortcutsOptions {
  online: boolean;
  isMobile: boolean;
  workspaceExpanded: boolean;
  leftSidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  shortcutHelpOpen: boolean;
  displayedRun: unknown;
  handleCreateThread: () => Promise<void> | void;
  handleQuickChat: () => Promise<void> | void;
  handleOpenFolder: () => Promise<void> | void;
  handleWindowCommand: (command: string) => Promise<void> | void;
  openSettings: (section?: string) => void;
  setNavPanelOpen: (open: boolean) => void;
  setShortcutHelpOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  setLeftSidebarCollapsed: (collapsed: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
}

export default function useShellShortcuts({
  online,
  isMobile,
  workspaceExpanded,
  leftSidebarCollapsed,
  rightPanelOpen,
  shortcutHelpOpen,
  displayedRun,
  handleCreateThread,
  handleQuickChat,
  handleOpenFolder,
  handleWindowCommand,
  openSettings,
  setNavPanelOpen,
  setShortcutHelpOpen,
  setLeftSidebarCollapsed,
  setRightPanelOpen,
}: UseShellShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNavPanelOpen(false);
      }
      if (isEditableShortcutTarget(e.target)) return;

      const shellModifier = e.ctrlKey || e.metaKey;
      if (shortcutHelpOpen && !(e.key === '?' && !shellModifier)) return;
      if (e.key === '?' && !shellModifier) {
        e.preventDefault();
        setShortcutHelpOpen((v) => !v);
      }
      if (shellModifier && e.altKey && e.key.toLowerCase() === 'n' && online) {
        e.preventDefault();
        void handleQuickChat();
      } else if (shellModifier && e.key.toLowerCase() === 'n' && online) {
        e.preventDefault();
        void handleCreateThread();
      } else if (shellModifier && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void handleOpenFolder();
      } else if (shellModifier && e.key === ',') {
        e.preventDefault();
        openSettings('general');
      } else if (shellModifier && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        void handleWindowCommand('close');
      }
      if (shellModifier && e.key.toLowerCase() === 'b' && !workspaceExpanded && !isMobile) {
        e.preventDefault();
        setLeftSidebarCollapsed(!leftSidebarCollapsed);
      }
      if (shellModifier && e.key.toLowerCase() === 'j' && displayedRun && !workspaceExpanded && !isMobile) {
        e.preventDefault();
        setRightPanelOpen(!rightPanelOpen);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    displayedRun,
    handleCreateThread,
    handleOpenFolder,
    handleQuickChat,
    handleWindowCommand,
    isMobile,
    leftSidebarCollapsed,
    online,
    openSettings,
    rightPanelOpen,
    setLeftSidebarCollapsed,
    setRightPanelOpen,
    shortcutHelpOpen,
    workspaceExpanded,
  ]);
}
