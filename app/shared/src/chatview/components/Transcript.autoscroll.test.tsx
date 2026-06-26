import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
});
