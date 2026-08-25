// #1967 run-level aggregate review entry — shard of the AgentHubWorkbench
// integration suite (#1763 split conventions). Shared vi.mock registration +
// suite hooks must stay the first import.
import { installWorkbenchTestHooks } from './helpers';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createMockPlatform } from '@shared/platform/createMockPlatform';
import type { TranscriptBlock } from '@shared/transcript/types';
import { AgentHubWorkbench } from '../AgentHubWorkbench';
import { workbenchAgents as agents } from '../workbenchTestFixtures';

installWorkbenchTestHooks();

const author = { id: 'edge', name: 'Edge', role: 'agent' as const };

function fileChange(
  id: string,
  path: string,
  lines: Array<{ type: 'add' | 'del' | 'ctx'; content: string }>,
  runId: string | null = 'run-latest',
  workDir?: string | undefined,
): TranscriptBlock {
  return {
    id,
    kind: 'file_change',
    author,
    path,
    action: lines.some((line) => line.type === 'del') ? 'modified' : 'created',
    lines,
    ...(runId ? {
      evidenceRefs: [{
        id: `run-${runId}`,
        kind: 'run',
        label: `Run ${runId}`,
        status: 'running',
        ...(workDir ? { workDir } : {}),
      }],
    } : {}),
  };
}

function renderWorkbench(transcript: TranscriptBlock[]) {
  const platform = createMockPlatform({
    surface: 'desktop',
    conversations: [{ id: 'c1', title: '会话一', kind: 'direct' }],
  });
  return render(
    <AgentHubWorkbench
      agents={agents}
      platform={platform}
      conversations={platform.seed.conversations}
      transcript={transcript}
    />,
  );
}

describe('AgentHubWorkbench run-level aggregate review (#1967)', () => {
  it('shows the view-all-changes entry with the aggregated file count', () => {
    renderWorkbench([
      fileChange('fc-1', 'src/a.ts', [{ type: 'add', content: 'export const a = 1;' }]),
      {
        id: 'group-1',
        kind: 'run_step_group',
        author,
        icon: 'run',
        title: 'Run',
        status: 'running',
        open: true,
        children: [
          fileChange('fc-2', 'src/b.ts', [{ type: 'add', content: 'export const b = 2;' }]),
        ],
      },
    ]);
    expect(
      screen.getByRole('button', { name: '只读查看最近运行的变更（2 个文件）' }),
    ).toHaveTextContent('查看最近运行变更');
  });

  it('dedupes repeated changes of the same path to the latest state', () => {
    renderWorkbench([
      fileChange('fc-1', 'src/a.ts', [{ type: 'add', content: 'v1' }]),
      fileChange('fc-2', 'src/a.ts', [{ type: 'add', content: 'v2' }]),
    ]);
    expect(
      screen.getByRole('button', { name: '只读查看最近运行的变更（1 个文件）' }),
    ).toBeInTheDocument();
  });

  it('hides the entry when the transcript has no file changes', () => {
    renderWorkbench([
      {
        id: 'text-1',
        kind: 'text',
        author: { id: 'user', name: 'You', role: 'human' },
        text: 'hello',
      },
    ]);
    expect(screen.queryByRole('button', { name: /查看最近运行变更|查看会话变更/ })).not.toBeInTheDocument();
  });

  it('opens the aggregate review overlay with every file and the honest read-only notice', async () => {
    const user = userEvent.setup();
    renderWorkbench([
      fileChange('fc-1', 'src/a.ts', [{ type: 'add', content: 'export const a = 1;' }]),
      fileChange('fc-2', 'src/b.ts', [
        { type: 'del', content: 'const old = true;' },
        { type: 'add', content: 'const next = false;' },
      ]),
    ]);
    await user.click(screen.getByRole('button', { name: '只读查看最近运行的变更（2 个文件）' }));

    const dialog = screen.getByRole('dialog', { name: '运行变更（只读）' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getAllByText('src/a.ts').length).toBeGreaterThan(0);
    // No executor-reported workDir in the evidence: honest read-only notice
    // instead of guessing a workspace.
    expect(screen.getByText(/执行器未上报该运行的工作目录/)).toBeInTheDocument();
    expect(screen.getByText('最近运行的变更')).toBeInTheDocument();
    // Transcript evidence has no trusted historical workDir: every write-back
    // action must be absent instead of locally faking applied/rejected state.
    expect(screen.queryByRole('button', { name: '整体批准' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '整体驳回' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '接受本文件' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '接受此块' })).not.toBeInTheDocument();
  });

  it('keeps two runs isolated and shows only the latest run files', async () => {
    const user = userEvent.setup();
    renderWorkbench([
      fileChange('old-1', 'src/old-only.ts', [{ type: 'add', content: 'old' }], 'old'),
      fileChange('old-2', 'src/shared.ts', [{ type: 'add', content: 'old shared' }], 'old'),
      fileChange('new-1', 'src/new-only.ts', [{ type: 'add', content: 'new' }], 'new'),
      fileChange('new-2', 'src/shared.ts', [{ type: 'add', content: 'new shared' }], 'new'),
    ]);

    await user.click(screen.getByRole('button', { name: '只读查看最近运行的变更（2 个文件）' }));
    const dialog = screen.getByRole('dialog', { name: '运行变更（只读）' });
    expect(within(dialog).queryByText('src/old-only.ts')).not.toBeInTheDocument();
    expect(within(dialog).getAllByText('src/new-only.ts').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('src/shared.ts').length).toBeGreaterThan(0);
  });

  it('labels legacy no-run events as a conversation compatibility view', async () => {
    const user = userEvent.setup();
    renderWorkbench([
      fileChange('legacy-1', 'src/a.ts', [{ type: 'add', content: 'a' }], null),
      fileChange('legacy-2', 'src/b.ts', [{ type: 'add', content: 'b' }], null),
    ]);

    await user.click(screen.getByRole('button', {
      name: '只读查看缺少运行标识的会话变更（2 个文件）',
    }));
    expect(screen.getByRole('dialog', { name: '会话变更兼容视图（只读）' })).toBeInTheDocument();
    expect(screen.getByText(/旧事件缺少运行标识/)).toBeInTheDocument();
    expect(screen.getByText('会话变更（无法按运行区分）')).toBeInTheDocument();
  });

  it('closes the overlay and restores the transcript', async () => {
    const user = userEvent.setup();
    renderWorkbench([
      fileChange('fc-1', 'src/a.ts', [{ type: 'add', content: 'export const a = 1;' }]),
    ]);
    await user.click(screen.getByRole('button', { name: '只读查看最近运行的变更（1 个文件）' }));
    expect(screen.getByRole('dialog', { name: '运行变更（只读）' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '关闭变更查看' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

function renderWorkbenchWithApplyPort(
  transcript: TranscriptBlock[],
  opts: { omitApplyPort?: boolean } = {},
) {
  const applyRunDiff = vi.fn(async (): Promise<void> => {});
  const applyAllRunDiffs = vi.fn(async (): Promise<void> => {});
  const platform = createMockPlatform({
    surface: 'desktop',
    conversations: [{ id: 'c1', title: '会话一', kind: 'direct' }],
    preview: {
      openEvidence: async (): Promise<void> => {},
      ...(opts.omitApplyPort ? {} : { applyRunDiff, applyAllRunDiffs }),
    },
  });
  const view = render(
    <AgentHubWorkbench
      agents={agents}
      platform={platform}
      conversations={platform.seed.conversations}
      transcript={transcript}
    />,
  );
  return { view, applyRunDiff, applyAllRunDiffs };
}

describe('AgentHubWorkbench run-level apply wiring (#1967 remainder)', () => {
  const addLine = [{ type: 'add' as const, content: 'export const a = 1;' }];

  it('accept-run writes every hunk back through the port with the trusted workDir', async () => {
    const user = userEvent.setup();
    const { applyAllRunDiffs } = renderWorkbenchWithApplyPort([
      fileChange('fc-1', 'src/a.ts', addLine, 'run-latest', '/tmp/ws-run'),
    ]);

    await user.click(screen.getByRole('button', { name: '审查最近运行的变更（1 个文件）' }));
    const dialog = screen.getByRole('dialog', { name: '运行变更' });
    expect(dialog).toBeInTheDocument();
    // Trusted workDir + apply port: no read-only notice, run actions visible.
    expect(screen.queryByText(/执行器未上报该运行的工作目录/)).not.toBeInTheDocument();
    expect(screen.queryByText(/当前表面不直连本地执行环境/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '整体批准' }));

    expect(applyAllRunDiffs).toHaveBeenCalledTimes(1);
    expect(applyAllRunDiffs).toHaveBeenCalledWith({
      runId: 'run-latest',
      workDir: '/tmp/ws-run',
      decisions: [{ filePath: 'src/a.ts', hunkIndex: 0, accepted: true }],
    });
    // Success closes the overlay.
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('reject-run commits every hunk as rejected and closes the overlay', async () => {
    const user = userEvent.setup();
    const { applyAllRunDiffs } = renderWorkbenchWithApplyPort([
      fileChange('fc-1', 'src/a.ts', addLine, 'run-latest', '/tmp/ws-run'),
    ]);

    await user.click(screen.getByRole('button', { name: '审查最近运行的变更（1 个文件）' }));
    await user.click(screen.getByRole('button', { name: '整体驳回' }));

    expect(applyAllRunDiffs).toHaveBeenCalledWith({
      runId: 'run-latest',
      workDir: '/tmp/ws-run',
      decisions: [{ filePath: 'src/a.ts', hunkIndex: 0, accepted: false }],
    });
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('single-hunk accept uses the trusted workDir on the per-hunk port', async () => {
    const user = userEvent.setup();
    const { applyRunDiff } = renderWorkbenchWithApplyPort([
      fileChange('fc-1', 'src/a.ts', addLine, 'run-latest', '/tmp/ws-run'),
    ]);

    await user.click(screen.getByRole('button', { name: '审查最近运行的变更（1 个文件）' }));
    const dialog = screen.getByRole('dialog', { name: '运行变更' });
    // One accept control per hunk row plus the aria-labelled twin; take the
    // first rendered hunk-row action.
    const [acceptHunk] = within(dialog).getAllByRole('button', { name: '接受此块' });
    await user.click(acceptHunk);

    expect(applyRunDiff).toHaveBeenCalledWith({
      runId: 'run-latest',
      workDir: '/tmp/ws-run',
      decision: { filePath: 'src/a.ts', hunkIndex: 0, accepted: true },
    });
  });

  it('stays read-only with the Hub-only notice when the platform has no apply port', async () => {
    const user = userEvent.setup();
    renderWorkbenchWithApplyPort([
      fileChange('fc-1', 'src/a.ts', addLine, 'run-latest', '/tmp/ws-run'),
    ], { omitApplyPort: true });

    await user.click(screen.getByRole('button', { name: '只读查看最近运行的变更（1 个文件）' }));
    expect(screen.getByRole('dialog', { name: '运行变更（只读）' })).toBeInTheDocument();
    expect(screen.getByText(/当前表面不直连本地执行环境/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '整体批准' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '接受此块' })).not.toBeInTheDocument();
  });

  it('legacy conversation scope never becomes applicable even with a port', async () => {
    const user = userEvent.setup();
    const { applyAllRunDiffs } = renderWorkbenchWithApplyPort([
      fileChange('legacy-1', 'src/a.ts', addLine, null),
    ]);

    await user.click(screen.getByRole('button', {
      name: '只读查看缺少运行标识的会话变更（1 个文件）',
    }));
    expect(screen.getByRole('dialog', { name: '会话变更兼容视图（只读）' })).toBeInTheDocument();
    expect(screen.getByText(/旧事件缺少运行标识/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '整体批准' })).not.toBeInTheDocument();
    expect(applyAllRunDiffs).not.toHaveBeenCalled();
  });
});
