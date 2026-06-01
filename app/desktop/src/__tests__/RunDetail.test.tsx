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
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import RunDetail from '@/components/RunDetail';
import { RunState } from '@/utils/runStateMachine';
import type { RunInfo } from '@shared/types';

function makeRun(overrides: Partial<RunInfo> = {}): RunInfo {
  return {
    runId: 'run-test-001',
    projectId: 'proj-1',
    threadId: 'thread-1',
    status: RunState.RUNNING,
    ...overrides,
  };
}

describe('RunDetail', () => {
  it('renders empty state when run is null', () => {
    render(<RunDetail run={null} toolCalls={[]} changedFiles={[]} outputText="" />);
    expect(screen.getByText('run.empty')).toBeInTheDocument();
  });

  it('shows run status with color coding for running', () => {
    const run = makeRun({ status: RunState.RUNNING });
    render(<RunDetail run={run} toolCalls={[]} changedFiles={[]} outputText="" />);
    const statusEl = screen.getByText('run.status.RUNNING');
    expect(statusEl).toBeInTheDocument();
    expect(statusEl.className).toContain('statusRunning');
  });

  it('shows run status with color coding for completed', () => {
    const run = makeRun({ status: RunState.COMPLETED });
    render(<RunDetail run={run} toolCalls={[]} changedFiles={[]} outputText="" />);
    const statusEl = screen.getByText('run.status.COMPLETED');
    expect(statusEl).toBeInTheDocument();
    expect(statusEl.className).toContain('statusDone');
  });

  it('shows run status with color coding for failed', () => {
    const run = makeRun({ status: RunState.FAILED });
    render(<RunDetail run={run} toolCalls={[]} changedFiles={[]} outputText="" />);
    const statusEl = screen.getByText('run.status.FAILED');
    expect(statusEl).toBeInTheDocument();
    expect(statusEl.className).toContain('statusFailed');
  });

  it('shows cancelled status as failed style', () => {
    const run = makeRun({ status: RunState.CANCELLED });
    render(<RunDetail run={run} toolCalls={[]} changedFiles={[]} outputText="" />);
    const statusEl = screen.getByText('run.status.CANCELLED');
    expect(statusEl).toBeInTheDocument();
    expect(statusEl.className).toContain('statusFailed');
  });

  it('shows IDLE status in pending style', () => {
    const run = makeRun({ status: RunState.IDLE });
    render(<RunDetail run={run} toolCalls={[]} changedFiles={[]} outputText="" />);
    const statusEl = screen.getByText('run.status.IDLE');
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
    const run = makeRun({ status: RunState.COMPLETED });
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
    const run = makeRun({ status: RunState.RUNNING });
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
    const run = makeRun({ status: RunState.RUNNING });
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

  it('shows cancel button when running', () => {
    const run = makeRun({ status: RunState.RUNNING });
    const onCancel = () => {};
    render(
      <RunDetail
        run={run}
        toolCalls={[]}
        changedFiles={[]}
        outputText=""
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText('action.cancelRun')).toBeInTheDocument();
  });

  it('hides cancel button when completed', () => {
    const run = makeRun({ status: RunState.COMPLETED });
    render(
      <RunDetail
        run={run}
        toolCalls={[]}
        changedFiles={[]}
        outputText=""
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByText('action.cancelRun')).not.toBeInTheDocument();
  });

  it('renders runtime typed blocks from chat messages', () => {
    const run = makeRun({ status: RunState.RUNNING });
    render(
      <RunDetail
        run={run}
        toolCalls={[]}
        changedFiles={[]}
        outputText=""
        chatMessages={[
          {
            id: 'msg-1',
            role: 'agent',
            timestamp: '2026-01-01T00:00:00Z',
            blocks: [
              { kind: 'thinking', content: 'checking fixtures' },
              {
                kind: 'tool_use',
                callId: 'call-1',
                toolName: 'Bash',
                input: { command: 'pnpm test' },
                status: 'running',
              },
              {
                kind: 'file_change',
                path: 'src/App.tsx',
                action: 'modified',
                diff: '+hello',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText('run.runtimeBlocks')).toBeInTheDocument();
    expect(screen.getByText('run.block.thinking')).toBeInTheDocument();
    expect(screen.getByText('run.block.toolCall')).toBeInTheDocument();
    expect(screen.getByText('run.block.fileChange')).toBeInTheDocument();
    expect(screen.getByText('checking fixtures')).toBeInTheDocument();
  });

  it('shows approvals, artifact gap, preview gap, and approval failure state', async () => {
    const run = makeRun({ status: RunState.WAITING_FOR_INPUT });
    const onDecideApproval = async () => {
      throw new Error('edge rejected decision');
    };

    render(
      <RunDetail
        run={run}
        toolCalls={[]}
        changedFiles={[]}
        outputText=""
        approvals={[
          {
            requestId: 'perm-1',
            runId: run.runId,
            toolName: 'Bash',
            toolInput: { command: 'npm test' },
            timestamp: '2026-01-01T00:00:00Z',
          },
        ]}
        onDecideApproval={onDecideApproval}
      />,
    );

    expect(screen.getByText('run.reviewSurface')).toBeInTheDocument();
    expect(screen.getByText('run.reviewArtifactGap')).toBeInTheDocument();
    expect(screen.getByText('run.reviewPreviewGap')).toBeInTheDocument();
    expect(screen.getByText('run.reviewApprovalSource')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('run.reviewAllow'));
    await waitFor(() => expect(screen.getByText('run.reviewApprovalFailed')).toBeInTheDocument());
    expect(screen.getByLabelText('run.reviewAllow')).toBeInTheDocument();
    expect(screen.getByLabelText('run.reviewDeny')).toBeInTheDocument();
  });

  it('keeps approval pending and explains duplicate or expired Edge decisions', async () => {
    const run = makeRun({ status: RunState.WAITING_FOR_INPUT });
    const onDecideApproval = async () => {
      throw Object.assign(new Error('permission request not found'), {
        code: 'permission_request_not_found',
        status: 404,
      });
    };

    render(
      <RunDetail
        run={run}
        toolCalls={[]}
        changedFiles={[]}
        outputText=""
        approvals={[
          {
            requestId: 'perm-duplicate',
            runId: run.runId,
            toolName: 'Bash',
            toolInput: { command: 'npm test' },
            timestamp: '2026-01-01T00:00:00Z',
          },
        ]}
        onDecideApproval={onDecideApproval}
      />,
    );

    fireEvent.click(screen.getByLabelText('run.reviewDeny'));

    await waitFor(() => expect(screen.getByText('run.reviewApprovalAlreadyHandled')).toBeInTheDocument());
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByLabelText('run.reviewAllow')).toBeInTheDocument();
    expect(screen.getByLabelText('run.reviewDeny')).toBeInTheDocument();
  });

  it('shows real evidence sources and explicit artifact or preview gaps', () => {
    const run = makeRun({ status: RunState.WAITING_FOR_INPUT });

    render(
      <RunDetail
        run={run}
        toolCalls={[]}
        changedFiles={[]}
        outputText=""
        diffs={[{
          filePath: 'src/App.tsx',
          status: 'modified',
          additions: 1,
          deletions: 1,
          hunks: [{
            header: '@@ -1 +1 @@',
            lines: [
              { type: 'deleted', content: 'old' },
              { type: 'added', content: 'new' },
            ],
          }],
        }]}
        artifacts={[]}
        previews={[]}
        evidence={{
          diffs: [],
          artifacts: [],
          previews: [],
          diffLoading: false,
          artifactLoading: false,
          previewLoading: false,
          diffError: false,
          artifactError: true,
          previewError: true,
          diffSource: 'edge',
          artifactSource: 'none',
          previewSource: 'none',
        }}
      />,
    );

    expect(screen.getByText('run.reviewDiff')).toBeInTheDocument();
    expect(screen.getAllByText('run.reviewSourceEdge').length).toBeGreaterThan(0);
    expect(screen.getAllByText('src/App.tsx').length).toBeGreaterThan(0);
    expect(screen.getByText('run.reviewArtifactError')).toBeInTheDocument();
    expect(screen.getByText('run.reviewPreviewError')).toBeInTheDocument();
    expect(screen.getByText('run.reviewDiffSource(source=run.reviewSourceEdge)')).toBeInTheDocument();
  });
});
