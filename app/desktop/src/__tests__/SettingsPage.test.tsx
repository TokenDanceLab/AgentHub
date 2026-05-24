import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import SettingsPage from '@/components/SettingsPage';
import type { AgentInfo, RunInfo } from '@shared/types';
import type { AgentTask } from '@/stores/taskBridgeStore';

const { mockAgents, mockRuns, mockTasks } = vi.hoisted(() => ({
  mockAgents: [] as AgentInfo[],
  mockRuns: [] as RunInfo[],
  mockTasks: [] as AgentTask[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (vars?.defaultValue) return String(vars.defaultValue);
      if (key === 'settings.runnerSummary') return `${vars?.available}/${vars?.total} runners`;
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({
    themeMode: 'dark',
    setThemeMode: vi.fn(),
    theme: 'dark',
    toggleTheme: vi.fn(),
  }),
}));

vi.mock('@/hooks/useHealth', () => ({
  useHealth: () => ({
    online: true,
    health: {
      status: 'ok',
      checks: {
        runners: {
          total: 1,
          available: 1,
          items: [{ id: 'codex', name: 'Codex Runner', status: 'online', capabilities: ['codex'] }],
        },
      },
    },
  }),
}));

vi.mock('@/api/agentQueries', () => ({
  useAgentList: () => ({ data: { items: mockAgents } }),
}));

vi.mock('@/api/runQueries', () => ({
  useRuns: () => ({
    data: { items: mockRuns, page: { hasMore: false } },
    isError: false,
    isLoading: false,
  }),
}));

vi.mock('@/stores/taskBridgeStore', () => ({
  useTaskBridgeStore: (selector: (state: { tasks: AgentTask[] }) => unknown) => selector({ tasks: mockTasks }),
}));

vi.mock('@/stores/hubStore', () => ({
  useHubStore: (selector: (state: { authenticated: boolean; username: string; clear: () => void }) => unknown) =>
    selector({ authenticated: true, username: 'TokenDance User', clear: vi.fn() }),
}));

describe('SettingsPage tasks', () => {
  beforeEach(() => {
    mockAgents.splice(0, mockAgents.length);
    mockRuns.splice(0, mockRuns.length);
    mockTasks.splice(0, mockTasks.length);
  });

  it('renders local runs and bridged Hub tasks', () => {
    mockRuns.splice(0, mockRuns.length, {
      runId: 'run_1234567890abcdef',
      projectId: 'proj_local',
      threadId: 'thread_local',
      status: 'started',
      createdAt: '2026-05-25T01:00:00Z',
      startedAt: '2026-05-25T01:01:00Z',
    });
    mockTasks.splice(0, mockTasks.length, {
      taskId: 'task_abcdef1234567890',
      agentId: 'agent-codex',
      prompt: 'Dispatch from TokenDance Hub',
      threadId: 'thread_local',
      runId: 'run_1234567890abcdef',
      status: 'running',
      dispatchPayload: {},
      createdAt: '2026-05-25T01:02:00Z',
    });

    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="tasks" />);

    expect(screen.getByText('settings.taskLocalRuns')).toBeInTheDocument();
    expect(screen.getByText('settings.taskHubBridge')).toBeInTheDocument();
    expect(screen.getByText('proj_local / thread_local')).toBeInTheDocument();
    expect(screen.getByText('Dispatch from TokenDance Hub')).toBeInTheDocument();
    expect(screen.getByText('agent-codex')).toBeInTheDocument();
  });

  it('renders scheduler readiness from runs, profiles, targets, and policy inputs', () => {
    mockAgents.splice(0, mockAgents.length, {
      id: 'codex',
      name: 'Codex',
      description: 'Local Codex runtime',
      status: 'available',
      capabilities: {
        streaming: true,
        toolCalls: true,
        fileChanges: true,
        thinkingVisible: true,
        multiTurn: true,
      },
    });
    mockRuns.splice(0, mockRuns.length, {
      runId: 'run_scheduler_local',
      projectId: 'proj_scheduler',
      threadId: 'thread_scheduler',
      status: 'started',
      createdAt: '2026-05-25T01:00:00Z',
      startedAt: '2026-05-25T01:01:00Z',
    });
    mockTasks.splice(0, mockTasks.length, {
      taskId: 'task_scheduler_hub',
      agentId: 'agent-codex',
      prompt: 'Schedule this from TokenDance Hub',
      threadId: 'thread_scheduler',
      runId: 'run_scheduler_local',
      status: 'running',
      dispatchPayload: {},
      createdAt: '2026-05-25T01:02:00Z',
    });

    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="agentScheduling" />);

    expect(screen.getByText('settings.schedulerQueueLive')).toBeInTheDocument();
    expect(screen.getByText('settings.schedulerProfiles')).toBeInTheDocument();
    expect(screen.getAllByText('settings.schedulerTargets').length).toBeGreaterThan(0);
    expect(screen.getByText('settings.schedulerPolicyReady')).toBeInTheDocument();
    expect(screen.getByText('proj_scheduler / thread_scheduler')).toBeInTheDocument();
    expect(screen.getByText('Schedule this from TokenDance Hub')).toBeInTheDocument();
    expect(screen.getByText('settings.schedulerRouteLocal')).toBeInTheDocument();
    expect(screen.getByText('settings.schedulerPolicyModelMapping')).toBeInTheDocument();
    expect(screen.getByText('settings.schedulerGuard')).toBeInTheDocument();
  });

  it('renders agent market readiness from local profiles and capabilities', () => {
    mockAgents.splice(0, mockAgents.length, {
      id: 'codex',
      name: 'Codex',
      description: 'Local Codex runtime',
      status: 'available',
      capabilities: {
        streaming: true,
        toolCalls: true,
        fileChanges: true,
        thinkingVisible: false,
        multiTurn: true,
      },
    });

    render(<SettingsPage onBack={vi.fn()} onOpenAuth={vi.fn()} initialSection="agentMarket" />);

    expect(screen.getByText('settings.marketLocalProfiles')).toBeInTheDocument();
    expect(screen.getByText('settings.marketPublishReady')).toBeInTheDocument();
    expect(screen.getByText('settings.marketInstalledProfiles')).toBeInTheDocument();
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByText('streaming')).toBeInTheDocument();
    expect(screen.getByText('toolCalls')).toBeInTheDocument();
    expect(screen.getByText('settings.marketTokenDancePublish')).toBeInTheDocument();
    expect(screen.getByText('settings.marketGuard')).toBeInTheDocument();
  });
});
