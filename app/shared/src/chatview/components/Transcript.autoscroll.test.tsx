import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { useTestI18nLanguage } from '../../testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

import { Transcript } from './Transcript';
import type { TranscriptItem } from '../transcript-item';

function user(id: string, text: string): TranscriptItem {
  return { type: 'user', id, name: 'You', time: '10:00', text };
}

function agent(id: string): TranscriptItem {
  return {
    id,
    agent: 'Agent',
    role: 'agent',
    time: '10:00',
    rows: [],
    bubbles: [`agent ${id}`],
    standaloneRows: [],
    runs: [],
  };
}

function setScrollMetrics(element: HTMLElement, metrics: { clientHeight: number; scrollHeight: number; scrollTop: number }) {
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: metrics.clientHeight });
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: metrics.scrollHeight });
  element.scrollTop = metrics.scrollTop;
}

describe('Transcript auto-follow', () => {
  it('follows new agent content when the view is already near the bottom', async () => {
    const { getByRole, rerender } = render(<Transcript items={[agent('a1')]} chatMode="group" />);
    const log = getByRole('log');
    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 500, scrollTop: 395 });
    fireEvent.scroll(log);

    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 700, scrollTop: 395 });
    rerender(<Transcript items={[agent('a1'), agent('a2')]} chatMode="group" />);

    await waitFor(() => expect(log.scrollTop).toBe(700));
  });

  it('does not steal scroll when the user is reading older content', async () => {
    const { getByRole, rerender } = render(<Transcript items={[agent('a1')]} chatMode="group" />);
    const log = getByRole('log');
    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 500, scrollTop: 120 });
    fireEvent.scroll(log);

    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 700, scrollTop: 120 });
    rerender(<Transcript items={[agent('a1'), agent('a2')]} chatMode="group" />);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(log.scrollTop).toBe(120);
  });

  it('scrolls to the latest user message after sending even from older scroll position', async () => {
    const { getByRole, rerender } = render(<Transcript items={[agent('a1')]} chatMode="group" />);
    const log = getByRole('log');
    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 500, scrollTop: 120 });
    fireEvent.scroll(log);

    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 700, scrollTop: 120 });
    rerender(<Transcript items={[agent('a1'), user('u1', '研究一下AgentHub项目')]} chatMode="group" />);

    await waitFor(() => expect(log.scrollTop).toBe(700));
  });

  it('keeps following when an immediate agent reply cancels the user-message scroll frame', async () => {
    const { getByRole, rerender } = render(<Transcript items={[agent('a1')]} chatMode="group" />);
    const log = getByRole('log');
    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 500, scrollTop: 120 });
    fireEvent.scroll(log);

    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 700, scrollTop: 120 });
    rerender(<Transcript items={[agent('a1'), user('u1', '研究一下AgentHub项目')]} chatMode="group" />);

    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 820, scrollTop: 120 });
    rerender(<Transcript items={[agent('a1'), user('u1', '研究一下AgentHub项目'), agent('a2')]} chatMode="group" />);

    await waitFor(() => expect(log.scrollTop).toBe(820));
  });

  it('uses item ids so repeated user text does not collide during reconciliation', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<Transcript items={[
      user('u1', '继续'),
      user('u2', '继续'),
    ]} chatMode="group" />);

    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Encountered two children with the same key'),
      expect.anything(),
    );
    consoleError.mockRestore();
  });

  // ── Scroll-to-bottom button tests ────────────────────────────────

  it('shows scroll-to-bottom button when user scrolls up', () => {
    const { getByRole, queryByRole } = render(<Transcript items={[agent('a1'), agent('a2')]} chatMode="group" />);
    const log = getByRole('log');

    // Default: near bottom → no button
    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 500, scrollTop: 395 });
    fireEvent.scroll(log);

    // No button when near bottom
    expect(queryByRole('button', { name: '回到底部' })).not.toBeInTheDocument();

    // Scroll up → button appears
    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 500, scrollTop: 50 });
    fireEvent.scroll(log);

    expect(queryByRole('button', { name: '回到底部' })).toBeInTheDocument();
  });

  it('scrolls to bottom when scroll-to-bottom button is clicked', async () => {
    const { getByRole } = render(<Transcript items={[agent('a1'), agent('a2')]} chatMode="group" />);
    const log = getByRole('log');

    // Scroll up
    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 500, scrollTop: 50 });
    fireEvent.scroll(log);

    const btn = getByRole('button', { name: '回到底部' });
    expect(btn).toBeInTheDocument();

    // Now simulate new content that makes scrollHeight larger
    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 800, scrollTop: 50 });

    fireEvent.click(btn);

    await waitFor(() => expect(log.scrollTop).toBe(800));
  });

  it('hides scroll-to-bottom button after scrolling back to bottom', () => {
    const { getByRole, queryByRole } = render(<Transcript items={[agent('a1'), agent('a2')]} chatMode="group" />);
    const log = getByRole('log');

    // Scroll up
    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 500, scrollTop: 50 });
    fireEvent.scroll(log);
    expect(queryByRole('button', { name: '回到底部' })).toBeInTheDocument();

    // Scroll back to bottom
    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 500, scrollTop: 395 });
    fireEvent.scroll(log);
    expect(queryByRole('button', { name: '回到底部' })).not.toBeInTheDocument();
  });

  // ── Per-session scroll memory ─────────────────────────────────────

  it('does not force scroll-to-bottom when switching back to a session that was scrolled up', async () => {
    const { getByRole, rerender } = render(<Transcript items={[agent('a1')]} chatMode="group" sessionId="sA" />);
    const log = getByRole('log');

    // Session A: user reads older content (scrolled up, not near bottom).
    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 500, scrollTop: 120 });
    fireEvent.scroll(log);

    // Switch to session B (fresh session → starts at the bottom).
    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 700, scrollTop: 120 });
    rerender(<Transcript items={[user('u1', 'B 的提问'), agent('b1')]} chatMode="group" sessionId="sB" />);
    await waitFor(() => expect(log.scrollTop).toBe(700));

    // Scroll up inside B, then switch back to A. The old buggy heuristic
    // compared identities index-by-index across sessions and misjudged the
    // switch as a new user message, forcing a scroll-to-bottom.
    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 900, scrollTop: 300 });
    fireEvent.scroll(log);
    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 500, scrollTop: 300 });
    rerender(<Transcript items={[agent('a1')]} chatMode="group" sessionId="sA" />);

    // A's own scroll memory is restored — no jump to the bottom.
    await waitFor(() => expect(log.scrollTop).toBe(120));
  });

  it('restores each session its own scroll position on switch-back', async () => {
    const { getByRole, rerender } = render(<Transcript items={[agent('a1')]} chatMode="group" sessionId="sA" />);
    const log = getByRole('log');

    // A scrolled up to 100.
    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 500, scrollTop: 100 });
    fireEvent.scroll(log);

    // Switch to B (fresh → bottom).
    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 600, scrollTop: 100 });
    rerender(<Transcript items={[agent('b1')]} chatMode="group" sessionId="sB" />);
    await waitFor(() => expect(log.scrollTop).toBe(600));

    // B scrolled up to 400.
    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 600, scrollTop: 400 });
    fireEvent.scroll(log);

    // Back to A → A's position (100), not B's (400).
    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 500, scrollTop: 400 });
    rerender(<Transcript items={[agent('a1')]} chatMode="group" sessionId="sA" />);
    await waitFor(() => expect(log.scrollTop).toBe(100));

    // Back to B → B's position (400).
    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 600, scrollTop: 100 });
    rerender(<Transcript items={[agent('b1')]} chatMode="group" sessionId="sB" />);
    await waitFor(() => expect(log.scrollTop).toBe(400));
  });

  it('still forces a follow when a new user message is appended in the same session', async () => {
    const { getByRole, rerender } = render(<Transcript items={[agent('a1')]} chatMode="group" sessionId="sA" />);
    const log = getByRole('log');

    // Scrolled up, then the user submits a message in the same session.
    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 500, scrollTop: 120 });
    fireEvent.scroll(log);

    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 700, scrollTop: 120 });
    rerender(<Transcript items={[agent('a1'), user('u1', '新提问')]} chatMode="group" sessionId="sA" />);

    await waitFor(() => expect(log.scrollTop).toBe(700));
  });

  it('restores the scroll-to-bottom button visibility per session', async () => {
    const { getByRole, queryByRole, rerender } = render(<Transcript items={[agent('a1')]} chatMode="group" sessionId="sA" />);
    const log = getByRole('log');

    // A scrolled up → button visible.
    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 500, scrollTop: 120 });
    fireEvent.scroll(log);
    expect(queryByRole('button', { name: '回到底部' })).toBeInTheDocument();

    // Switch to B (fresh, at bottom) → button hidden.
    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 700, scrollTop: 120 });
    rerender(<Transcript items={[agent('b1')]} chatMode="group" sessionId="sB" />);
    await waitFor(() => expect(log.scrollTop).toBe(700));
    expect(queryByRole('button', { name: '回到底部' })).not.toBeInTheDocument();

    // Back to A → button visible again (A was scrolled up).
    setScrollMetrics(log, { clientHeight: 100, scrollHeight: 500, scrollTop: 120 });
    rerender(<Transcript items={[agent('a1')]} chatMode="group" sessionId="sA" />);
    expect(queryByRole('button', { name: '回到底部' })).toBeInTheDocument();
  });
});
