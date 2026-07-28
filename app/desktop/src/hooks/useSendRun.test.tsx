import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@shared/errors';
import { useModelSettingsStore } from '@/stores/modelSettingsStore';
import { useSendRun, type UseSendRunDeps } from './useSendRun';

const startRun = vi.fn();

vi.mock('@/api/edgeClient', () => ({
  cancelRun: vi.fn(),
  createThread: vi.fn(),
  renameThread: vi.fn(),
  startRun: (...args: unknown[]) => startRun(...args),
}));

vi.mock('@/utils/customInstructions', () => ({
  readCustomInstructions: vi.fn(() => ''),
}));

function createDeps(overrides: Partial<UseSendRunDeps> = {}): UseSendRunDeps {
  return {
    runStartPending: false,
    runIsActive: false,
    activeThreadId: 'thread-edge',
    threads: [{
      threadId: 'thread-edge',
      projectId: 'project-edge',
      title: 'Edge thread',
      status: 'active',
      createdAt: '2026-06-08T00:00:00Z',
      updatedAt: '2026-06-08T00:00:00Z',
    }],
    agents: [{ id: 'codex', name: 'Codex' }],
    selectedAgentId: null,
    optimisticRun: null,
    currentRun: null,
    allMessages: [],
    threadItemCount: 1,
    setRunStartPending: vi.fn(),
    setOptimisticRun: vi.fn(),
    setUserMessages: vi.fn(),
    selectThread: vi.fn(),
    addThreadToCache: vi.fn(),
    updateThreadInCache: vi.fn(),
    setThreadTitleInCache: vi.fn(),
    emptyCreatedThreadIdsRef: { current: new Set<string>() },
    manuallyNamedThreadIdsRef: { current: new Set<string>() },
    queryClient: {
      invalidateQueries: vi.fn(),
    } as unknown as UseSendRunDeps['queryClient'],
    addToast: vi.fn(),
    t: ((key: string) => key) as UseSendRunDeps['t'],
    ...overrides,
  };
}

describe('useSendRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useModelSettingsStore.getState().reset();
    startRun.mockResolvedValue({
      runId: 'run-edge',
      projectId: 'project-edge',
      threadId: 'thread-edge',
      status: 'queued',
    });
  });

  it('filters provider routing metadata before submitting a Desktop start run request', async () => {
    const { result } = renderHook(() => useSendRun(createDeps()));

    await act(async () => {
      await result.current.handleSend('route through selected local adapter', 'codex', {
        model: 'claude-opus-4-7[1M]',
        provider: 'claude-code',
        modelAlias: 'opus[1m]',
      });
    });

    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'codex',
      model: 'claude-opus-4-7[1M]',
      modelAlias: 'opus[1m]',
      modelMappingEnabled: true,
      providerFallbackEnabled: true,
      prompt: 'route through selected local adapter',
      threadId: 'thread-edge',
    }));
    expect(startRun.mock.calls[0]?.[0]).not.toHaveProperty('provider');
  });

  it('treats startRun 409 turn_in_progress as recoverable (info toast, no error toast, #1438)', async () => {
    const setOptimisticRun = vi.fn();
    const addToast = vi.fn();
    const { result } = renderHook(() => useSendRun(createDeps({
      setOptimisticRun,
      addToast,
    })));

    const turnInProgressError = new AppError(
      {
        error: {
          code: 'turn_in_progress',
          message: 'agent instance already has a non-terminal task',
        },
      },
      409,
    );
    startRun.mockRejectedValue(turnInProgressError);

    let succeeded: boolean | undefined;
    await act(async () => {
      succeeded = await result.current.handleSend('trigger while agent busy');
    });

    expect(succeeded).toBe(false);
    // Info toast (not error) — recoverable 409.
    expect(addToast).toHaveBeenCalledWith({ type: 'info', message: 'error.turnInProgress' });
    expect(addToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'error.startRunFailed' }),
    );
    // No optimistic run switched to (unlike active_run_exists).
    expect(setOptimisticRun).toHaveBeenCalledWith(null);
  });

  it('still handles Edge 409 active_run_exists alongside turn_in_progress (coexistence, #1438)', async () => {
    const setOptimisticRun = vi.fn();
    const addToast = vi.fn();
    const { result } = renderHook(() => useSendRun(createDeps({
      setOptimisticRun,
      addToast,
    })));

    const activeRunExistsError = new AppError(
      {
        error: {
          code: 'active_run_exists',
          message: 'thread already has a running agent task',
          details: { runId: 'run-conflict-1' },
        },
      },
      409,
    );
    startRun.mockRejectedValue(activeRunExistsError);

    let succeeded: boolean | undefined;
    await act(async () => {
      succeeded = await result.current.handleSend('trigger while edge busy');
    });

    expect(succeeded).toBe(false);
    // active_run_exists path: switches optimistic run to the conflict run + info toast.
    expect(setOptimisticRun).toHaveBeenCalledWith({
      runId: 'run-conflict-1',
      status: 'running',
      outputText: '',
      toolCalls: [],
      changedFiles: [],
    });
    expect(addToast).toHaveBeenCalledWith({ type: 'info', message: 'error.activeRunExists' });
    // turn_in_progress path NOT triggered — the two 409 codes coexist without shadowing.
    expect(addToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'error.turnInProgress' }),
    );
  });
});
