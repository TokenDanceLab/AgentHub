import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import TeamRunDock from '@/components/TeamRunDock';
import type { AgentTeamOverview } from '@/api/agentTeamQueries';
import type { LocalOrchestrationStatus } from '@/utils/localOrchestration';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (!vars) return key;
      const varStr = Object.entries(vars)
        .map(([name, value]) => `${name}=${value}`)
        .join(', ');
      return `${key}(${varStr})`;
    },
  }),
}));

function makeOverview(): AgentTeamOverview {
  return {
    teams: [{
      id: 'team-1',
      name: 'Builder Review Team',
      members: [
        { id: 'member-1', team_id: 'team-1', role: 'supervisor' },
        { id: 'member-2', team_id: 'team-1', role: 'reviewer' },
      ],
    }],
    bundles: [{
      team: {
        id: 'team-1',
        name: 'Builder Review Team',
        members: [
          { id: 'member-1', team_id: 'team-1', role: 'supervisor' },
          { id: 'member-2', team_id: 'team-1', role: 'reviewer' },
        ],
      },
      runs: [{ id: 'run-1', team_id: 'team-1', status: 'running', trigger_message: 'Review Desktop orchestration.' }],
      latestRun: { id: 'run-1', team_id: 'team-1', status: 'running', trigger_message: 'Review Desktop orchestration.' },
    }],
    customAgents: [],
    selectedTeam: {
      id: 'team-1',
      name: 'Builder Review Team',
      members: [
        { id: 'member-1', team_id: 'team-1', role: 'supervisor' },
        { id: 'member-2', team_id: 'team-1', role: 'reviewer' },
      ],
    },
    selectedRun: { id: 'run-1', team_id: 'team-1', status: 'running', trigger_message: 'Review Desktop orchestration.' },
    state: {
      run_id: 'run-1',
      team_id: 'team-1',
      status: 'running',
      members: [
        { member_id: 'member-1', role: 'supervisor', active_tasks: 1, completed_tasks: 0 },
        { member_id: 'member-2', role: 'reviewer', active_tasks: 0, completed_tasks: 1 },
      ],
      tasks: [
        { task_id: 'task-1', status: 'running', objective: 'Build compact dock.' },
        { task_id: 'task-2', status: 'done', objective: 'Review dock.' },
      ],
      route_log: [{ action: 'delegate', next_worker: 'reviewer', instructions: 'Review the TeamRun dock.' }],
      approvals: [{ approval_id: 'approval-1', status: 'pending', reason: 'Needs command approval.' }],
      conflicts: [{ conflict_id: 'conflict-1', path: 'app.tsx', status: 'open' }],
      artifacts: [{ path: 'app.tsx', status: 'modified' }],
      budget: { usage_percent: 42 },
    },
    tasks: [],
    events: [],
  };
}

describe('TeamRunDock', () => {
  it('renders real TeamRun state and opens the existing console', () => {
    const onOpenConsole = vi.fn();
    render(<TeamRunDock overview={makeOverview()} signedIn onOpenConsole={onOpenConsole} />);

    const dock = screen.getByTestId('teamrun-dock');
    expect(within(dock).getByText('Builder Review Team')).toBeInTheDocument();
    expect(within(dock).getByText('Review the TeamRun dock.')).toBeInTheDocument();
    expect(within(dock).getByText('settings.teamRunStatus.running(defaultValue=running)')).toBeInTheDocument();
    expect(within(dock).getByText('chat.teamRunMembers: 2')).toBeInTheDocument();
    expect(within(dock).getByText('chat.teamRunTasks: 1/2')).toBeInTheDocument();
    expect(within(dock).getByText('chat.teamRunBlocks: 2')).toBeInTheDocument();
    expect(within(dock).getByText('chat.teamRunBudgetUsage(percent=42)')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('teamrun-dock-open-console'));
    expect(onOpenConsole).toHaveBeenCalledTimes(1);
  });

  it('shows the current Desktop bridge execution evidence in the chat dock', () => {
    render(
      <TeamRunDock
        overview={makeOverview()}
        signedIn
        localExecutions={[
          {
            id: 'agent:task-a',
            source: 'desktopBridge',
            status: 'running',
            title: 'Build compact dock.',
            runtimeLabel: 'codex',
            agentTaskId: 'task-a',
            edgeRunId: 'edge-run-1',
            hubTaskId: 'task-1',
            latestEventType: 'run.step.delta',
            eventCount: 3,
          },
        ]}
      />,
    );

    const row = screen.getByTestId('teamrun-dock-local-execution');
    expect(within(row).getByText('codex')).toBeInTheDocument();
    expect(within(row).getByText('settings.agentTeamLocalSource')).toBeInTheDocument();
    expect(within(row).getByText('settings.taskStatus.running(defaultValue=running)')).toBeInTheDocument();
    expect(within(row).getByText('settings.agentTeamHubTask: task-a')).toBeInTheDocument();
    expect(within(row).getByText('settings.agentTeamEdgeRun: edge-run-1')).toBeInTheDocument();
    expect(within(row).getByText('run.step.delta')).toBeInTheDocument();
    expect(within(row).getByText('settings.agentTeamLocalEvents(count=3)')).toBeInTheDocument();
  });

  it('starts local orchestration only when a real local orchestrator is available', () => {
    const onStartLocalOrchestration = vi.fn();
    const localOrchestration: LocalOrchestrationStatus = {
      available: true,
      orchestratorId: 'orchestrator',
      orchestratorName: 'Orchestrator',
      availableSubAgents: 3,
      selected: false,
    };

    render(
      <TeamRunDock
        signedIn={false}
        localOrchestration={localOrchestration}
        onStartLocalOrchestration={onStartLocalOrchestration}
      />,
    );

    expect(screen.getByText('chat.teamRunHubSyncSignedOut')).toBeInTheDocument();
    expect(screen.queryByText(/chat\.teamRunMembers/)).not.toBeInTheDocument();
    expect(screen.queryByText(/chat\.teamRunTasks/)).not.toBeInTheDocument();
    expect(screen.queryByText(/chat\.teamRunRoutes/)).not.toBeInTheDocument();
    expect(screen.queryByText(/chat\.teamRunArtifacts/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('teamrun-dock-local-orchestration'));
    expect(onStartLocalOrchestration).toHaveBeenCalledWith(
      'orchestrator',
      'home.localOrchestrationDraft(runtime=Orchestrator, count=3)',
    );
  });
});
