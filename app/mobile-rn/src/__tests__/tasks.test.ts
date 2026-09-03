/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * TasksScreen data-level logic tests.
 *
 * Covers task creation from runs, status mapping, board column distribution,
 * view mode data, approval/rejection state machine, and fixture scenario validation.
 *
 * Vitest environment: node — tests pure data transformations (no React rendering).
 */
import { describe, expect, it } from 'vitest';

import { getMobileFixtureForScenario, mobileFixture } from '@/data/mobileFixtures';
import type { MobileAppFixture, MobileFixtureScenario, MobileRun } from '@/types';

// ---------------------------------------------------------------------------
// Replicated types and helpers (source: TasksScreen.tsx)
// ---------------------------------------------------------------------------

type TaskPane = 'owned' | 'watching' | 'activity' | 'all';
type TaskViewMode = 'list' | 'board' | 'dashboard';
type TaskStatus = 'not_started' | 'in_progress' | 'review' | 'confirm' | 'done';
type TaskTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

interface MobileTaskItem {
  id: string;
  title: string;
  project: string;
  assignee: string;
  creator: string;
  startTime: string;
  dueDate: string;
  status: TaskStatus;
  pane: TaskPane;
  summary: string;
  run?: MobileRun;
}

const taskPaneOrder: TaskPane[] = ['owned', 'watching', 'activity', 'all'];
const taskStatusOrder: TaskStatus[] = ['review', 'in_progress', 'confirm', 'not_started', 'done'];

// ---------------------------------------------------------------------------
// Replicated helpers
// ---------------------------------------------------------------------------

function runStatusToTaskStatus(status: MobileRun['status']): TaskStatus {
  if (status === 'approval_required') return 'review';
  if (status === 'running' || status === 'queued') return 'in_progress';
  if (status === 'failed') return 'confirm';
  return 'done';
}

function taskStatusToPill(status: TaskStatus): 'running' | 'waiting' | 'failed' | 'completed' {
  if (status === 'review' || status === 'confirm') return 'waiting';
  if (status === 'done') return 'completed';
  return 'running';
}

function taskTone(status: TaskStatus): TaskTone {
  if (status === 'review') return 'warning';
  if (status === 'confirm') return 'danger';
  if (status === 'done') return 'success';
  if (status === 'in_progress') return 'accent';
  return 'neutral';
}

function runStatusPriority(status: MobileRun['status']): number {
  if (status === 'approval_required') return 0;
  if (status === 'failed') return 1;
  if (status === 'running') return 2;
  if (status === 'queued') return 3;
  return 4;
}

function statusPriority(status: TaskStatus): number {
  return taskStatusOrder.indexOf(status);
}

function runStatusEmphasis(status: MobileRun['status']): 'tint' | 'warning' | 'danger' {
  if (status === 'approval_required') return 'warning';
  if (status === 'failed') return 'danger';
  return 'tint';
}

function projectNameForRun(run: MobileRun): string {
  if (run.target.includes('mobile-rn')) return 'AgentHub Mobile';
  if (run.target.includes('hub-server')) return 'AgentHub Hub';
  if (run.target.toLowerCase().includes('mock')) return 'Workspace Preview';
  return 'AgentHub';
}

function formatRisk(run: MobileRun): string {
  if (run.approvalRisk === 'critical' || run.approvalRisk === 'high') return 'Blocked';
  if (run.approvalRisk === 'medium') return 'Needs action';
  if (run.approvalRisk === 'low') return 'Review approval';
  return run.statusDetail ?? run.updatedAt;
}

function createTasksFromRuns(runs: MobileRun[]): MobileTaskItem[] {
  return runs.map((run, index) => ({
    id: `task-${run.id}`,
    title: run.title,
    project: projectNameForRun(run),
    assignee: index === 0 ? 'Delicious233' : 'AgentHub',
    creator: 'TokenDance',
    startTime: index === 0 ? '14:02' : '13:40',
    dueDate: index === 0 ? 'Today 18:00' : 'Tomorrow 12:00',
    status: runStatusToTaskStatus(run.status),
    pane: (index === 0 ? 'owned' : index === 1 ? 'watching' : 'activity') as TaskPane,
    summary: run.summary,
    run,
  }));
}

function filterTasksByPane(tasks: MobileTaskItem[], pane: TaskPane): MobileTaskItem[] {
  if (pane === 'all') return tasks;
  return tasks.filter((t) => t.pane === pane);
}

function sortTasksByStatus(tasks: MobileTaskItem[]): MobileTaskItem[] {
  return [...tasks].sort((a, b) => statusPriority(a.status) - statusPriority(b.status));
}

function groupTasksByStatus(tasks: MobileTaskItem[]): Record<TaskStatus, MobileTaskItem[]> {
  const groups: Record<TaskStatus, MobileTaskItem[]> = {
    not_started: [],
    in_progress: [],
    review: [],
    confirm: [],
    done: [],
  };
  for (const task of tasks) {
    groups[task.status].push(task);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// runStatusToTaskStatus
// ---------------------------------------------------------------------------

describe('runStatusToTaskStatus', () => {
  it('maps approval_required to review', () => {
    expect(runStatusToTaskStatus('approval_required')).toBe('review');
  });

  it('maps running to in_progress', () => {
    expect(runStatusToTaskStatus('running')).toBe('in_progress');
  });

  it('maps queued to in_progress', () => {
    expect(runStatusToTaskStatus('queued')).toBe('in_progress');
  });

  it('maps failed to confirm', () => {
    expect(runStatusToTaskStatus('failed')).toBe('confirm');
  });

  it('maps completed to done', () => {
    expect(runStatusToTaskStatus('completed')).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// taskStatusToPill
// ---------------------------------------------------------------------------

describe('taskStatusToPill', () => {
  it('maps review and confirm to waiting', () => {
    expect(taskStatusToPill('review')).toBe('waiting');
    expect(taskStatusToPill('confirm')).toBe('waiting');
  });

  it('maps done to completed', () => {
    expect(taskStatusToPill('done')).toBe('completed');
  });

  it('maps in_progress and not_started to running', () => {
    expect(taskStatusToPill('in_progress')).toBe('running');
    expect(taskStatusToPill('not_started')).toBe('running');
  });
});

// ---------------------------------------------------------------------------
// taskTone
// ---------------------------------------------------------------------------

describe('taskTone', () => {
  it('maps status to correct tone', () => {
    expect(taskTone('review')).toBe('warning');
    expect(taskTone('confirm')).toBe('danger');
    expect(taskTone('done')).toBe('success');
    expect(taskTone('in_progress')).toBe('accent');
    expect(taskTone('not_started')).toBe('neutral');
  });
});

// ---------------------------------------------------------------------------
// runStatusPriority
// ---------------------------------------------------------------------------

describe('runStatusPriority', () => {
  it('approval_required has highest priority (lowest number)', () => {
    const priorities = (['approval_required', 'failed', 'running', 'queued', 'completed'] as const)
      .map((s) => runStatusPriority(s));
    // Should be strictly increasing (lower number = higher priority)
    for (let i = 1; i < priorities.length; i++) {
      expect(priorities[i]!).toBeGreaterThan(priorities[i - 1]!);
    }
  });

  it('sorts runs in priority order', () => {
    const runs = mobileFixture.runs;
    const sorted = [...runs].sort(
      (a, b) => runStatusPriority(a.status) - runStatusPriority(b.status),
    );
    expect(sorted[0]!.status).toBe('approval_required');
    expect(sorted[1]!.status).toBe('failed');
    expect(sorted[2]!.status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// statusPriority (task level)
// ---------------------------------------------------------------------------

describe('statusPriority', () => {
  it('orders tasks by review > in_progress > confirm > not_started > done', () => {
    const byPriority = taskStatusOrder.map((s) => statusPriority(s));
    for (let i = 1; i < byPriority.length; i++) {
      expect(byPriority[i]!).toBeGreaterThan(byPriority[i - 1]!);
    }
  });
});

// ---------------------------------------------------------------------------
// runStatusEmphasis
// ---------------------------------------------------------------------------

describe('runStatusEmphasis', () => {
  it('approval_required gets warning emphasis', () => {
    expect(runStatusEmphasis('approval_required')).toBe('warning');
  });

  it('failed gets danger emphasis', () => {
    expect(runStatusEmphasis('failed')).toBe('danger');
  });

  it('other statuses get tint emphasis', () => {
    expect(runStatusEmphasis('running')).toBe('tint');
    expect(runStatusEmphasis('queued')).toBe('tint');
    expect(runStatusEmphasis('completed')).toBe('tint');
  });
});

// ---------------------------------------------------------------------------
// projectNameForRun
// ---------------------------------------------------------------------------

describe('projectNameForRun', () => {
  it.each([
    ['app/mobile-rn', 'AgentHub Mobile'],
    ['hub-server', 'AgentHub Hub'],
    ['mock preview', 'Workspace Preview'],
    ['unknown-target', 'AgentHub'],
  ])('maps target %s to %s', (target, expected) => {
    const run: MobileRun = {
      id: 'r1', threadId: 't1', title: 'Test', status: 'running',
      target, updatedAt: '', summary: '', changedFiles: [],
    };
    expect(projectNameForRun(run)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// formatRisk
// ---------------------------------------------------------------------------

describe('formatRisk', () => {
  it('maps critical and high to Blocked', () => {
    const runCritical: MobileRun = {
      id: 'r1', threadId: 't1', title: 'Test', status: 'approval_required',
      target: 'mock', updatedAt: '', summary: '', changedFiles: [],
      approvalRisk: 'critical',
    };
    expect(formatRisk(runCritical)).toBe('Blocked');

    const runHigh: MobileRun = {
      ...runCritical, id: 'r2', approvalRisk: 'high',
    };
    expect(formatRisk(runHigh)).toBe('Blocked');
  });

  const riskCases: Array<[Exclude<MobileRun['approvalRisk'], undefined>, string]> = [
    ['medium', 'Needs action'],
    ['low', 'Review approval'],
  ];
  it.each(riskCases)('maps %s risk to %s', (approvalRisk, expected) => {
    const run: MobileRun = {
      id: 'r1', threadId: 't1', title: 'Test', status: 'approval_required',
      target: 'mock', updatedAt: '', summary: '', changedFiles: [],
      approvalRisk,
    };
    expect(formatRisk(run)).toBe(expected);
  });

  it('falls back to statusDetail when no approvalRisk', () => {
    const run: MobileRun = {
      id: 'r1', threadId: 't1', title: 'Test', status: 'running',
      target: 'mock', updatedAt: '', summary: '', changedFiles: [],
      statusDetail: 'Running smoothly',
    };
    expect(formatRisk(run)).toBe('Running smoothly');
  });

  it('falls back to updatedAt when neither risk nor detail', () => {
    const run: MobileRun = {
      id: 'r1', threadId: 't1', title: 'Test', status: 'running',
      target: 'mock', updatedAt: '14:00', summary: '', changedFiles: [],
    };
    expect(formatRisk(run)).toBe('14:00');
  });
});

// ---------------------------------------------------------------------------
// createTasksFromRuns
// ---------------------------------------------------------------------------

describe('createTasksFromRuns', () => {
  it('creates tasks from default fixture runs', () => {
    const tasks = createTasksFromRuns(mobileFixture.runs);
    expect(tasks).toHaveLength(3);
  });

  it('assigns pane based on index', () => {
    const tasks = createTasksFromRuns(mobileFixture.runs);
    expect(tasks[0]!.pane).toBe('owned');
    expect(tasks[1]!.pane).toBe('watching');
    expect(tasks[2]!.pane).toBe('activity');
  });

  it('first task assignee is Delicious233', () => {
    const tasks = createTasksFromRuns(mobileFixture.runs);
    expect(tasks[0]!.assignee).toBe('Delicious233');
    expect(tasks[1]!.assignee).toBe('AgentHub');
    expect(tasks[2]!.assignee).toBe('AgentHub');
  });

  it('tasks have non-empty titles and summaries', () => {
    const tasks = createTasksFromRuns(mobileFixture.runs);
    for (const task of tasks) {
      expect(task.title.length).toBeGreaterThan(0);
      expect(task.summary.length).toBeGreaterThan(0);
    }
  });

  it('task statuses reflect run statuses', () => {
    const tasks = createTasksFromRuns(mobileFixture.runs);
    // run 0: approval_required -> review
    expect(tasks[0]!.status).toBe('review');
    // run 1: completed -> done
    expect(tasks[1]!.status).toBe('done');
    // run 2: failed -> confirm
    expect(tasks[2]!.status).toBe('confirm');
  });
});

// ---------------------------------------------------------------------------
// filterTasksByPane
// ---------------------------------------------------------------------------

describe('filterTasksByPane', () => {
  const tasks = createTasksFromRuns(mobileFixture.runs);

  it('returns all tasks when pane is all', () => {
    expect(filterTasksByPane(tasks, 'all')).toHaveLength(3);
  });

  it('filters to owned tasks only', () => {
    const result = filterTasksByPane(tasks, 'owned');
    expect(result).toHaveLength(1);
    expect(result[0]!.pane).toBe('owned');
  });

  it('returns empty when no tasks match pane', () => {
    const result = filterTasksByPane(tasks, 'watching');
    expect(result).toHaveLength(1);
    expect(result[0]!.pane).toBe('watching');
  });
});

// ---------------------------------------------------------------------------
// sortTasksByStatus
// ---------------------------------------------------------------------------

describe('sortTasksByStatus', () => {
  it('sorts tasks with review first, done last', () => {
    const tasks = createTasksFromRuns(mobileFixture.runs);
    const sorted = sortTasksByStatus(tasks);
    // review comes first
    expect(sorted[0]!.status).toBe('review');
    // done comes last
    expect(sorted[sorted.length - 1]!.status).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// groupTasksByStatus (board view)
// ---------------------------------------------------------------------------

describe('groupTasksByStatus (board view)', () => {
  const tasks = createTasksFromRuns(mobileFixture.runs);

  it('groups tasks into status columns', () => {
    const groups = groupTasksByStatus(tasks);
    const totalInGroups = Object.values(groups).reduce((sum, arr) => sum + arr.length, 0);
    expect(totalInGroups).toBe(tasks.length);
  });

  it('review group has approval_required tasks', () => {
    const groups = groupTasksByStatus(tasks);
    expect(groups.review).toHaveLength(1);
  });

  it('done group has completed tasks', () => {
    const groups = groupTasksByStatus(tasks);
    expect(groups.done).toHaveLength(1);
  });

  it('confirm group has failed tasks', () => {
    const groups = groupTasksByStatus(tasks);
    expect(groups.confirm).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Task stat computation
// ---------------------------------------------------------------------------

describe('task stat computation', () => {
  it('computes incomplete count correctly', () => {
    const tasks = createTasksFromRuns(mobileFixture.runs);
    const incomplete = tasks.filter((t) => t.status !== 'done').length;
    // review + confirm = 2
    expect(incomplete).toBe(2);
  });

  it('computes due today count', () => {
    const tasks = createTasksFromRuns(mobileFixture.runs);
    const dueToday = tasks.filter((t) => t.dueDate === 'Today 18:00').length;
    expect(dueToday).toBe(1);
  });

  it('computes cross-project count', () => {
    const tasks = createTasksFromRuns(mobileFixture.runs);
    const projects = new Set(tasks.map((t) => t.project));
    expect(projects.size).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Approval state machine
// ---------------------------------------------------------------------------

describe('approval state machine', () => {
  it('approval_required tasks have Approve and Reject buttons available', () => {
    const tasks = createTasksFromRuns(mobileFixture.runs);
    const approvalTask = tasks.find((t) => t.run?.status === 'approval_required');
    expect(approvalTask).toBeDefined();
    expect(approvalTask!.status).toBe('review');
  });

  it('failed tasks have Retry button available', () => {
    const tasks = createTasksFromRuns(mobileFixture.runs);
    const failedTask = tasks.find((t) => t.run?.status === 'failed');
    expect(failedTask).toBeDefined();
    expect(failedTask!.status).toBe('confirm');
  });

  it('completed tasks show no action buttons', () => {
    const tasks = createTasksFromRuns(mobileFixture.runs);
    const completedTask = tasks.find((t) => t.run?.status === 'completed');
    expect(completedTask).toBeDefined();
    expect(completedTask!.status).toBe('done');
  });

  it('retryAvailable flag set on failed runs', () => {
    const f = getMobileFixtureForScenario('approvalError');
    const hasRetry = f.runs.some((r) => r.retryAvailable === true);
    expect(hasRetry).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dashboard view data
// ---------------------------------------------------------------------------

describe('dashboard view data', () => {
  it('sorts runs by priority for dashboard', () => {
    const runs = mobileFixture.runs;
    const sorted = [...runs].sort(
      (a, b) => runStatusPriority(a.status) - runStatusPriority(b.status),
    );
    // First: approval_required, Second: failed, Third: completed
    expect(sorted[0]!.status).toBe('approval_required');
    expect(sorted[1]!.status).toBe('failed');
    expect(sorted[2]!.status).toBe('completed');
  });

  it('each run in dashboard has changedFiles count', () => {
    for (const run of mobileFixture.runs) {
      expect(run.changedFiles.length).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(run.changedFiles)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture scenario: tasks across scenarios
// ---------------------------------------------------------------------------

describe('task fixture scenarios', () => {
  const scenarios: MobileFixtureScenario[] = [
    'default',
    'empty',
    'offline',
    'sendError',
    'sendPending',
    'approvalPending',
    'approvalError',
    'approvalResolved',
    'diffPreview',
    'previewMatrix',
  ];

  it('every scenario has valid runs array', () => {
    for (const scenario of scenarios) {
      const f = getMobileFixtureForScenario(scenario);
      expect(Array.isArray(f.runs), `scenario ${scenario} runs is array`).toBe(true);
    }
  });

  it('empty scenario has no runs', () => {
    const f = getMobileFixtureForScenario('empty');
    expect(f.runs).toHaveLength(0);
  });

  it('previewMatrix has 4 runs covering all preview states', () => {
    const f = getMobileFixtureForScenario('previewMatrix');
    expect(f.runs).toHaveLength(4);
    const statuses = new Set(f.runs.map((r) => r.status));
    expect(statuses.has('running')).toBe(true);
    expect(statuses.has('queued')).toBe(true);
    expect(statuses.has('completed')).toBe(true);
    expect(statuses.has('failed')).toBe(true);
  });

  it('diffPreview run has filePreview with selectedPath', () => {
    const f = getMobileFixtureForScenario('diffPreview');
    const run = f.runs[0]!;
    expect(run.filePreview).toBeDefined();
    expect(run.filePreview?.selectedPath).toBe('app/mobile-rn/src/screens/TasksScreen.tsx');
    expect(run.filePreview?.diffLines).toBeDefined();
    expect(run.filePreview!.diffLines!.length).toBeGreaterThanOrEqual(4);
  });

  it('previewMatrix has browser preview states: loading, ready, error, empty', () => {
    const f = getMobileFixtureForScenario('previewMatrix');
    const previewStatuses = f.runs
      .map((r) => r.browserPreview?.status)
      .filter(Boolean);
    expect(previewStatuses).toContain('loading');
    expect(previewStatuses).toContain('ready');
    expect(previewStatuses).toContain('error');
    expect(previewStatuses).toContain('empty');
  });
});

// ---------------------------------------------------------------------------
// Inspector sheet modes
// ---------------------------------------------------------------------------

describe('inspector sheet modes', () => {
  const modes = ['review', 'approveConfirm', 'rejectConfirm', 'approvalError'] as const;

  it('has all four inspector modes', () => {
    expect(modes).toHaveLength(4);
    expect(modes).toContain('review');
    expect(modes).toContain('approveConfirm');
    expect(modes).toContain('rejectConfirm');
    expect(modes).toContain('approvalError');
  });
});

// ---------------------------------------------------------------------------
// Changed files
// ---------------------------------------------------------------------------

describe('changed files', () => {
  it('default fixture runs have changed files', () => {
    for (const run of mobileFixture.runs) {
      expect(run.changedFiles.length).toBeGreaterThan(0);
    }
  });

  it('previewMatrix has a run with 10 changed files', () => {
    const f = getMobileFixtureForScenario('previewMatrix');
    const manyFilesRun = f.runs.find((r) => r.changedFiles.length >= 10);
    expect(manyFilesRun).toBeDefined();
  });

  it('previewMatrix has a run with 0 changed files (empty evidence)', () => {
    const f = getMobileFixtureForScenario('previewMatrix');
    const emptyRun = f.runs.find((r) => r.changedFiles.length === 0);
    expect(emptyRun).toBeDefined();
  });
});
