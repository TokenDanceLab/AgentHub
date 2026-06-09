import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});
