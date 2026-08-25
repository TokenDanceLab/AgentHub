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

function fileChange(id: string, path: string, lines: Array<{ type: 'add' | 'del' | 'ctx'; content: string }>): TranscriptBlock {
  return {
    id,
    kind: 'file_change',
    author,
    path,
    action: lines.some((line) => line.type === 'del') ? 'modified' : 'created',
    lines,
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
      screen.getByRole('button', { name: '查看本次运行的全部变更（2 个文件）' }),
    ).toHaveTextContent('查看全部变更');
  });

  it('dedupes repeated changes of the same path to the latest state', () => {
    renderWorkbench([
      fileChange('fc-1', 'src/a.ts', [{ type: 'add', content: 'v1' }]),
      fileChange('fc-2', 'src/a.ts', [{ type: 'add', content: 'v2' }]),
    ]);
    expect(
      screen.getByRole('button', { name: '查看本次运行的全部变更（1 个文件）' }),
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
    expect(screen.queryByRole('button', { name: /查看全部变更|全部变更/ })).not.toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: '查看本次运行的全部变更（2 个文件）' }));

    const dialog = screen.getByRole('dialog', { name: '运行变更审查' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getAllByText('src/a.ts').length).toBeGreaterThan(0);
    // Web Hub-only boundary: no write-back surface here — honest notice.
    expect(screen.getByText(/聚合审查为只读/)).toBeInTheDocument();
    // Run-level toolbar with zh labels inside the aggregate view.
    expect(screen.getByText('本次运行的全部变更')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '整体批准' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '整体驳回' })).toBeInTheDocument();
  });

  it('run-level accept marks every file hunks as accepted without a second approval state', async () => {
    const user = userEvent.setup();
    renderWorkbench([
      fileChange('fc-1', 'src/a.ts', [{ type: 'add', content: 'export const a = 1;' }]),
      fileChange('fc-2', 'src/b.ts', [{ type: 'add', content: 'export const b = 2;' }]),
    ]);
    await user.click(screen.getByRole('button', { name: '查看本次运行的全部变更（2 个文件）' }));
    await user.click(screen.getByRole('button', { name: '整体批准' }));

    // The shared panel's existing hunk state machine commits both files —
    // switching tabs still shows the accepted state (per-file toolbar next).
    expect(screen.getAllByText('已接受').length).toBeGreaterThan(0);
    const dialog = screen.getByRole('dialog', { name: '运行变更审查' });
    const tabs = within(dialog).getByRole('tablist').querySelectorAll('[role="tab"]');
    await user.click(tabs[1]!);
    expect(screen.getAllByText('已接受').length).toBeGreaterThan(0);
  });

  it('closes the overlay and restores the transcript', async () => {
    const user = userEvent.setup();
    renderWorkbench([
      fileChange('fc-1', 'src/a.ts', [{ type: 'add', content: 'export const a = 1;' }]),
    ]);
    await user.click(screen.getByRole('button', { name: '查看本次运行的全部变更（1 个文件）' }));
    expect(screen.getByRole('dialog', { name: '运行变更审查' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '关闭运行变更审查' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
