import { beforeEach, describe, expect, it } from 'vitest';
import { useThreadStore } from '@/stores/threadStore';

describe('threadStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useThreadStore.setState({
      selectedThreadId: null,
      selectedAgentId: null,
      agentThreadMap: {},
    });
  });

  it('restores the runtime bound to a selected thread', () => {
    useThreadStore.getState().selectAgentThread('claude-code', 'thread-1');
    useThreadStore.getState().selectAgent('codex');

    useThreadStore.getState().selectThread('thread-1');

    expect(useThreadStore.getState().selectedThreadId).toBe('thread-1');
    expect(useThreadStore.getState().selectedAgentId).toBe('claude-code');
  });

  it('clears runtime selection for threads with no runtime binding', () => {
    useThreadStore.getState().selectAgentThread('claude-code', 'thread-1');

    useThreadStore.getState().selectThread('thread-2');

    expect(useThreadStore.getState().selectedThreadId).toBe('thread-2');
    expect(useThreadStore.getState().selectedAgentId).toBeNull();
  });

  it('persists selected thread and runtime bindings across reloads', () => {
    useThreadStore.getState().selectAgentThread('claude-code', 'thread-1');

    const persisted = JSON.parse(localStorage.getItem('agenthub-thread-selection') ?? '{}');

    expect(persisted.state.selectedThreadId).toBe('thread-1');
    expect(persisted.state.selectedAgentId).toBe('claude-code');
    expect(persisted.state.agentThreadMap).toEqual({ 'claude-code': 'thread-1' });
  });

  it('prunes stale selected threads and runtime bindings after Edge reloads', () => {
    useThreadStore.getState().selectAgentThread('codex', 'thread-live');
    useThreadStore.getState().selectAgentThread('claude-code', 'thread-stale');

    useThreadStore.getState().pruneMissingThreads(['thread-live']);

    expect(useThreadStore.getState().selectedThreadId).toBeNull();
    expect(useThreadStore.getState().selectedAgentId).toBeNull();
    expect(useThreadStore.getState().agentThreadMap).toEqual({ codex: 'thread-live' });
  });
});
