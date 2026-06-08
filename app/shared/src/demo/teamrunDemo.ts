import type { TranscriptBlock } from '../transcript';

export const TEAMRUN_DEMO_CONVERSATION_ID = 'bytedance-teamrun';

export interface TeamRunDemoRuntimeProfile {
  id: string;
  displayName: string;
  role: 'supervisor' | 'worker';
  runtimeType: string;
}

export interface TeamRunDemoTask {
  id: string;
  assignmentId: string;
  role: TeamRunDemoRuntimeProfile['role'];
  status: 'completed';
  summary: string;
}

export interface TeamRunDemoEvent {
  id: string;
  type: string;
  actor: string;
  assignmentId?: string;
  childAssignmentId?: string;
}

export interface TeamRunDemoScenario {
  contract: 'teamrun-demo-evidence-v1';
  scenarioId: string;
  fixtureOnly: true;
  claims: {
    realRuntimeExecuted: false;
    liveHubRuntimeVerified: false;
    finalRecordingComplete: false;
    submissionReady: false;
  };
  state: {
    teamId: string;
    teamRunId: string;
    status: 'completed';
    goal: string;
  };
  runtimeProfiles: TeamRunDemoRuntimeProfile[];
  tasks: TeamRunDemoTask[];
  events: TeamRunDemoEvent[];
  uiEvidenceCapture: {
    screenshots: string[];
    coveredSurfaces: string[];
    forbiddenRuntimeTouches: string[];
  };
}

export const teamRunDemoScenario: TeamRunDemoScenario = {
  contract: 'teamrun-demo-evidence-v1',
  scenarioId: 'bytedance-teamrun-fixture-minimum',
  fixtureOnly: true,
  claims: {
    realRuntimeExecuted: false,
    liveHubRuntimeVerified: false,
    finalRecordingComplete: false,
    submissionReady: false,
  },
  state: {
    teamId: 'team-fixture-bytedance',
    teamRunId: 'teamrun-fixture-001',
    status: 'completed',
    goal: 'Show the minimum TeamRun route from supervisor to worker using fixture-only evidence.',
  },
  runtimeProfiles: [
    {
      id: 'profile-supervisor-fixture',
      displayName: 'Demo Supervisor',
      role: 'supervisor',
      runtimeType: 'codex-fixture',
    },
    {
      id: 'profile-worker-fixture',
      displayName: 'Demo Worker',
      role: 'worker',
      runtimeType: 'opencode-fixture',
    },
  ],
  tasks: [
    {
      id: 'task-supervisor-fixture',
      assignmentId: 'assign-supervisor-fixture',
      role: 'supervisor',
      status: 'completed',
      summary: 'Plan and delegate the fixture demo task.',
    },
    {
      id: 'task-worker-fixture',
      assignmentId: 'assign-worker-fixture',
      role: 'worker',
      status: 'completed',
      summary: 'Return a fixture implementation result.',
    },
  ],
  events: [
    {
      id: 'evt-001',
      type: 'agent.dispatch',
      actor: 'hub',
      assignmentId: 'assign-supervisor-fixture',
    },
    {
      id: 'evt-002',
      type: 'run.agent.route_decision',
      actor: 'profile-supervisor-fixture',
      assignmentId: 'assign-supervisor-fixture',
    },
    {
      id: 'evt-003',
      type: 'team.route.decided',
      actor: 'hub',
      assignmentId: 'assign-supervisor-fixture',
      childAssignmentId: 'assign-worker-fixture',
    },
    {
      id: 'evt-004',
      type: 'agent.dispatch',
      actor: 'hub',
      assignmentId: 'assign-worker-fixture',
    },
    {
      id: 'evt-005',
      type: 'run.agent.result',
      actor: 'profile-worker-fixture',
      assignmentId: 'assign-worker-fixture',
    },
    {
      id: 'evt-006',
      type: 'team.run.completed',
      actor: 'hub',
    },
  ],
  uiEvidenceCapture: {
    screenshots: [
      'teamrun-transcript.png',
      'teamrun-inspector-files.png',
    ],
    coveredSurfaces: [
      'Desktop shared transcript',
      'Right inspector file/evidence list',
      'TeamRun route, task, and event fixture list',
    ],
    forbiddenRuntimeTouches: [
      'TokenDance ID login',
      'Hub or Edge service mutation',
      'real CLI or model execution',
      'secret reads',
    ],
  },
};

export const teamRunDemoTranscript: TranscriptBlock[] = [
  {
    id: 'teamrun-user-1',
    kind: 'text',
    createdAt: '2026-06-08T10:10:00+08:00',
    author: { id: 'delicious233', name: 'Delicious233', role: 'human' },
    text: '为 ByteDance demo 打开 TeamRun fixture，只做 UI evidence capture，不登录、不跑真实 CLI/model。',
  },
  {
    id: 'teamrun-state-1',
    kind: 'text',
    createdAt: '2026-06-08T10:10:10+08:00',
    author: { id: 'profile-supervisor-fixture', name: 'Demo Supervisor', role: 'agent' },
    text: 'TeamRun Console fixture state 已载入。teamrun-fixture-001 已完成，包含 supervisor 到 worker 的可回放路由、任务和事件列表。',
    displayTitle: 'TeamRun Console fixture state 已载入',
    displayDetail: 'teamrun-fixture-001 已完成，包含 supervisor 到 worker 的可回放路由、任务和事件列表。',
    badgeLabel: 'fixture',
    badgeVariant: 'primary',
    evidenceRefs: [
      {
        id: 'teamrun-state-fixture',
        kind: 'file',
        label: 'teamrun-state.json',
        path: 'docs/competition/teamrun-demo-scenario.json#state',
        status: 'completed',
      },
      {
        id: 'teamrun-runtime-profiles',
        kind: 'artifact',
        label: 'runtime_profiles fixture',
        status: 'completed',
      },
    ],
  },
  {
    id: 'teamrun-session-1',
    kind: 'run_session',
    createdAt: '2026-06-08T10:10:12+08:00',
    author: { id: 'profile-supervisor-fixture', name: 'Demo Supervisor', role: 'agent' },
    title: 'ByteDance TeamRun fixture',
    status: 'completed',
    meta: 'fixture-only · no login · no CLI/model · no secrets',
    runId: teamRunDemoScenario.state.teamRunId,
    evidenceRefs: [
      {
        id: `run-${teamRunDemoScenario.state.teamRunId}`,
        kind: 'run',
        label: teamRunDemoScenario.state.teamRunId,
        status: 'completed',
      },
    ],
  },
  {
    id: 'teamrun-route-list',
    kind: 'agent_timeline',
    createdAt: '2026-06-08T10:10:20+08:00',
    author: { id: 'profile-supervisor-fixture', name: 'Demo Supervisor', role: 'agent' },
    title: 'TeamRun route / task / event list',
    items: [
      {
        status: 'completed',
        label: 'agent.dispatch',
        detail: 'Hub dispatches supervisor fixture assignment.',
      },
      {
        status: 'completed',
        label: 'run.agent.route_decision',
        detail: 'Supervisor delegates the worker fixture task.',
      },
      {
        status: 'completed',
        label: 'team.route.decided',
        detail: 'Hub records the route and creates child assignment.',
      },
      {
        status: 'completed',
        label: 'run.agent.result',
        detail: 'Worker returns fixture result without executing a real runtime.',
      },
    ],
    evidenceRefs: [
      {
        id: 'teamrun-events-fixture',
        kind: 'file',
        label: 'teamrun-events.json',
        path: 'docs/competition/teamrun-demo-scenario.json#events',
        status: 'completed',
      },
    ],
  },
  {
    id: 'teamrun-task-step',
    kind: 'run_step_group',
    createdAt: '2026-06-08T10:10:30+08:00',
    author: { id: 'profile-supervisor-fixture', name: 'Demo Supervisor', role: 'agent' },
    icon: 'T',
    title: 'TeamRun fixture API surfaces',
    meta: 'state · tasks · events are deterministic local fixture records',
    status: 'completed',
    open: true,
    evidenceRefs: [
      {
        id: 'teamrun-tasks-fixture',
        kind: 'file',
        label: 'teamrun-tasks.json',
        path: 'docs/competition/teamrun-demo-scenario.json#tasks',
        status: 'completed',
      },
    ],
    children: [
      {
        id: 'teamrun-tool-state',
        kind: 'tool_call',
        author: { id: 'fixture-harness', name: 'Fixture Harness', role: 'system' },
        toolName: 'GET /state',
        status: 'completed',
        target: '/web/agent-teams/team-fixture-bytedance/runs/teamrun-fixture-001/state',
        summary: 'Read local fixture state only; no Hub request is sent by this UI gate.',
      },
      {
        id: 'teamrun-tool-tasks',
        kind: 'tool_call',
        author: { id: 'fixture-harness', name: 'Fixture Harness', role: 'system' },
        toolName: 'GET /tasks',
        status: 'completed',
        target: '/web/agent-teams/team-fixture-bytedance/runs/teamrun-fixture-001/tasks',
        summary: 'Shows supervisor and worker tasks from deterministic fixture data.',
      },
      {
        id: 'teamrun-tool-events',
        kind: 'tool_call',
        author: { id: 'fixture-harness', name: 'Fixture Harness', role: 'system' },
        toolName: 'GET /events',
        status: 'completed',
        target: '/web/agent-teams/team-fixture-bytedance/runs/teamrun-fixture-001/events',
        summary: 'Shows dispatch, route decision, child dispatch, result, and completion events.',
      },
    ],
  },
  {
    id: 'teamrun-delegate',
    kind: 'route_decision',
    createdAt: '2026-06-08T10:10:40+08:00',
    author: { id: 'profile-supervisor-fixture', name: 'Demo Supervisor', role: 'agent' },
    action: 'delegate',
    targetAgent: 'Demo Worker',
    summary: 'Delegate fixture implementation result to profile-worker-fixture; record team.route.decided for evidence shape.',
    evidenceRefs: [
      {
        id: 'teamrun-route-decision',
        kind: 'artifact',
        label: 'run.agent.route_decision -> team.route.decided',
        status: 'completed',
      },
    ],
  },
  {
    id: 'teamrun-worker',
    kind: 'subagent',
    createdAt: '2026-06-08T10:10:50+08:00',
    author: { id: 'profile-worker-fixture', name: 'Demo Worker', role: 'agent' },
    title: 'Worker fixture task',
    worker: 'Demo Worker',
    status: 'completed',
    summary: 'Returned fixture implementation result; no real CLI/model process was started.',
    runId: 'teamrun-fixture-worker-run',
  },
  {
    id: 'teamrun-result',
    kind: 'result',
    createdAt: '2026-06-08T10:11:00+08:00',
    author: { id: 'fixture-harness', name: 'Fixture Harness', role: 'system' },
    success: true,
    duration: 'fixture',
    turns: 0,
    summary: 'UI evidence fixture covers transcript, right inspector files, route decision, task list, and event list without live runtime claims.',
  },
];
