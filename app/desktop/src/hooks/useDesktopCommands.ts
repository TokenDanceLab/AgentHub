import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriRuntime } from '@/utils/appUtils';
import { useToastStore } from '@/stores/toastStore';
import type { DesktopLocalEdgeDiagnostics } from '@/platform/desktopPlatform';
import {
  formatDesktopEdgeDispatchDiagnostics,
  type DesktopEdgeDispatchReadiness,
} from '@/platform/edgeCapabilityMapper';

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
  dispatchReadiness?: DesktopEdgeDispatchReadiness | null;
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
    dispatchReadiness,
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
      if (await windowHandle.isMaximized()) {
        await windowHandle.unmaximize();
      } else {
        await windowHandle.maximize();
      }
    } catch {
      addToast({ type: 'error', message: t('toast.error') });
    }
  }, [addToast, desktopWindowAvailable, t]);

  const handleEditCommand = useCallback((command: EditCommand) => {
    const active = document.activeElement;

    // selectAll: use native .select() for input/textarea
    if (command === 'selectAll') {
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        active.select();
        return;
      }
      try {
        document.execCommand('selectAll');
      } catch {
        addToast({ type: 'error', message: t('toast.error') });
      }
      return;
    }

    // undo/redo: execCommand is the only reliable trigger, no modern alternative
    if (command === 'undo' || command === 'redo') {
      try {
        document.execCommand(command);
      } catch {
        addToast({ type: 'error', message: t('toast.error') });
      }
      return;
    }

    // cut/copy/paste/delete: prefer modern APIs with execCommand fallback
    switch (command) {
      case 'copy': {
        const selection = window.getSelection();
        if (selection?.toString()) {
          navigator.clipboard.writeText(selection.toString()).catch(() => {
            document.execCommand('copy');
          });
        }
        break;
      }
      case 'cut': {
        const selection = window.getSelection();
        if (selection?.toString()) {
          const text = selection.toString();
          navigator.clipboard.writeText(text).then(() => {
            selection.deleteFromDocument();
          }).catch(() => {
            document.execCommand('cut');
          });
        }
        break;
      }
      case 'paste': {
        navigator.clipboard.readText().then((text) => {
          if (text) {
            document.execCommand('insertText', false, text);
          }
        }).catch(() => {
          document.execCommand('paste');
        });
        break;
      }
      case 'delete': {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) {
          selection.deleteFromDocument();
        } else {
          document.execCommand('delete');
        }
        break;
      }
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
      await readLocalEdgeDiagnosticText(dispatchReadiness),
    ].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(diagnostic);
      addToast({ type: 'success', message: t('toast.copied') });
    } catch {
      addToast({ type: 'error', message: t('toast.error') });
    }
  }, [addToast, dispatchReadiness, displayedRun, healthVersion, isConnected, online, selectedAgent, selectedThread, t, wsLatency]);

  return { handleWindowCommand, handleEditCommand, handleCopyDiagnostics };
}

async function readLocalEdgeDiagnosticText(dispatchReadiness?: DesktopEdgeDispatchReadiness | null): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    const diagnostics = await invoke<DesktopLocalEdgeDiagnostics>('get_local_edge_diagnostics');
    return formatLocalEdgeDiagnosticText(diagnostics, dispatchReadiness);
  } catch (error) {
    return `Local Edge host\n  diagnostics: unavailable (${error instanceof Error ? error.message : String(error)})`;
  }
}

export function formatLocalEdgeDiagnosticText(
  diagnostics: DesktopLocalEdgeDiagnostics,
  dispatchReadiness?: DesktopEdgeDispatchReadiness | null,
): string {
  const readiness = diagnostics.readiness;
  return [
    'Local Edge host',
    `  running: ${diagnostics.status.running}`,
    `  pid: ${diagnostics.status.pid ?? 'n/a'}`,
    `  health: ${diagnostics.status.health_url}`,
    `  preflight: ${readiness.preflight.status}`,
    readiness.preflight.blocker ? `  blocker: ${readiness.preflight.blocker}` : null,
    `  sidecar: ${readiness.preflight.sidecar_available ? 'available' : 'missing'}`,
    `  fallback executable: ${readiness.preflight.fallback_executable_available ? 'available' : 'missing'}`,
    `  auth token: ${readiness.preflight.auth_token_ready ? 'ready' : 'blocked'}`,
    `  store backend: ${readiness.store_backend}`,
    `  store: ${readiness.store_db_policy}`,
    `  store readiness manifest: ${readiness.store_readiness_manifest_schema}`,
    `  expected store migration: ${readiness.expected_store_migration_version}`,
    `  logs: ${readiness.log_paths.directory}`,
    `  stdout: ${readiness.log_paths.stdout}`,
    `  stderr: ${readiness.log_paths.stderr}`,
    formatDesktopEdgeDispatchDiagnostics(dispatchReadiness),
    formatLocalCliDiscoveryDiagnostics(diagnostics.local_cli_discovery),
    `  login loopback: ${diagnostics.packaged_login.loopback.available ? 'ready' : 'blocked'}`,
    `  credential store: ${diagnostics.packaged_login.credential_store.available ? 'ready' : 'blocked'}`,
    `  real login e2e: ${diagnostics.packaged_login.real_e2e.status}`,
    diagnostics.log_tail.stderr.length > 0
      ? `  stderr tail: ${diagnostics.log_tail.stderr.slice(-3).join(' | ')}`
      : null,
  ].filter(Boolean).join('\n');
}

function formatLocalCliDiscoveryDiagnostics(
  discovery: DesktopLocalEdgeDiagnostics['local_cli_discovery'],
): string | null {
  if (!discovery) return null;

  const lines = [
    'Local CLI discovery',
    `  mode: ${discovery.mode}`,
    `  readiness manifest: ${discovery.readinessManifest}`,
    `  readiness script: ${discovery.readinessScript}`,
    ...discovery.items.map((item) => [
      `  ${item.id}: ${item.installed ? 'installed' : 'missing'}`,
      `version=${item.version || 'unknown'}`,
      `path=${formatDiagnosticCliPath(item.path)}`,
      `boundary=${item.noSpend ? 'no-spend' : 'requires-approval'}`,
    ].join(' ')),
  ];

  return lines.join('\n');
}

function formatDiagnosticCliPath(path: string): string {
  const normalized = path.trim();
  if (!normalized) return 'unknown';
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] ?? normalized : normalized;
}
