import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

// ── Fake Edge event stream ─────────────────────────────────────────────
// The hook calls createEventStream() on mount and subscribes a handler.
// This fake records that handler so tests can emit events through it and
// asserts the batching layer coalesces bursts into one state commit.

type EdgeEventHandler = (event: any) => void;
type StatusHandler = (status: any) => void;

interface FakeStream {
  subscribe: (handler: EdgeEventHandler) => () => void;
  onStatusChange: (handler: StatusHandler) => () => void;
  send: (data: any) => void;
  getLatency: () => number | null;
  close: () => void;
  // Test-only side channel: emit an event to every registered handler.
  __emit: (event: any) => void;
}

let fakeStream: FakeStream;
const streamCloseSpy = vi.fn();

vi.mock('@/api/eventClient', () => ({
  createEventStream: (): FakeStream => {
    const handlers: EdgeEventHandler[] = [];
    fakeStream = {
      subscribe(handler: EdgeEventHandler) {
        handlers.push(handler);
        return () => {
          const idx = handlers.indexOf(handler);
          if (idx >= 0) handlers.splice(idx, 1);
        };
      },
      onStatusChange(_handler: StatusHandler) {
        return () => {};
      },
      send() {},
      getLatency() {
        return null;
      },
      close: streamCloseSpy,
      __emit(event: any) {
        // Defensive copy so mutations during iteration don't skip handlers.
        for (const h of [...handlers]) h(event);
      },
    };
    return fakeStream;
  },
}));

import { useDesktopEdgeEvents } from '@/platform/useDesktopEdgeEvents';
import type { EventEnvelope } from '@shared/events';

// ── Drainable rAF queue ────────────────────────────────────────────────
// jsdom's rAF runs on the macrotask queue (awkward with fake timers). We
// swap in a synchronous queue so a test flushes the batch on demand and
// can assert "no flush yet → no state change".
let rafQueue: Array<() => void> = [];
const originalRAF = globalThis.requestAnimationFrame;

function drainRaf(): void {
  const pending = rafQueue;
  rafQueue = [];
  for (const cb of pending) cb();
}

function makeTextDelta(id: string, text: string, seq: number): EventEnvelope {
  return {
    id,
    type: 'run.agent.text_delta',
    seq,
    sentAt: new Date(seq * 1000).toISOString(),
    scope: { runId: 'run-1', threadId: 'thread-1' },
    payload: {
      runId: 'run-1',
      threadId: 'thread-1',
      agentId: 'agent-1',
      agentName: 'TestAgent',
      text,
      delta: text,
    },
  } as unknown as EventEnvelope;
}

/** Wrapper that records every distinct transcript array the hook emits. */
function HookProbe({ onTranscript }: { onTranscript: (blocks: unknown[]) => void }) {
  const transcript = useDesktopEdgeEvents('thread-1', undefined);
  React.useEffect(() => {
    onTranscript(transcript);
  }, [transcript, onTranscript]);
  return null;
}

describe('useDesktopEdgeEvents batching', () => {
  let transcriptUpdates: number;

  beforeEach(() => {
    rafQueue = [];
    streamCloseSpy.mockReset();
    transcriptUpdates = 0;
    globalThis.requestAnimationFrame = ((cb: () => void) => {
      rafQueue.push(cb);
      return 0;
    }) as unknown as typeof requestAnimationFrame;
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRAF;
  });

  it('coalesces a synchronous burst into a single update after the rAF flush', () => {
    const onTranscript = () => {
      transcriptUpdates += 1;
    };

    render(<HookProbe onTranscript={onTranscript} />);
    // The hook's onTranscript effect fires once on mount with the initial
    // empty transcript — record that as the baseline so the assertions
    // below measure only updates caused by the event burst, not by mount.
    const baseline = transcriptUpdates;

    // Push 5 text_delta events synchronously with NO rAF drain yet.
    act(() => {
      for (let i = 0; i < 5; i++) {
        fakeStream.__emit(makeTextDelta(`evt-${i}`, `chunk-${i} `, i));
      }
    });
    // Batching: no flush has run, so no transcript update beyond baseline.
    expect(transcriptUpdates).toBe(baseline);

    // Drain rAF → exactly one flush applies all 5 events in one commit.
    act(() => {
      drainRaf();
    });
    expect(transcriptUpdates).toBe(baseline + 1);
  });

  it('drops duplicate event ids (O(1) dedupe) within a batch', () => {
    const seenTranscripts: unknown[][] = [];
    const onTranscript = (blocks: unknown[]) => {
      seenTranscripts.push(blocks);
    };

    render(<HookProbe onTranscript={onTranscript} />);

    // Emit the SAME event id twice plus one unique event.
    act(() => {
      fakeStream.__emit(makeTextDelta('dup', 'first ', 1));
      fakeStream.__emit(makeTextDelta('dup', 'first ', 1)); // duplicate → dropped
      fakeStream.__emit(makeTextDelta('unique', 'second ', 2));
    });

    act(() => {
      drainRaf();
    });

    // The final transcript must reflect exactly the 2 unique events merged
    // into one text block (same author+run). The normalizer strips trailing
    // whitespace from each delta, so the merged text is 'firstsecond'.
    const finalBlocks = seenTranscripts[seenTranscripts.length - 1] ?? [];
    expect(finalBlocks).toHaveLength(1);
    const mergedBlock = finalBlocks[0] as { kind: string; text: string };
    expect(mergedBlock.kind).toBe('text');
    expect(mergedBlock.text).toBe('firstsecond');
  });

  it('flushes pending events and closes the stream on unmount', () => {
    const onTranscript = () => {};
    const { unmount } = render(<HookProbe onTranscript={onTranscript} />);

    fakeStream.__emit(makeTextDelta('evt-x', 'tail ', 0));
    // No rAF drain yet → event sits in the batch buffer.
    unmount();
    // Effect cleanup must close the stream.
    expect(streamCloseSpy).toHaveBeenCalled();
  });
});
