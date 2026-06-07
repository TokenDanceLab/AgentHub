import { useMemo } from 'react';
import type { TFunction } from 'i18next';
import { type TopMenuDefinition } from '@/components/TopMenuBar';
import type { SectionId as SettingsSectionId } from '@/components/SettingsPage';

type EditCommand = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'delete' | 'selectAll';
type WindowCommand = 'minimize' | 'toggleMaximize' | 'close';

export interface UseTopMenuConfigDeps {
  desktopWindowAvailable: boolean;
  displayedRun: unknown;
  handleCopyDiagnostics: () => void;
  handleCreateThread: () => void;
  handleEditCommand: (cmd: EditCommand) => void;
  handleOpenHubAccount: () => void;
  handleOpenFolder: () => void;
  handleQuickChat: () => void;
  handleWindowCommand: (cmd: WindowCommand) => void;
  leftSidebarCollapsed: boolean;
  online: boolean;
  openSettings: (tab?: SettingsSectionId) => void;
  rightPanelOpen: boolean;
  setLeftSidebarCollapsed: (v: boolean) => void;
  setRightPanelOpen: (v: boolean) => void;
  setShortcutHelpOpen: (v: boolean) => void;
  setWorkspaceExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  t: TFunction;
  theme: string;
  toggleTheme: () => void;
  workspaceExpanded: boolean;
}

export function useTopMenuConfig(deps: UseTopMenuConfigDeps): TopMenuDefinition {
  const {
    desktopWindowAvailable,
    displayedRun,
    handleCopyDiagnostics,
    handleCreateThread,
    handleEditCommand,
    handleOpenHubAccount,
    handleOpenFolder,
    handleQuickChat,
    handleWindowCommand,
    leftSidebarCollapsed,
    online,
    openSettings,
    rightPanelOpen,
    setLeftSidebarCollapsed,
    setRightPanelOpen,
    setShortcutHelpOpen,
    setWorkspaceExpanded,
    t,
    theme,
    toggleTheme,
    workspaceExpanded,
  } = deps;

  return useMemo<TopMenuDefinition>(() => ({
    file: {
      label: t('menu.file'),
      items: [
        {
          id: 'close',
          label: t('window.close'),
          shortcut: 'Ctrl+W',
          ...(!desktopWindowAvailable ? { detail: t('menu.desktopOnly') } : {}),
          disabled: !desktopWindowAvailable,
          action: () => handleWindowCommand('close'),
        },
        {
          id: 'new-thread',
          label: t('menu.file.newThread'),
          shortcut: 'Ctrl+N',
          ...(!online ? { detail: t('menu.requiresEdge') } : {}),
          disabled: !online,
          action: handleCreateThread,
        },
        {
          id: 'quick-chat',
          label: t('menu.file.quickChat'),
          shortcut: 'Alt+Ctrl+N',
          ...(!online ? { detail: t('menu.requiresEdge') } : {}),
          disabled: !online,
          action: handleQuickChat,
        },
        {
          id: 'open-folder',
          label: t('menu.file.openFolder'),
          shortcut: 'Ctrl+O',
          ...(!desktopWindowAvailable ? { detail: t('menu.desktopOnly') } : {}),
          disabled: !desktopWindowAvailable,
          action: handleOpenFolder,
        },
        {
          id: 'settings',
          label: t('menu.file.settings'),
          shortcut: 'Ctrl+,',
          separatorBefore: true,
          action: () => openSettings('general'),
        },
        {
          id: 'account',
          label: t('menu.file.account'),
          action: handleOpenHubAccount,
        },
        {
          id: 'about',
          label: t('menu.help.about'),
          separatorBefore: true,
          action: () => openSettings('general'),
        },
      ],
    },
    edit: {
      label: t('menu.edit'),
      items: [
        {
          id: 'undo',
          label: t('menu.edit.undo'),
          shortcut: 'Ctrl+Z',
          action: () => handleEditCommand('undo'),
        },
        {
          id: 'redo',
          label: t('menu.edit.redo'),
          shortcut: 'Ctrl+Y',
          action: () => handleEditCommand('redo'),
        },
        {
          id: 'cut',
          label: t('menu.edit.cut'),
          shortcut: 'Ctrl+X',
          separatorBefore: true,
          action: () => handleEditCommand('cut'),
        },
        {
          id: 'copy',
          label: t('menu.edit.copy'),
          shortcut: 'Ctrl+C',
          action: () => handleEditCommand('copy'),
        },
        {
          id: 'paste',
          label: t('menu.edit.paste'),
          shortcut: 'Ctrl+V',
          action: () => handleEditCommand('paste'),
        },
        {
          id: 'delete',
          label: t('menu.edit.delete'),
          action: () => handleEditCommand('delete'),
        },
        {
          id: 'select-all',
          label: t('menu.edit.selectAll'),
          shortcut: 'Ctrl+A',
          separatorBefore: true,
          action: () => handleEditCommand('selectAll'),
        },
      ],
    },
    view: {
      label: t('menu.view'),
      items: [
        {
          id: 'toggle-sidebar',
          label: leftSidebarCollapsed ? t('menu.view.showSidebar') : t('menu.view.hideSidebar'),
          shortcut: 'Ctrl+B',
          action: () => setLeftSidebarCollapsed(!leftSidebarCollapsed),
        },
        {
          id: 'toggle-run-detail',
          label: rightPanelOpen ? t('menu.view.hideRunDetail') : t('menu.view.showRunDetail'),
          ...(!displayedRun ? { detail: t('menu.requiresRun') } : {}),
          shortcut: 'Ctrl+J',
          disabled: !displayedRun,
          action: () => setRightPanelOpen(!rightPanelOpen),
        },
        {
          id: 'toggle-workspace',
          label: workspaceExpanded ? t('menu.view.restoreWorkspace') : t('menu.view.expandWorkspace'),
          action: () => setWorkspaceExpanded((value) => !value),
        },
        {
          id: 'tasks',
          label: t('menu.view.tasks'),
          separatorBefore: true,
          action: () => openSettings('tasks'),
        },
        {
          id: 'team-runs',
          label: t('menu.view.teamRuns'),
          action: () => openSettings('agentScheduling'),
        },
        {
          id: 'theme',
          label: theme === 'dark' ? t('theme.light') : t('theme.dark'),
          separatorBefore: true,
          action: toggleTheme,
        },
      ],
    },
    window: {
      label: t('menu.window'),
      items: [
        {
          id: 'minimize',
          label: t('window.minimize'),
          ...(!desktopWindowAvailable ? { detail: t('menu.desktopOnly') } : {}),
          disabled: !desktopWindowAvailable,
          action: () => handleWindowCommand('minimize'),
        },
        {
          id: 'toggle-maximize',
          label: t('window.maximize'),
          ...(!desktopWindowAvailable ? { detail: t('menu.desktopOnly') } : {}),
          disabled: !desktopWindowAvailable,
          action: () => handleWindowCommand('toggleMaximize'),
        },
        {
          id: 'close',
          label: t('window.close'),
          ...(!desktopWindowAvailable ? { detail: t('menu.desktopOnly') } : {}),
          disabled: !desktopWindowAvailable,
          separatorBefore: true,
          danger: true,
          action: () => handleWindowCommand('close'),
        },
      ],
    },
    help: {
      label: t('menu.help'),
      items: [
        {
          id: 'shortcuts',
          label: t('menu.help.shortcuts'),
          shortcut: '?',
          action: () => setShortcutHelpOpen(true),
        },
        {
          id: 'diagnostics',
          label: t('menu.help.copyDiagnostics'),
          separatorBefore: true,
          action: handleCopyDiagnostics,
        },
        {
          id: 'desktop-settings',
          label: t('menu.help.desktopSettings'),
          action: () => openSettings('general'),
        },
        {
          id: 'about',
          label: t('menu.help.about'),
          action: () => openSettings('general'),
        },
      ],
    },
  }), [
    desktopWindowAvailable,
    displayedRun,
    handleCopyDiagnostics,
    handleCreateThread,
    handleEditCommand,
    handleOpenHubAccount,
    handleOpenFolder,
    handleQuickChat,
    handleWindowCommand,
    leftSidebarCollapsed,
    online,
    openSettings,
    rightPanelOpen,
    setLeftSidebarCollapsed,
    setRightPanelOpen,
    setShortcutHelpOpen,
    setWorkspaceExpanded,
    t,
    theme,
    toggleTheme,
    workspaceExpanded,
  ]);
}
