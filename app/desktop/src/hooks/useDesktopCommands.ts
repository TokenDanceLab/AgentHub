import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriRuntime } from '@/utils/appUtils';
import { useToastStore } from '@/stores/toastStore';

export type EditCommand = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'delete' | 'selectAll';
export type WindowCommand = 'minimize' | 'toggleMaximize' | 'close';

export interface UseDesktopCommandsDeps {
  online: boolean;
  isConnected: boolean;
  wsLatency: number | null;
  healthVersion?: string;
  selectedAgent?: { name: string; id: string } | null;
  selectedThread?: { threadId: string; title?: string } | null;
  displayedRun?: { runId: string; status: string } | null;
}

export interface UseDesktopCommandsReturn {
  handleWindowCommand: (command: WindowCommand) => Promise<void>;
  handleEditCommand: (command: EditCommand) => void;
  handleCopyDiagnostics: () => Promise<void>;
}

export function useDesktopCommands(deps: UseDesktopCommandsDeps): UseDesktopCommandsReturn {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const {
    online,
    isConnected,
    wsLatency,
    healthVersion,
    selectedAgent,
    selectedThread,
    displayedRun,
  } = deps;
  const desktopWindowAvailable = isTauriRuntime();

  const handleWindowCommand = useCallback(async (command: WindowCommand) => {
    if (!desktopWindowAvailable) {
      addToast({ type: 'info', message: t('menu.nativeWindowUnavailable') });
      return;
    }
    try {
      const windowHandle = getCurrentWindow();
      if (command === 'minimize') {
        await windowHandle.minimize();
        return;
      }
      if (command === 'close') {
        await windowHandle.close();
        return;
      }
      (await windowHandle.isMaximized()) ? await windowHandle.unmaximize() : await windowHandle.maximize();
    } catch {
      addToast({ type: 'error', message: t('toast.error') });
    }
  }, [addToast, desktopWindowAvailable, t]);

  const handleEditCommand = useCallback((command: EditCommand) => {
    const active = document.activeElement;
    if (command === 'selectAll' && active instanceof HTMLInputElement) {
      active.select();
      return;
    }
    if (command === 'selectAll' && active instanceof HTMLTextAreaElement) {
      active.select();
      return;
    }
    const commandMap = {
      undo: 'undo',
      redo: 'redo',
      cut: 'cut',
      copy: 'copy',
      paste: 'paste',
      delete: 'delete',
      selectAll: 'selectAll',
    } as const;
    try {
      document.execCommand(commandMap[command]);
    } catch {
      addToast({ type: 'error', message: t('toast.error') });
    }
  }, [addToast, t]);

  const handleCopyDiagnostics = useCallback(async () => {
    const diagnostic = [
      'AgentHub Desktop diagnostics',
      `Edge: ${online ? `online ${healthVersion ?? 'v1'}` : 'offline'}`,
      `WebSocket: ${isConnected ? 'connected' : 'disconnected'}`,
      wsLatency != null ? `Latency: ${wsLatency}ms` : null,
      selectedAgent ? `Agent: ${selectedAgent.name} (${selectedAgent.id})` : null,
      selectedThread ? `Thread: ${selectedThread.threadId}` : null,
      displayedRun ? `Run: ${displayedRun.runId} (${displayedRun.status})` : null,
    ].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(diagnostic);
      addToast({ type: 'success', message: t('toast.copied') });
    } catch {
      addToast({ type: 'error', message: t('toast.error') });
    }
  }, [addToast, displayedRun, healthVersion, isConnected, online, selectedAgent, selectedThread, t, wsLatency]);

  return { handleWindowCommand, handleEditCommand, handleCopyDiagnostics };
}
