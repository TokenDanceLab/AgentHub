import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { Transcript, type TranscriptHandle } from './Transcript';
import { ChatViewTranscript } from './ChatViewTranscript';
import type { TranscriptItem, TranscriptAgentItem } from '../transcript-item';
import type { VirtualizerHandle } from 'virtua';
import type { TranscriptBlock } from '../adapter';

/* ──────────────────────────────────────────────────────────────────────
   Virtualization wiring tests (T15 / RFC §6.2–§6.3).

   jsdom has no layout engine, so the real virtua Virtualizer cannot measure
   the viewport/rows and mounts zero rows. These tests therefore use a
   CONTROLLABLE virtua mock that (a) renders every segment child so
   content/DOM assertions work, and (b) captures the VirtualizerHandle ref
   so the Transcript's `scrollToBlockId` can be observed calling
   `scrollToIndex(index, { align: 'center' })`. The real Virtualizer's scroll
   contract is covered by Transcript.autoscroll.test.tsx.
   ────────────────────────────────────────────────────────────────────── */

function agentItem(id: string, rows: TranscriptAgentItem['rows']): TranscriptAgentItem {
  return {
    id,
    agent: 'Agent',
    role: 'agent',
    time: '10:00',
    rows,
    standaloneRows: [],
    runs: [],
    bubbles: [],
  };
}

function userItem(id: string, text: string): TranscriptItem {
  return { type: 'user', id, name: 'You', time: '10:00', text };
}

function row(
  id: string,
  extra: Partial<TranscriptAgentItem['rows'][number]> = {}
): TranscriptAgentItem['rows'][number] {
  return {
    id,
    type: 'tool',
    label: id,
    status: 'ok',
    collapsible: true,
    toolName: 'read',
    ...extra,
  };
}

/** Shared scrollToIndex spy — reset per test. */
let scrollToIndexSpy: ReturnType<typeof vi.fn>;
let captured: VirtualizerHandle | null = null;

vi.mock('virtua', () => ({
  // Controllable passthrough: renders every child (so rows are queryable in
  // jsdom) AND exposes a VirtualizerHandle stub on the ref Transcript passes
  // in, so scrollToBlockId's scrollToIndex call is observable.
  Virtualizer: ({
    children,
    ref,
  }: {
    children?: ReactNode;
    ref?: { current: VirtualizerHandle | null };
  }) => {
    if (ref) ref.current = captured;
    return <>{children}</>;
  },
}));

function makeHandle(): VirtualizerHandle {
  return {
    scrollToIndex: scrollToIndexSpy,
    scrollTo: vi.fn(),
    scrollBy: vi.fn(),
    scrollOffset: 0,
    scrollSize: 0,
    viewportSize: 0,
    cache: {} as never,
    findItemIndex: vi.fn(),
    getItemOffset: vi.fn(),
    getItemSize: vi.fn(),
  } as unknown as VirtualizerHandle;
}

describe('Transcript virtualization wiring', () => {
  beforeEach(() => {
    scrollToIndexSpy = vi.fn();
    captured = makeHandle();
  });

  // ── Virtualizer mount + segment rendering ───────────────────────────
  it('renders segment children through the Virtualizer', () => {
    const items: TranscriptItem[] = [
      userItem('u1', '一条普通消息'),
      agentItem('a1', [row('tool-read')]),
    ];
    render(<Transcript items={items} chatMode="group" />);
    expect(screen.getByText('一条普通消息')).toBeInTheDocument();
    expect(document.querySelector('[data-block-id="tool-read"]')).not.toBeNull();
  });

  // ── blockIndexMap: unknown id → -1, no scrollToIndex ─────────────────
  it('scrollToBlockId returns -1 and does not scroll for an unknown block id', () => {
    const ref = createRef<TranscriptHandle>();
    render(<Transcript ref={ref} items={[agentItem('a1', [row('tool-read')])]} chatMode="group" />);
    expect(ref.current?.scrollToBlockId('does-not-exist')).toBe(-1);
    expect(scrollToIndexSpy).not.toHaveBeenCalled();
  });

  // ── blockIndexMap: non-tool row id → segment index ───────────────────
  it('maps a non-tool row id to its segment index and calls scrollToIndex(center)', () => {
    const ref = createRef<TranscriptHandle>();
    // segments: [agent a1 (rows: tool-read @ index 0)]
    render(<Transcript ref={ref} items={[agentItem('a1', [row('tool-read')])]} chatMode="group" />);
    expect(ref.current?.scrollToBlockId('tool-read')).toBe(0);
    expect(scrollToIndexSpy).toHaveBeenCalledWith(0, { align: 'center' });
  });

  // ── blockIndexMap: tool row with toolCallId → call-${id} key ─────────
  it('maps a tool row with toolCallId via the call-${id} identity', () => {
    const ref = createRef<TranscriptHandle>();
    render(
      <Transcript
        ref={ref}
        items={[agentItem('a1', [row('tc1', { toolCallId: 'call-1' })])]}
        chatMode="group"
      />
    );
    // stableInteractionId -> `call-call-1` (NOT the row id 'tc1')
    expect(ref.current?.scrollToBlockId('tc1')).toBe(-1);
    expect(ref.current?.scrollToBlockId('call-call-1')).toBe(0);
    expect(scrollToIndexSpy).toHaveBeenCalledWith(0, { align: 'center' });
  });

  // ── blockIndexMap: a row in a LATER segment maps to that segment ─────
  it('maps a row in a later segment to that segment index (not 0)', () => {
    const ref = createRef<TranscriptHandle>();
    // segments: [agent a1 (index 0), user u1 (index 1), agent a2 (index 2)]
    render(
      <Transcript
        ref={ref}
        items={[
          agentItem('a1', [row('tool-early')]),
          userItem('u1', '用户提问'),
          agentItem('a2', [row('tool-late')]),
        ]}
        chatMode="group"
      />
    );
    expect(ref.current?.scrollToBlockId('tool-early')).toBe(0);
    expect(ref.current?.scrollToBlockId('tool-late')).toBe(2);
    expect(scrollToIndexSpy).toHaveBeenCalledWith(2, { align: 'center' });
  });

  // ── blockIndexMap: rows in standaloneRows and parts are also mapped ──
  it('maps rows in standaloneRows and parts, not just rows', () => {
    const ref = createRef<TranscriptHandle>();
    const item: TranscriptAgentItem = {
      id: 'a1',
      agent: 'Agent',
      role: 'agent',
      time: '10:00',
      rows: [row('in-rows')],
      standaloneRows: [row('in-standalone')],
      runs: [],
      bubbles: [],
      parts: [
        { type: 'row', row: row('in-parts') },
        { type: 'bubble', text: '气泡文本' },
      ],
    };
    render(<Transcript ref={ref} items={[item]} chatMode="group" />);
    expect(ref.current?.scrollToBlockId('in-rows')).toBe(0);
    expect(ref.current?.scrollToBlockId('in-standalone')).toBe(0);
    expect(ref.current?.scrollToBlockId('in-parts')).toBe(0);
  });
});

// ── ChatViewTranscript highlight migration (RFC §6.3) ──────────────────
//
// Under virtualization the target row may be off-screen; ChatViewTranscript
// now calls Transcript.scrollToBlockId (→ virtualizer.scrollToIndex) before
// the rAF querySelector + highlight class. This test asserts BOTH halves:
// the virtualizer is told to mount the segment, AND the row receives the
// `highlighted` class.

function describeBlock(): TranscriptBlock[] {
  return [
    {
      id: 'b1',
      kind: 'tool_call',
      createdAt: '2026-01-01T00:00:00Z',
      author: { role: 'agent', id: 'agent-1', name: 'Agent' },
      toolName: 'Read',
      status: 'completed',
      callId: 'call-1',
    } as TranscriptBlock,
  ];
}

describe('ChatViewTranscript highlight jump (virtualized)', () => {
  beforeEach(() => {
    scrollToIndexSpy = vi.fn();
    captured = makeHandle();
  });

  it('asks the virtualizer to mount the segment and highlights the row', async () => {
    const { container } = render(
      <ChatViewTranscript
        transcript={describeBlock()}
        chatMode="group"
        highlightedBlockId="call-call-1"
      />
    );
    // The virtualizer is told to scroll the containing segment into view.
    await vi.waitFor(() => {
      expect(scrollToIndexSpy).toHaveBeenCalledWith(0, { align: 'center' });
    });
    // After the rAF, the row is mounted (passthrough mock) and highlighted.
    await vi.waitFor(() => {
      const el = container.querySelector('[data-block-id="call-call-1"]');
      expect(el?.classList.contains('highlighted')).toBe(true);
    });
  });
});

/* ──────────────────────────────────────────────────────────────────────
   A11y live-region throttle (#11).
   ────────────────────────────────────────────────────────────────────── */

describe('Transcript aria-busy / live-region throttle', () => {
  it('marks the log aria-busy and drops aria-live while any row is running', () => {
    const { getByRole, rerender } = render(
      <Transcript items={[agentItem('a1', [row('r1', { status: 'running' })])]} chatMode="group" />
    );
    const log = getByRole('log');
    expect(log).toHaveAttribute('aria-busy', 'true');
    expect(log).toHaveAttribute('aria-live', 'off');

    // Streaming completes → region returns to polite, busy clears.
    rerender(<Transcript items={[agentItem('a1', [row('r1', { status: 'ok' })])]} chatMode="group" />);
    expect(log).toHaveAttribute('aria-busy', 'false');
    expect(log).toHaveAttribute('aria-live', 'polite');
  });

  it('keeps the log polite and not busy for idle transcripts', () => {
    const { getByRole } = render(
      <Transcript items={[agentItem('a1', [row('r1', { status: 'ok' })])]} chatMode="group" />
    );
    const log = getByRole('log');
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(log).toHaveAttribute('aria-busy', 'false');
  });
});
