import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockTerminalPort } from '@shared/platform/createMockPlatform';
import type { TerminalSession } from '@shared/platform/types';
import { isLocalTerminalEnabled, TerminalPanel } from './TerminalPanel';

const sampleSessions: TerminalSession[] = [
  {
    id: 'term-1',
    title: 'Shell 1',
    status: 'running',
    createdAt: '2026-01-01T00:00:00.000Z',
    cwd: 'REPO_ROOT/AgentHub',
  },
];

describe('isLocalTerminalEnabled', () => {
  it('is true only for explicit true', () => {
    expect(isLocalTerminalEnabled(true)).toBe(true);
    expect(isLocalTerminalEnabled(false)).toBe(false);
    expect(isLocalTerminalEnabled(undefined)).toBe(false);
  });
});

describe('TerminalPanel capability gate', () => {
  it('renders nothing when localTerminal is false or omitted', () => {
    const { container: a } = render(
      <TerminalPanel localTerminal={false} sessions={sampleSessions} />,
    );
    expect(a.querySelector('[data-terminal-panel]')).toBeNull();

    const { container: b } = render(
      <TerminalPanel sessions={sampleSessions} />,
    );
    expect(b.querySelector('[data-terminal-panel]')).toBeNull();
  });

  it('renders shell UI when localTerminal is true', () => {
    render(
      <TerminalPanel
        localTerminal
        sessions={sampleSessions}
        activeSessionId="term-1"
      />,
    );

    expect(screen.getByRole('tablist', { name: '本地终端' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Shell 1/ })).toBeInTheDocument();
    expect(screen.getByText('终端宿主端口已连接 · 等待主机输出')).toBeInTheDocument();
    expect(screen.getByText('No renderer PTY')).toBeInTheDocument();
  });

  it('shows empty state and spawns via typed terminal port', async () => {
    const terminal = createMockTerminalPort();
    const spawn = vi.spyOn(terminal, 'spawn');

    render(
      <TerminalPanel
        localTerminal
        terminal={terminal}
        sessions={[]}
        activeSessionId={null}
      />,
    );

    expect(screen.getByText('暂无终端会话')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('terminal-spawn-empty'));

    await waitFor(() => {
      expect(spawn).toHaveBeenCalledTimes(1);
    });
  });

  it('loads sessions from terminal.list when uncontrolled', async () => {
    const terminal = createMockTerminalPort(sampleSessions);

    render(
      <TerminalPanel localTerminal terminal={terminal} />,
    );

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Shell 1/ })).toBeInTheDocument();
    });
  });
});
