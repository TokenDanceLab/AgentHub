// #1819 pending-approval reminder (badge/count + arrival toast) — shard of
// the AgentHubWorkbench integration suite (#1763 split conventions).
// Shared vi.mock registration + suite hooks must stay the first import.
import { installWorkbenchTestHooks } from './helpers';

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockPlatform } from '@shared/platform/createMockPlatform';
import type { TranscriptBlock } from '@shared/transcript/types';
import { AgentHubWorkbench } from '../AgentHubWorkbench';
import { workbenchAgents as agents } from '../workbenchTestFixtures';

installWorkbenchTestHooks();

const author = { id: 'edge', name: 'Edge', role: 'agent' as const };

function permissionRequest(id: string): TranscriptBlock {
  return {
    id,
    kind: 'permission_request',
    author,
    requestId: `req-${id}`,
    title: `Allow write ${id}`,
    status: 'pending',
    toolName: 'Write',
    risk: 'medium',
    reason: 'Sensitive file',
    createdAt: '2026-08-23T08:30:00.000Z',
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

describe('AgentHubWorkbench pending-approval reminder (#1819)', () => {
  it('shows the pending-approval badge with the aggregated count', () => {
    renderWorkbench([
      permissionRequest('req-1'),
      {
        id: 'group-1',
        kind: 'run_step_group',
        author,
        icon: 'run',
        title: 'Run',
        status: 'running',
        open: true,
        children: [permissionRequest('req-2')],
      },
    ]);
    expect(
      screen.getByRole('button', { name: '2 条审批等待处理，点击跳转' }),
    ).toHaveTextContent('待审批 2 条');
  });

  it('hides the badge when the transcript has no pending approval', () => {
    renderWorkbench([
      {
        id: 'done-1',
        kind: 'permission_result',
        author,
        requestId: 'req-done',
        title: 'Allowed',
        status: 'completed',
        decision: 'allow',
      },
    ]);
    expect(screen.queryByText(/待审批 0 条/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /审批等待处理/ })).not.toBeInTheDocument();
  });

  it('fires the arrival toast only on a net increase in the same conversation', async () => {
    const { rerender } = renderWorkbench([permissionRequest('req-1')]);
    expect(screen.queryByText(/收到 1 条新的审批请求/)).not.toBeInTheDocument();

    rerender(
      <AgentHubWorkbench
        agents={agents}
        platform={createMockPlatform({
          surface: 'desktop',
          conversations: [{ id: 'c1', title: '会话一', kind: 'direct' }],
        })}
        conversations={[
          { id: 'c1', title: '会话一', kind: 'direct', avatarLabel: '一' },
        ]}
        transcript={[permissionRequest('req-1'), permissionRequest('req-2')]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/收到 1 条新的审批请求/)).toBeInTheDocument();
    });
  });

  it('does not toast when the count stays the same (decide + arrive) or drops', async () => {
    const { rerender } = renderWorkbench([permissionRequest('req-1')]);
    rerender(
      <AgentHubWorkbench
        agents={agents}
        platform={createMockPlatform({
          surface: 'desktop',
          conversations: [{ id: 'c1', title: '会话一', kind: 'direct' }],
        })}
        conversations={[
          { id: 'c1', title: '会话一', kind: 'direct', avatarLabel: '一' },
        ]}
        transcript={[
          {
            id: 'done-1',
            kind: 'permission_result',
            author,
            requestId: 'req-done',
            title: 'Allowed',
            status: 'completed',
            decision: 'allow',
          },
          permissionRequest('req-2'),
        ]}
      />,
    );
    expect(screen.queryByText(/收到 新的审批请求/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '1 条审批等待处理，点击跳转' }),
    ).toHaveTextContent('待审批 1 条');
  });
});
