import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseWorkspaceRootFromBackend } from './workspaceStore';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe('chooseWorkspaceRootFromBackend', () => {
  beforeEach(() => {
    localStorage.clear();
    mockedInvoke.mockReset();
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  it('invokes the trusted Tauri workspace picker and mirrors the selected root locally', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
    mockedInvoke.mockResolvedValueOnce({
      name: 'AgentHub',
      path: 'D:/Code/TokenDance/AgentHub',
      last_opened_at: 1_771_000_000_000,
      branch: 'codex/p1-remote-control-integration',
    });

    const workspace = await chooseWorkspaceRootFromBackend();

    expect(mockedInvoke).toHaveBeenCalledWith('choose_workspace_root');
    expect(workspace).toEqual({
      name: 'AgentHub',
      path: 'D:/Code/TokenDance/AgentHub',
      lastOpenedAt: 1_771_000_000_000,
      branch: 'codex/p1-remote-control-integration',
    });
    expect(localStorage.getItem('agenthub.prompt.workDir')).toBe('D:/Code/TokenDance/AgentHub');
    expect(JSON.parse(localStorage.getItem('agenthub.workspaces.recent') ?? '[]')).toEqual([
      expect.objectContaining({
        name: 'AgentHub',
        path: 'D:/Code/TokenDance/AgentHub',
      }),
    ]);
  });

  it('keeps browser fallback local-only and does not invoke Tauri when host internals are absent', async () => {
    const workspace = await chooseWorkspaceRootFromBackend();

    expect(workspace).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();
    expect(localStorage.getItem('agenthub.prompt.workDir')).toBeNull();
    expect(localStorage.getItem('agenthub.workspaces.recent')).toBeNull();
  });

  it('returns null without writing local storage when the Tauri picker is cancelled', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
    mockedInvoke.mockResolvedValueOnce(null);

    const workspace = await chooseWorkspaceRootFromBackend();

    expect(mockedInvoke).toHaveBeenCalledWith('choose_workspace_root');
    expect(workspace).toBeNull();
    expect(localStorage.getItem('agenthub.prompt.workDir')).toBeNull();
    expect(localStorage.getItem('agenthub.workspaces.recent')).toBeNull();
  });

  it('catches Tauri picker errors without writing local storage', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
    mockedInvoke.mockRejectedValueOnce(new Error('dialog failed'));

    const workspace = await chooseWorkspaceRootFromBackend();

    expect(mockedInvoke).toHaveBeenCalledWith('choose_workspace_root');
    expect(workspace).toBeNull();
    expect(localStorage.getItem('agenthub.prompt.workDir')).toBeNull();
    expect(localStorage.getItem('agenthub.workspaces.recent')).toBeNull();
  });
});
