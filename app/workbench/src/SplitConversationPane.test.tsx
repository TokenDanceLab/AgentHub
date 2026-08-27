// real_tested=true
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { WorkbenchConversation } from '@shared/platform';
import type { TranscriptBlock } from '@shared/transcript';
import { SplitConversationPane } from './SplitConversationPane';
import { useTestI18nLanguage } from '@shared/testing/i18n';

/* SplitConversationPane — read-only inactive pane (#1997, UX F3):
   honest empty state, cached transcript hand-off, focus/close wiring. */

beforeAll(async () => {
  await useTestI18nLanguage('en');
});

vi.mock('./ChatViewBridge', () => ({
  ChatViewBridge: (props: { displayTranscript: TranscriptBlock[] }) => (
    <div data-testid="read-only-transcript" data-block-count={props.displayTranscript.length} />
  ),
}));

const conversation: WorkbenchConversation = { id: 'conv-a', title: 'Alpha', kind: 'direct' };
const block = { id: 'b1', kind: 'text', role: 'agent', text: 'hi' } as unknown as TranscriptBlock;

function renderPane(overrides: Partial<Parameters<typeof SplitConversationPane>[0]> = {}) {
  const onFocus = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <SplitConversationPane
      paneId="pane-1"
      conversation={conversation}
      transcript={[]}
      onFocus={onFocus}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { ...utils, onFocus, onClose };
}

describe('SplitConversationPane (#1997)', () => {
  it('shows the honest pick-a-conversation state when no snapshot exists', () => {
    renderPane();
    expect(screen.getByTestId('split-pane-empty').textContent).toContain('Pick a conversation');
    expect(screen.queryByTestId('read-only-transcript')).toBeNull();
  });

  it('renders the cached transcript read-only once a snapshot exists', () => {
    renderPane({ transcript: [block] });
    const transcript = screen.getByTestId('read-only-transcript');
    expect(transcript.getAttribute('data-block-count')).toBe('1');
    expect(screen.queryByTestId('split-pane-empty')).toBeNull();
  });

  it('labels the pane read-only and shows the conversation title', () => {
    renderPane();
    expect(screen.getByText('Read-only')).not.toBeNull();
    expect(screen.getByText('Alpha')).not.toBeNull();
  });

  it('wires header click to focus and the close button to unsplit', () => {
    const { onFocus, onClose } = renderPane();
    fireEvent.click(screen.getByTestId('split-pane-focus'));
    expect(onFocus).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('split-pane-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('surfaces the live status dot for a running conversation', () => {
    const { container } = renderPane({ liveStatus: 'running' });
    expect(container.querySelector('[data-live-status="running"]')).not.toBeNull();
  });

  it('falls back to the pane id when the conversation is unknown', () => {
    renderPane({ conversation: undefined });
    expect(screen.getByText('pane-1')).not.toBeNull();
  });
});
