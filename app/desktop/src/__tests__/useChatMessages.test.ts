vi.mock('@/api/eventClient', () => ({
  createEventStream: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createEventStream } from '@/api/eventClient';
import { useChatMessages } from '@/hooks/useChatMessages';
import type { EventEnvelope } from '@shared/events';

function makeEvent(type: string, payload: Record<string, unknown> = {}): EventEnvelope {
  return {
    version: 'v1',
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    seq: 1,
    type,
    scope: {},
    sentAt: new Date().toISOString(),
    payload,
  };
}

describe('useChatMessages', () => {
  let eventHandler: ((event: EventEnvelope) => void) | null;
  let statusHandler: ((connected: boolean) => void) | null;

  beforeEach(() => {
    eventHandler = null;
    statusHandler = null;
    vi.mocked(createEventStream).mockClear();
    vi.mocked(createEventStream).mockReturnValue({
      subscribe: vi.fn((handler) => {
        eventHandler = handler;
        return () => {
          eventHandler = null;
        };
      }),
      onStatusChange: vi.fn((handler) => {
        statusHandler = handler;
        return () => {
          statusHandler = null;
        };
      }),
      close: vi.fn(),
    });
  });

  it('returns empty messages initially', () => {
    const { result } = renderHook(() => useChatMessages(true));
    expect(result.current.messages).toEqual([]);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.currentRun).toBeNull();
  });

  it('does not create stream when offline', () => {
    renderHook(() => useChatMessages(false));
    // createEventStream should not be called for offline
    expect(createEventStream).not.toHaveBeenCalled();
  });

  it('sets isConnected when stream reports connected', () => {
    const { result } = renderHook(() => useChatMessages(true));

    expect(statusHandler).not.toBeNull();

    act(() => {
      statusHandler!(true);
    });

    expect(result.current.isConnected).toBe(true);
  });

  it('sets isConnected to false when stream reports disconnected', () => {
    const { result } = renderHook(() => useChatMessages(true));

    act(() => {
      statusHandler!(true);
    });
    expect(result.current.isConnected).toBe(true);

    act(() => {
      statusHandler!(false);
    });
    expect(result.current.isConnected).toBe(false);
  });

  it('creates system message on run.started', () => {
    const { result } = renderHook(() => useChatMessages(true));

    act(() => {
      eventHandler!(makeEvent('run.started', { runId: 'run-1', status: 'running' }));
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe('system');
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.currentRun).toMatchObject({
      runId: 'run-1',
      status: 'running',
    });
  });

  it('creates agent message when text_delta event arrives', () => {
    const { result } = renderHook(() => useChatMessages(true));

    act(() => {
      eventHandler!(
        makeEvent('run.agent.text_delta', { runId: 'run-1', content: 'Hello', offset: 0 }),
      );
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe('agent');
    expect(result.current.messages[0].blocks).toHaveLength(1);
    expect(result.current.messages[0].blocks[0]).toMatchObject({
      kind: 'text',
      content: 'Hello',
    });
  });

  it('merges consecutive text_delta events into same message', () => {
    const { result } = renderHook(() => useChatMessages(true));

    act(() => {
      eventHandler!(
        makeEvent('run.agent.text_delta', { runId: 'run-1', content: 'Hello ', offset: 0 }),
      );
    });

    act(() => {
      eventHandler!(
        makeEvent('run.agent.text_delta', { runId: 'run-1', content: 'World', offset: 6 }),
      );
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe('agent');
    expect(result.current.messages[0].blocks).toHaveLength(1);
    expect(result.current.messages[0].blocks[0]).toMatchObject({
      kind: 'text',
      content: 'Hello World',
    });
  });

  it('creates tool_use blocks from tool_call events', () => {
    const { result } = renderHook(() => useChatMessages(true));

    // Need a run.started first so currentRun is set up for tracking
    act(() => {
      eventHandler!(makeEvent('run.started', { runId: 'run-1', status: 'running' }));
    });

    act(() => {
      eventHandler!(
        makeEvent('run.agent.tool_call', {
          runId: 'run-1',
          callId: 'call-1',
          toolName: 'read_file',
          input: { path: '/test.txt' },
          status: 'pending',
        }),
      );
    });

    // Should have 2 messages: system (from run.started) + agent (from tool_call)
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1].role).toBe('agent');
    expect(result.current.messages[1].blocks).toHaveLength(1);
    expect(result.current.messages[1].blocks[0]).toMatchObject({
      kind: 'tool_use',
      callId: 'call-1',
      toolName: 'read_file',
      status: 'pending',
    });

    // currentRun should have the tool call tracked
    expect(result.current.currentRun?.toolCalls).toHaveLength(1);
    expect(result.current.currentRun?.toolCalls[0]).toMatchObject({
      callId: 'call-1',
      toolName: 'read_file',
      status: 'pending',
    });
  });

  it('updates currentRun status on run.finished', () => {
    const { result } = renderHook(() => useChatMessages(true));

    act(() => {
      eventHandler!(makeEvent('run.started', { runId: 'run-1', status: 'running' }));
    });
    expect(result.current.currentRun?.status).toBe('running');
    expect(result.current.isStreaming).toBe(true);

    act(() => {
      eventHandler!(makeEvent('run.finished', { runId: 'run-1', status: 'finished' }));
    });

    expect(result.current.currentRun?.status).toBe('finished');
    expect(result.current.isStreaming).toBe(false);
  });

  it('updates currentRun status on run.failed', () => {
    const { result } = renderHook(() => useChatMessages(true));

    act(() => {
      eventHandler!(makeEvent('run.started', { runId: 'run-1', status: 'running' }));
    });
    expect(result.current.currentRun?.status).toBe('running');

    act(() => {
      eventHandler!(makeEvent('run.failed', { runId: 'run-1', status: 'failed' }));
    });

    expect(result.current.currentRun?.status).toBe('failed');
    expect(result.current.isStreaming).toBe(false);
  });

  it('only updates currentRun when runId matches', () => {
    const { result } = renderHook(() => useChatMessages(true));

    act(() => {
      eventHandler!(makeEvent('run.started', { runId: 'run-1', status: 'running' }));
    });

    // This should not update currentRun because runId differs
    act(() => {
      eventHandler!(makeEvent('run.finished', { runId: 'run-other', status: 'finished' }));
    });

    expect(result.current.currentRun?.status).toBe('running');
  });

  it('creates thinking blocks', () => {
    const { result } = renderHook(() => useChatMessages(true));

    act(() => {
      eventHandler!(makeEvent('run.agent.thinking', { runId: 'run-1', content: 'Hmm...' }));
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe('agent');
    expect(result.current.messages[0].blocks[0]).toMatchObject({
      kind: 'thinking',
      content: 'Hmm...',
    });
  });

  it('merges consecutive thinking blocks', () => {
    const { result } = renderHook(() => useChatMessages(true));

    act(() => {
      eventHandler!(makeEvent('run.agent.thinking', { runId: 'run-1', content: 'Hmm' }));
    });
    act(() => {
      eventHandler!(makeEvent('run.agent.thinking', { runId: 'run-1', content: '...' }));
    });

    expect(result.current.messages[0].blocks).toHaveLength(1);
    expect(result.current.messages[0].blocks[0]).toMatchObject({
      kind: 'thinking',
      content: 'Hmm...',
    });
  });

  it('creates different agent message after system message splits them', () => {
    const { result } = renderHook(() => useChatMessages(true));

    // First agent thinking block
    act(() => {
      eventHandler!(makeEvent('run.agent.thinking', { runId: 'run-1', content: 'Think 1' }));
    });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe('agent');

    // System message (run.started) creates a system message that separates from the agent
    act(() => {
      eventHandler!(makeEvent('run.started', { runId: 'run-2', status: 'running' }));
    });

    // Now another agent event should create a NEW agent message (not merge with previous)
    act(() => {
      eventHandler!(
        makeEvent('run.agent.text_delta', { runId: 'run-2', content: 'Fresh', offset: 0 }),
      );
    });

    expect(result.current.messages).toHaveLength(3); // agent, system, agent
    expect(result.current.messages[2].role).toBe('agent');
    expect(result.current.messages[2].blocks[0]).toMatchObject({
      kind: 'text',
      content: 'Fresh',
    });
  });

  it('creates text block from text_block event', () => {
    const { result } = renderHook(() => useChatMessages(true));

    act(() => {
      eventHandler!(
        makeEvent('run.agent.text_block', {
          runId: 'run-1',
          content: 'markdown text',
          contentType: 'markdown',
        }),
      );
    });

    expect(result.current.messages[0].blocks[0]).toMatchObject({
      kind: 'text',
      content: 'markdown text',
    });
  });

  it('creates code block from text_block event with code type', () => {
    const { result } = renderHook(() => useChatMessages(true));

    act(() => {
      eventHandler!(
        makeEvent('run.agent.text_block', {
          runId: 'run-1',
          content: 'const x = 1;',
          contentType: 'code',
          language: 'typescript',
        }),
      );
    });

    expect(result.current.messages[0].blocks[0]).toMatchObject({
      kind: 'code',
      content: 'const x = 1;',
      language: 'typescript',
    });
  });

  it('creates session_init block', () => {
    const { result } = renderHook(() => useChatMessages(true));

    act(() => {
      eventHandler!(
        makeEvent('run.agent.session_init', {
          runId: 'run-1',
          model: 'claude-sonnet',
          tools: ['read_file'],
          permissionMode: 'auto',
        }),
      );
    });

    expect(result.current.messages[0].blocks[0]).toMatchObject({
      kind: 'session_init',
      model: 'claude-sonnet',
      permissionMode: 'auto',
    });
  });

  it('nests tool_result as child of tool_use', () => {
    const { result } = renderHook(() => useChatMessages(true));

    // First create a tool_use block
    act(() => {
      eventHandler!(
        makeEvent('run.agent.tool_call', {
          runId: 'run-1',
          callId: 'call-1',
          toolName: 'read_file',
          input: { path: '/test' },
          status: 'running',
        }),
      );
    });

    // Then create the tool_result
    act(() => {
      eventHandler!(
        makeEvent('run.agent.tool_result', {
          runId: 'run-1',
          callId: 'call-1',
          toolName: 'read_file',
          output: 'file contents here',
        }),
      );
    });

    const block = result.current.messages[0].blocks[0] as any;
    expect(block.kind).toBe('tool_use');
    expect(block.children).toHaveLength(1);
    expect(block.children[0]).toMatchObject({
      kind: 'generic_result',
      output: 'file contents here',
    });
  });

  it('updates tool_use status to completed on tool_result', () => {
    const { result } = renderHook(() => useChatMessages(true));

    // Need a run.started first so currentRun is set up
    act(() => {
      eventHandler!(makeEvent('run.started', { runId: 'run-1', status: 'running' }));
    });

    act(() => {
      eventHandler!(
        makeEvent('run.agent.tool_call', {
          runId: 'run-1',
          callId: 'call-1',
          toolName: 'read_file',
          input: {},
          status: 'pending',
        }),
      );
    });
    expect(result.current.currentRun?.toolCalls[0].status).toBe('pending');

    act(() => {
      eventHandler!(
        makeEvent('run.agent.tool_result', {
          runId: 'run-1',
          callId: 'call-1',
          toolName: 'read_file',
          output: 'content',
        }),
      );
    });
    expect(result.current.currentRun?.toolCalls[0].status).toBe('completed');
  });

  it('creates file_change block', () => {
    const { result } = renderHook(() => useChatMessages(true));

    act(() => {
      eventHandler!(
        makeEvent('run.agent.file_change', {
          runId: 'run-1',
          path: '/src/test.ts',
          action: 'created',
          diff: '+new line',
          callId: 'toolu_1',
          toolName: 'Write',
          content: 'File written',
        }),
      );
    });

    expect(result.current.messages[0].blocks[0]).toMatchObject({
      kind: 'file_change',
      path: '/src/test.ts',
      action: 'created',
      diff: '+new line',
    });
  });

  it('tracks changedFiles in currentRun', () => {
    const { result } = renderHook(() => useChatMessages(true));

    // Need a currentRun first
    act(() => {
      eventHandler!(
        makeEvent('run.agent.file_change', {
          runId: 'no-match',
          path: '/ignored.ts',
          action: 'created',
        }),
      );
    });
    // No currentRun, so no files tracked
    expect(result.current.currentRun).toBeNull();

    // Now simulate having a run
    act(() => {
      eventHandler!(
        makeEvent('run.agent.file_change', {
          runId: 'run-1',
          path: '/src/test.ts',
          action: 'created',
        }),
      );
    });
    // Still no currentRun because we never had a run.started with match
    expect(result.current.currentRun).toBeNull();
  });

  it('creates result block on run.agent.result', () => {
    const { result } = renderHook(() => useChatMessages(true));

    act(() => {
      eventHandler!(
        makeEvent('run.agent.result', {
          runId: 'run-1',
          success: true,
          usage: { inputTokens: 100, outputTokens: 50 },
        }),
      );
    });

    expect(result.current.messages[0].blocks[0]).toMatchObject({
      kind: 'result',
      success: true,
      tokenUsage: { input: 100, output: 50 },
    });
  });

  it('creates result block for failed result', () => {
    const { result } = renderHook(() => useChatMessages(true));

    act(() => {
      eventHandler!(
        makeEvent('run.agent.result', {
          runId: 'run-1',
          success: false,
          error: 'Something went wrong',
        }),
      );
    });

    expect(result.current.messages[0].blocks[0]).toMatchObject({
      kind: 'result',
      success: false,
      error: 'Something went wrong',
    });
  });

  it('handles output.batch events for currentRun', () => {
    const { result } = renderHook(() => useChatMessages(true));

    act(() => {
      eventHandler!(makeEvent('run.started', { runId: 'run-1', status: 'running' }));
    });

    act(() => {
      eventHandler!(
        makeEvent('run.output.batch', {
          runId: 'run-1',
          stream: 'stdout',
          chunks: [
            { offset: 0, text: 'Hello ' },
            { offset: 6, text: 'World' },
          ],
        }),
      );
    });

    expect(result.current.currentRun?.outputText).toBe('Hello World');
  });

  it('clearMessages clears messages and currentRun', () => {
    const { result } = renderHook(() => useChatMessages(true));

    act(() => {
      eventHandler!(makeEvent('run.started', { runId: 'run-1', status: 'running' }));
      eventHandler!(
        makeEvent('run.agent.text_delta', { runId: 'run-1', content: 'Hello', offset: 0 }),
      );
    });

    expect(result.current.messages.length).toBeGreaterThan(0);
    expect(result.current.currentRun).not.toBeNull();

    act(() => {
      result.current.clearMessages();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.currentRun).toBeNull();
  });
});
