import { describe, expect, it } from 'vitest';
import {
  appendHubRuntimeEvent,
  projectDraftToHubRequest,
  resolveWebWorkbenchContacts,
  resolveWebExecutionTargetStatus,
  resolveWebWorkbenchProjects,
  resolveWebWorkbenchTranscript,
  resolveWebProjectsStatus,
  workspaceProjectToProjectInfo,
} from './useWebWorkbenchModel';
import { webTranscript } from './webPlatform';

describe('useWebWorkbenchModel helpers', () => {
  it('maps Hub contacts into shared workbench contacts', () => {
    expect(resolveWebWorkbenchContacts([
      {
        user_id: 'user-1',
        username: 'alice',
        nickname: 'Alice Zhang',
        remark: '产品负责人',
        online: true,
        type: 'internal',
      },
      {
        user_id: 'user-2',
        username: 'bob',
        nickname: 'Bob',
        online: false,
        type: 'external',
      },
    ], true)).toMatchObject({
      members: [
        {
          id: 'user-1',
          name: '产品负责人',
          initials: '产品',
          org: 'TokenDance',
          status: '在线',
          tag: 'Hub',
        },
        {
          id: 'user-2',
          name: 'Bob',
          initials: 'B',
          org: '外部联系人',
          status: '离线',
          tag: 'External',
        },
      ],
      recentShortcuts: ['产品负责人', 'Bob'],
    });
  });

  it('keeps demo contacts unless Hub or real mode is active', () => {
    expect(resolveWebWorkbenchContacts(undefined, false)).toBeUndefined();
    expect(resolveWebWorkbenchContacts(undefined, false, 'real')).toMatchObject({
      members: [],
      recentShortcuts: [],
    });
  });

  it('does not render stale Hub contacts when real mode loses Hub readiness', () => {
    expect(resolveWebWorkbenchContacts([{
      user_id: 'old-user',
      username: 'old',
      nickname: 'Old Contact',
      online: true,
      type: 'internal',
    }], false, 'real')).toMatchObject({
      members: [],
      recentShortcuts: [],
    });
  });

  it('maps Hub workspace projects into shared project cards without mock project activity', () => {
    expect(workspaceProjectToProjectInfo({
      id: 'project-1',
      name: ' AgentHub Demo ',
      description: 'Competition workspace',
      owner_id: 'owner-1',
      created_at: '2026-06-08T00:00:00Z',
      updated_at: '2026-06-09T00:30:00Z',
    })).toMatchObject({
      id: 'project-1',
      name: 'AgentHub Demo',
      description: 'Competition workspace',
      status: 'Hub',
      meta: '0 runs',
      members: [],
      announcement: 'Competition workspace',
      runs: [],
      artifacts: [],
      feed: [],
    });
  });

  it('keeps demo projects only in demo mode without Hub readiness', () => {
    expect(resolveWebWorkbenchProjects(undefined, false)).toEqual([]);
    expect(resolveWebWorkbenchProjects(undefined, false, 'demo')).toBeUndefined();
    expect(resolveWebWorkbenchProjects(undefined, false, 'real')).toEqual([]);
    expect(resolveWebWorkbenchProjects([{
      id: 'project-1',
      name: 'AgentHub Demo',
      description: 'Hub workspace',
    }], true)).toEqual([
      expect.objectContaining({
        id: 'project-1',
        name: 'AgentHub Demo',
        runs: [],
        artifacts: [],
      }),
    ]);
  });

  it('treats auto mode with a ready Hub as real Projects status', () => {
    const loadError = new Error('Hub Projects unavailable');
    const actionError = new Error('Hub Projects create failed');

    expect(resolveWebProjectsStatus(
      { isFetching: true, error: loadError },
      undefined,
      undefined,
      true,
      'auto',
    )).toEqual({
      loading: true,
      error: 'Hub Projects unavailable',
      actionError: undefined,
      saving: false,
    });
    expect(resolveWebProjectsStatus(
      { isFetching: false, error: undefined },
      actionError,
      undefined,
      true,
      'auto',
    )).toEqual({
      loading: false,
      error: undefined,
      actionError: 'Hub Projects create failed',
      saving: false,
    });
    expect(resolveWebProjectsStatus(
      { isFetching: true, error: loadError },
      actionError,
      undefined,
      false,
      'auto',
    )).toEqual({
      loading: false,
      error: undefined,
      actionError: undefined,
      saving: false,
    });
  });

  it('normalizes project form drafts before sending Hub mutations', () => {
    expect(projectDraftToHubRequest({
      name: '  AgentHub Web  ',
      description: '  Hub-only workspace  ',
    })).toEqual({
      name: 'AgentHub Web',
      description: 'Hub-only workspace',
    });
    expect(projectDraftToHubRequest({
      name: 'Untitled',
      description: '   ',
    })).toEqual({
      name: 'Untitled',
      description: '',
    });
  });

  it('combines Hub messages with live runtime transcript blocks', () => {
    const transcript = resolveWebWorkbenchTranscript(
      true,
      'hub-session-1',
      [
        {
          id: 'message-1',
          session_id: 'hub-session-1',
          sender_type: 'user',
          sender_id: 'user-1',
          content_type: 'text',
          content: '开始执行',
          created_at: '2026-06-07T05:00:00Z',
        },
      ],
      [
        {
          id: 'evt-runtime-1',
          task_id: 'task-1',
          edge_run_id: 'run-1',
          edge_device_id: 'desktop-device-1',
          adapter_id: 'codex',
          session_id: 'hub-session-1',
          event_seq: 1,
          event_type: 'run.agent.text_block',
          payload: { content: '运行中输出' },
          created_at: '2026-06-07T05:00:01Z',
        },
      ],
    );

    expect(transcript).toEqual([
      expect.objectContaining({
        id: 'hub-message-message-1',
        kind: 'text',
        text: '开始执行',
      }),
      expect.objectContaining({
        id: 'hub-runtime-session-task-1-run-1',
        kind: 'run_session',
        title: 'Hub task replay',
        sourceLabel: 'Hub replay',
        modeLabel: 'Replay',
        targetLabel: 'Edge run evidence',
        taskId: 'task-1',
        edgeRunId: 'run-1',
        deviceId: 'desktop-device-1',
        adapterId: 'codex',
      }),
      expect.objectContaining({
        id: 'edge-event-hub-runtime-evt-runtime-1',
        kind: 'text',
        text: '运行中输出',
        evidenceRefs: [
          { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'running' },
        ],
      }),
    ]);
  });

  it('uses preview and Hub empty transcripts for unauthenticated and empty Hub states', () => {
    expect(resolveWebWorkbenchTranscript(false, null, undefined, [])).toBe(webTranscript);
    expect(resolveWebWorkbenchTranscript(true, null, undefined, [])[0]).toEqual(expect.objectContaining({
      id: 'web-hub-empty',
      text: 'Hub session 已连接，暂无可显示会话。',
    }));
    expect(resolveWebWorkbenchTranscript(false, null, undefined, [], 'real')[0]).toEqual(expect.objectContaining({
      id: 'web-hub-empty',
      text: 'Hub session 已连接，暂无可显示会话。',
    }));
  });

  it('surfaces explicit real-mode execution target states without mock fallback', () => {
    expect(resolveWebExecutionTargetStatus({
      hubReady: false,
      dataMode: 'real',
      isFetching: false,
      error: null,
      targets: undefined,
    })).toMatchObject({
      state: 'signed-out',
      block: { text: expect.stringContaining('Sign in to Hub') },
    });

    expect(resolveWebExecutionTargetStatus({
      hubReady: true,
      dataMode: 'real',
      isFetching: true,
      error: null,
      targets: undefined,
    })).toMatchObject({
      state: 'loading',
      block: { text: expect.stringContaining('Loading Hub execution targets') },
    });

    expect(resolveWebExecutionTargetStatus({
      hubReady: true,
      dataMode: 'real',
      isFetching: false,
      error: new Error('Hub target inventory failed'),
      targets: undefined,
    })).toMatchObject({
      state: 'error',
      block: { text: expect.stringContaining('Hub target inventory failed') },
    });

    expect(resolveWebExecutionTargetStatus({
      hubReady: true,
      dataMode: 'real',
      isFetching: false,
      error: null,
      targets: [
        {
          id: 'relay-1',
          name: 'Hub Relay',
          target_type: 'hub_relay',
          workspace_allowlist: [],
          health_state: 'healthy',
          trust_level: 'relay',
          is_online: true,
        },
      ],
    })).toMatchObject({
      state: 'empty',
      selectedTarget: undefined,
      block: { text: expect.stringContaining('No online local_edge execution target') },
    });

    expect(resolveWebExecutionTargetStatus({
      hubReady: true,
      dataMode: 'real',
      isFetching: false,
      error: null,
      targets: [
        {
          id: 'target-local-edge-1',
          name: 'Online Desktop Edge',
          target_type: 'local_edge',
          workspace_allowlist: ['D:\\Code\\TokenDance\\AgentHub'],
          health_state: 'healthy',
          trust_level: 'local',
          is_online: true,
        },
      ],
    })).toMatchObject({
      state: 'ready',
      selectedTarget: { id: 'target-local-edge-1' },
      block: { text: expect.stringContaining('Online Desktop Edge') },
    });
  });

  it('deduplicates live Hub runtime events by id and limits retained events', () => {
    const first = appendHubRuntimeEvent([], {
      id: 'evt-1',
      event_type: 'run.agent.text_delta',
      payload: { content: 'a' },
    });
    const replaced = appendHubRuntimeEvent(first, {
      id: 'evt-1',
      event_type: 'run.agent.text_delta',
      payload: { content: 'b' },
    });
    const limited = appendHubRuntimeEvent([
      { id: 'evt-1', event_type: 'run.agent.text_delta' },
      { id: 'evt-2', event_type: 'run.agent.text_delta' },
    ], { id: 'evt-3', event_type: 'run.agent.text_delta' }, 2);

    expect(replaced).toEqual([
      { id: 'evt-1', event_type: 'run.agent.text_delta', payload: { content: 'b' } },
    ]);
    expect(limited.map((event) => event.id)).toEqual(['evt-2', 'evt-3']);
  });
});
