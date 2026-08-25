// #1967 run-level aggregate review entry — shard of the AgentHubWorkbench
// integration suite (#1763 split conventions). Shared vi.mock registration +
// suite hooks must stay the first import.
import { installWorkbenchTestHooks } from './helpers';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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
): TranscriptBlock {
  return {
    id,
    kind: 'file_change',
    author,
    path,
    action: lines.some((line) => line.type === 'del') ? 'modified' : 'created',
    lines,
    ...(runId ? {
      evidenceRefs: [{ id: `run-${runId}`, kind: 'run', label: `Run ${runId}`, status: 'running' }],
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
    // Web Hub-only boundary: no write-back surface here — honest notice.
    expect(screen.getByText(/此处仅供查看/)).toBeInTheDocument();
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
