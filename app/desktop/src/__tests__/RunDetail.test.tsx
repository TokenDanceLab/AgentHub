vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (!vars) return key;
      const varStr = Object.entries(vars)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      return `${key}(${varStr})`;
    },
    i18n: { language: 'en' },
  }),
}));

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import RunDetail from '@/components/RunDetail';
import type { RunInfo } from '@shared/types';

function makeRun(overrides: Partial<RunInfo> = {}): RunInfo {
  return {
    runId: 'run-test-001',
    projectId: 'proj-1',
    threadId: 'thread-1',
    status: 'running',
    ...overrides,
  };
}

describe('RunDetail', () => {
  it('renders empty state when run is null', () => {
    render(<RunDetail run={null} toolCalls={[]} changedFiles={[]} outputText="" />);
    expect(screen.getByText('No active run')).toBeInTheDocument();
  });

  it('shows run status with color coding for running', () => {
    const run = makeRun({ status: 'running' });
    render(<RunDetail run={run} toolCalls={[]} changedFiles={[]} outputText="" />);
    const statusEl = screen.getByText('run.status.running');
    expect(statusEl).toBeInTheDocument();
    expect(statusEl.className).toContain('statusRunning');
  });

  it('shows run status with color coding for finished', () => {
    const run = makeRun({ status: 'finished' });
    render(<RunDetail run={run} toolCalls={[]} changedFiles={[]} outputText="" />);
    const statusEl = screen.getByText('run.status.finished');
    expect(statusEl).toBeInTheDocument();
    expect(statusEl.className).toContain('statusDone');
  });

  it('shows run status with color coding for failed', () => {
    const run = makeRun({ status: 'failed' });
    render(<RunDetail run={run} toolCalls={[]} changedFiles={[]} outputText="" />);
    const statusEl = screen.getByText('run.status.failed');
    expect(statusEl).toBeInTheDocument();
    expect(statusEl.className).toContain('statusFailed');
  });

  it('shows run status for queued', () => {
    const run = makeRun({ status: 'queued' });
    render(<RunDetail run={run} toolCalls={[]} changedFiles={[]} outputText="" />);
    const statusEl = screen.getByText('run.status.queued');
    expect(statusEl).toBeInTheDocument();
    expect(statusEl.className).toContain('statusPending');
  });

  it('shows truncated runId', () => {
    const run = makeRun({ runId: 'run-very-long-identifier-abc123' });
    render(<RunDetail run={run} toolCalls={[]} changedFiles={[]} outputText="" />);
    // Should show first 12 chars
    expect(screen.getByText('run-very-lon')).toBeInTheDocument();
  });

  it('shows output text in pre block', () => {
    const run = makeRun({ status: 'finished' });
    render(
      <RunDetail run={run} toolCalls={[]} changedFiles={[]} outputText="Hello stdout output" />,
    );
    expect(screen.getByText('Hello stdout output')).toBeInTheDocument();
    // Check it's inside a <pre> tag
    const preEl = screen.getByText('Hello stdout output').closest('pre');
    expect(preEl).toBeInTheDocument();
  });

  it('does not show output section when outputText is empty', () => {
    const run = makeRun();
    render(<RunDetail run={run} toolCalls={[]} changedFiles={[]} outputText="" />);
    expect(screen.queryByText('run.output')).not.toBeInTheDocument();
  });

  it('shows tool calls list', () => {
    const run = makeRun({ status: 'running' });
    const toolCalls = [
      {
        callId: 'call-1',
        toolName: 'read_file',
        status: 'completed',
        timestamp: '2025-01-01T00:00:00Z',
      },
      {
        callId: 'call-2',
        toolName: 'write_file',
        status: 'pending',
        timestamp: '2025-01-01T00:00:01Z',
      },
    ];
    render(<RunDetail run={run} toolCalls={toolCalls} changedFiles={[]} outputText="" />);
    expect(screen.getByText('read_file')).toBeInTheDocument();
    expect(screen.getByText('write_file')).toBeInTheDocument();
  });

  it('does not show tool calls section when list is empty', () => {
    const run = makeRun();
    render(<RunDetail run={run} toolCalls={[]} changedFiles={[]} outputText="" />);
    expect(screen.queryByText('run.toolCalls')).not.toBeInTheDocument();
  });

  it('shows changed files list', () => {
    const run = makeRun({ status: 'running' });
    const changedFiles = [
      { path: '/src/test.ts', action: 'created', timestamp: '2025-01-01T00:00:00Z' },
      { path: '/src/config.ts', action: 'modified', timestamp: '2025-01-01T00:00:01Z' },
    ];
    render(<RunDetail run={run} toolCalls={[]} changedFiles={changedFiles} outputText="" />);
    expect(screen.getByText('/src/test.ts')).toBeInTheDocument();
    expect(screen.getByText('/src/config.ts')).toBeInTheDocument();
    expect(screen.getByText('created')).toBeInTheDocument();
    expect(screen.getByText('modified')).toBeInTheDocument();
  });

  it('does not show changed files section when list is empty', () => {
    const run = makeRun();
    render(<RunDetail run={run} toolCalls={[]} changedFiles={[]} outputText="" />);
    expect(screen.queryByText('run.fileChanges')).not.toBeInTheDocument();
  });

  it('renders title', () => {
    const run = makeRun();
    render(<RunDetail run={run} toolCalls={[]} changedFiles={[]} outputText="" />);
    expect(screen.getByText('run.title')).toBeInTheDocument();
  });
});
