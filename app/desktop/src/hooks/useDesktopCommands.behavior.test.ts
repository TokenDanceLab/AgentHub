import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { useDesktopCommands } from './useDesktopCommands';

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const baseDeps = {
  online: true,
  isConnected: true,
  wsLatency: 42,
  healthVersion: 'v2',
  selectedAgent: { name: 'Claude', id: 'agent-1' },
  selectedThread: { threadId: 'thread-1', title: 'Thread' },
  displayedRun: { runId: 'run-1', status: 'running' },
};

describe('useDesktopCommands behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
        readText: vi.fn().mockResolvedValue('pasted'),
      },
    });
    document.execCommand = vi.fn().mockReturnValue(true);
  });

  it('reports unavailable native window controls in browser mode', async () => {
    const { result } = renderHook(() => useDesktopCommands(baseDeps));
    await act(async () => {
      await result.current.handleWindowCommand('minimize');
    });
    expect(getCurrentWindow).not.toHaveBeenCalled();
  });

  it('dispatches minimize, close, and maximize toggle through Tauri', async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const windowHandle = {
      minimize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
    };
    vi.mocked(getCurrentWindow).mockReturnValue(windowHandle as never);
    const { result } = renderHook(() => useDesktopCommands(baseDeps));
    await act(async () => {
      await result.current.handleWindowCommand('minimize');
      await result.current.handleWindowCommand('close');
      await result.current.handleWindowCommand('toggleMaximize');
      await result.current.handleWindowCommand('toggleMaximize');
    });
    expect(windowHandle.minimize).toHaveBeenCalled();
    expect(windowHandle.close).toHaveBeenCalled();
    expect(windowHandle.maximize).toHaveBeenCalled();
    expect(windowHandle.unmaximize).toHaveBeenCalled();
  });

  it('falls back to an error toast when a native command throws', async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    vi.mocked(getCurrentWindow).mockImplementation(() => {
      throw new Error('window unavailable');
    });
    const { result } = renderHook(() => useDesktopCommands(baseDeps));
    await act(async () => {
      await result.current.handleWindowCommand('close');
    });
    expect(getCurrentWindow).toHaveBeenCalled();
  });

  it('handles edit commands for native selection and clipboard fallbacks', async () => {
    const { result } = renderHook(() => useDesktopCommands(baseDeps));
    const input = document.createElement('input');
    input.value = 'selected';
    document.body.appendChild(input);
    input.focus();
    await act(async () => {
      result.current.handleEditCommand('selectAll');
      input.remove();
      result.current.handleEditCommand('selectAll');
      result.current.handleEditCommand('undo');
      result.current.handleEditCommand('redo');
      result.current.handleEditCommand('paste');
      result.current.handleEditCommand('delete');
    });
    expect(document.execCommand).toHaveBeenCalledWith('selectAll');
    expect(document.execCommand).toHaveBeenCalledWith('undo');
    expect(document.execCommand).toHaveBeenCalledWith('redo');
    expect(navigator.clipboard.readText).toHaveBeenCalled();
  });

  it('copies diagnostics with connection and local-edge context', async () => {
    const { result } = renderHook(() =>
      useDesktopCommands({ ...baseDeps, dispatchReadiness: null }),
    );
    await act(async () => {
      await result.current.handleCopyDiagnostics();
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('Edge: online v2'),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('Latency: 42ms'),
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});
