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

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import RightInspector from '@/components/RightInspector';
import type { InspectorProps, TreeNode } from '@/components/RightInspector';
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

function makeProps(overrides: Partial<InspectorProps> = {}): InspectorProps {
  return {
    run: null,
    ...overrides,
  };
}

describe('RightInspector', () => {
  // ── Empty states ──

  it('renders the tab bar with five tabs', () => {
    render(<RightInspector {...makeProps()} />);
    expect(screen.getByTestId('tab-progress')).toBeInTheDocument();
    expect(screen.getByTestId('tab-taskPlan')).toBeInTheDocument();
    expect(screen.getByTestId('tab-toolTimeline')).toBeInTheDocument();
    expect(screen.getByTestId('tab-artifacts')).toBeInTheDocument();
    expect(screen.getByTestId('tab-workFolder')).toBeInTheDocument();
  });

  it('shows progress empty state by default', () => {
    render(<RightInspector {...makeProps()} />);
    expect(screen.getByTestId('inspector-progress-empty')).toBeInTheDocument();
    expect(screen.getByText('inspector.noRun')).toBeInTheDocument();
  });

  it('shows task plan empty state when switching to taskPlan tab', () => {
    render(<RightInspector {...makeProps()} />);
    fireEvent.click(screen.getByTestId('tab-taskPlan'));
    expect(screen.getByTestId('inspector-tasks-empty')).toBeInTheDocument();
    expect(screen.getByText('inspector.noTasks')).toBeInTheDocument();
  });

  it('shows tool timeline empty state when switching to toolTimeline tab', () => {
    render(<RightInspector {...makeProps()} />);
    fireEvent.click(screen.getByTestId('tab-toolTimeline'));
    expect(screen.getByTestId('inspector-tools-empty')).toBeInTheDocument();
    expect(screen.getByText('inspector.noToolCalls')).toBeInTheDocument();
  });

  it('shows artifacts empty state when switching to artifacts tab', () => {
    render(<RightInspector {...makeProps()} />);
    fireEvent.click(screen.getByTestId('tab-artifacts'));
    expect(screen.getByTestId('inspector-artifacts-empty')).toBeInTheDocument();
    expect(screen.getByText('inspector.noArtifacts')).toBeInTheDocument();
  });

  it('shows work folder empty state when switching to workFolder tab', () => {
    render(<RightInspector {...makeProps()} />);
    fireEvent.click(screen.getByTestId('tab-workFolder'));
    expect(screen.getByTestId('inspector-folder-empty')).toBeInTheDocument();
    expect(screen.getByText('inspector.noWorkspace')).toBeInTheDocument();
  });

  // ── Run progress states ──

  it('shows run status for an active run', () => {
    render(<RightInspector {...makeProps({ run: makeRun() })} />);
    expect(screen.getByTestId('inspector-progress')).toBeInTheDocument();
    expect(screen.getByText('run.status.running')).toBeInTheDocument();
    expect(screen.getByText('run-test-001')).toBeInTheDocument();
  });

  it('shows cancel button for active run', () => {
    const onCancel = vi.fn();
    render(<RightInspector {...makeProps({ run: makeRun(), onCancel })} />);
    const cancelBtn = screen.getByTestId('inspector-cancel');
    expect(cancelBtn).toBeInTheDocument();
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('hides cancel button for completed run', () => {
    render(<RightInspector {...makeProps({ run: makeRun({ status: RunState.COMPLETED }), onCancel: vi.fn() })} />);
    expect(screen.queryByTestId('inspector-cancel')).not.toBeInTheDocument();
  });

  it('shows completed status with done style', () => {
    render(<RightInspector {...makeProps({ run: makeRun({ status: RunState.COMPLETED }) })} />);
    const label = screen.getByText('run.status.completed');
    expect(label.className).toContain('statusDone');
  });

  it('shows failed status with failed style', () => {
    render(<RightInspector {...makeProps({ run: makeRun({ status: RunState.FAILED }) })} />);
    const label = screen.getByText('run.status.failed');
    expect(label.className).toContain('statusFailed');
  });

  it('shows pending approvals with allow/deny buttons', () => {
    const onDecideApproval = vi.fn();
    const run = makeRun({ status: RunState.WAITING_FOR_INPUT });
    render(
      <RightInspector
        {...makeProps({
          run,
          approvals: [{
            requestId: 'perm-1',
            runId: run.runId,
            toolName: 'Bash',
            toolInput: { command: 'npm test' },
            timestamp: '2026-01-01T00:00:00Z',
          }],
          onDecideApproval,
        })}
      />,
    );

    expect(screen.getByText('inspector.pendingApprovals')).toBeInTheDocument();
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByTestId('inspector-allow-perm-1')).toBeInTheDocument();
    expect(screen.getByTestId('inspector-deny-perm-1')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('inspector-allow-perm-1'));
    expect(onDecideApproval).toHaveBeenCalledWith('perm-1', 'allow');
  });

  // ── Task plan (team) states ──

  it('shows team name and task list', () => {
    render(
      <RightInspector
        {...makeProps({
          teamName: 'Builder Team',
          teamMembers: 3,
          tasks: [
            { taskId: 't-1', title: 'Build feature', status: 'running', assignee: 'Coder' },
            { taskId: 't-2', title: 'Review code', status: 'completed', assignee: 'Reviewer' },
            { taskId: 't-3', title: 'Deploy', status: 'pending' },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByTestId('tab-taskPlan'));

    expect(screen.getByText('Builder Team')).toBeInTheDocument();
    expect(screen.getByText('inspector.members(count=3)')).toBeInTheDocument();
    expect(screen.getByText('Build feature')).toBeInTheDocument();
    expect(screen.getByText('Review code')).toBeInTheDocument();
    expect(screen.getByText('Deploy')).toBeInTheDocument();
    expect(screen.getByText('Coder')).toBeInTheDocument();
    expect(screen.getByText('inspector.taskProgress(completed=1, total=3)')).toBeInTheDocument();
  });

  it('shows active and failed task counts', () => {
    render(
      <RightInspector
        {...makeProps({
          tasks: [
            { taskId: 't-1', title: 'Task A', status: 'running' },
            { taskId: 't-2', title: 'Task B', status: 'failed' },
            { taskId: 't-3', title: 'Task C', status: 'completed' },
          ],
          activeTaskCount: 1,
        })}
      />,
    );
    fireEvent.click(screen.getByTestId('tab-taskPlan'));

    expect(screen.getByText('inspector.activeTasks(count=1)')).toBeInTheDocument();
    expect(screen.getByText('inspector.failedTasks(count=1)')).toBeInTheDocument();
  });

  // ── Tool timeline states ──

  it('shows tool calls timeline', () => {
    render(
      <RightInspector
        {...makeProps({
          toolCalls: [
            { callId: 'c-1', toolName: 'read_file', status: 'completed', timestamp: new Date(Date.now() - 5000).toISOString(), durationMs: 120 },
            { callId: 'c-2', toolName: 'write_file', status: 'running', timestamp: new Date(Date.now() - 1000).toISOString() },
            { callId: 'c-3', toolName: 'Bash', status: 'completed', timestamp: new Date(Date.now() - 60000).toISOString(), durationMs: 4500 },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByTestId('tab-toolTimeline'));

    expect(screen.getByTestId('inspector-tools')).toBeInTheDocument();
    expect(screen.getByText('read_file')).toBeInTheDocument();
    expect(screen.getByText('write_file')).toBeInTheDocument();
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('120ms')).toBeInTheDocument();
    expect(screen.getByText('4500ms')).toBeInTheDocument();
    expect(screen.getByText('inspector.toolProgress(completed=2, total=3)')).toBeInTheDocument();
  });

  // ── Artifact states ──

  it('shows artifacts and changed files', () => {
    render(
      <RightInspector
        {...makeProps({
          artifacts: [
            { id: 'a-1', path: 'src/App.tsx', kind: 'code', createdAt: '2026-01-01T00:00:00Z' },
            { id: 'a-2', path: 'report.html', kind: 'html', createdAt: '2026-01-01T00:00:01Z' },
          ],
          diffs: [{
            filePath: 'src/App.tsx',
            status: 'modified',
            additions: 5,
            deletions: 2,
            hunks: [{ header: '@@ -1 +1 @@', lines: [] }],
          }],
        })}
      />,
    );
    fireEvent.click(screen.getByTestId('tab-artifacts'));

    expect(screen.getByTestId('inspector-artifacts')).toBeInTheDocument();
    expect(screen.getByText('report.html')).toBeInTheDocument();
    expect(screen.getAllByText('src/App.tsx').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('+5 -2')).toBeInTheDocument();
  });

  it('shows output text when present', () => {
    render(
      <RightInspector
        {...makeProps({ outputText: 'Build succeeded with 0 errors' })}
      />,
    );
    fireEvent.click(screen.getByTestId('tab-artifacts'));

    expect(screen.getByText('Build succeeded with 0 errors')).toBeInTheDocument();
  });

  it('shows changed files without diffs when no diffs available', () => {
    render(
      <RightInspector
        {...makeProps({
          changedFiles: [
            { path: 'src/index.ts', action: 'created', timestamp: '2026-01-01T00:00:00Z' },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByTestId('tab-artifacts'));

    expect(screen.getByText('src/index.ts')).toBeInTheDocument();
    expect(screen.getByText('created')).toBeInTheDocument();
  });

  // ── Work folder states ──

  it('shows work directory and file tree', () => {
    const tree: TreeNode[] = [
      {
        name: 'src',
        path: '/project/src',
        isDir: true,
        children: [
          { name: 'App.tsx', path: '/project/src/App.tsx', isDir: false },
          { name: 'utils', path: '/project/src/utils', isDir: true, children: [
            { name: 'helpers.ts', path: '/project/src/utils/helpers.ts', isDir: false },
          ]},
        ],
      },
      { name: 'package.json', path: '/project/package.json', isDir: false },
    ];
    const onFileSelect = vi.fn();

    render(
      <RightInspector
        {...makeProps({ workDir: '/project', fileTree: tree, onFileSelect })}
      />,
    );
    fireEvent.click(screen.getByTestId('tab-workFolder'));

    expect(screen.getByTestId('inspector-folder')).toBeInTheDocument();
    expect(screen.getByText('project')).toBeInTheDocument();
    expect(screen.getByText('App.tsx')).toBeInTheDocument();
    expect(screen.getByText('helpers.ts')).toBeInTheDocument();
    expect(screen.getByText('package.json')).toBeInTheDocument();

    fireEvent.click(screen.getByText('App.tsx'));
    expect(onFileSelect).toHaveBeenCalledWith('/project/src/App.tsx');
  });

  it('shows empty folder when workDir is set but tree is empty', () => {
    render(<RightInspector {...makeProps({ workDir: '/empty-project' })} />);
    fireEvent.click(screen.getByTestId('tab-workFolder'));

    expect(screen.getByTestId('inspector-folder')).toBeInTheDocument();
    expect(screen.getByText('inspector.emptyFolder')).toBeInTheDocument();
  });

  // ── Tab badges ──

  it('shows badge counts on tabs when data is present', () => {
    render(
      <RightInspector
        {...makeProps({
          run: makeRun({ status: RunState.WAITING_FOR_INPUT }),
          approvals: [{
            requestId: 'perm-1',
            runId: 'run-test-001',
            toolName: 'Bash',
            toolInput: {},
            timestamp: '2026-01-01T00:00:00Z',
          }],
          toolCalls: [
            { callId: 'c-1', toolName: 'read', status: 'completed', timestamp: '2026-01-01T00:00:00Z' },
          ],
          artifacts: [
            { id: 'a-1', path: 'f.ts', kind: 'code', createdAt: '2026-01-01T00:00:00Z' },
          ],
        })}
      />,
    );

    // Progress tab badge shows count
    const progressTab = screen.getByTestId('tab-progress');
    expect(progressTab.textContent).toContain('1');

    // Tool tab badge shows count
    const toolTab = screen.getByTestId('tab-toolTimeline');
    expect(toolTab.textContent).toContain('1');

    // Artifact tab badge shows count
    const artifactTab = screen.getByTestId('tab-artifacts');
    expect(artifactTab.textContent).toContain('1');
  });

  // ── Controlled tab ──

  it('supports controlled activeTab prop', () => {
    render(<RightInspector {...makeProps({ activeTab: 'artifacts' })} />);
    expect(screen.getByTestId('inspector-artifacts-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('inspector-progress-empty')).not.toBeInTheDocument();
  });

  it('calls onTabChange when tab is clicked', () => {
    const onTabChange = vi.fn();
    render(<RightInspector {...makeProps({ onTabChange })} />);
    fireEvent.click(screen.getByTestId('tab-toolTimeline'));
    expect(onTabChange).toHaveBeenCalledWith('toolTimeline');
  });
});
