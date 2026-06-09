import { describe, expect, it, vi } from 'vitest';
import {
  appendHubRuntimeEvent,
  decideWebApprovalWithHubClient,
  mergeHubTaskContractEvents,
  mergeHubRuntimeEvents,
  parseWorkspaceProjectThreadMessageContent,
  projectDraftToHubRequest,
  mergeWorkspaceProjectDetail,
  resolveWebRuntimeEvidence,
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
    ], true, 'approved-real')).toMatchObject({
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
    expect(resolveWebWorkbenchContacts(undefined, false, 'fixture')).toBeUndefined();
    expect(resolveWebWorkbenchContacts(undefined, false, 'approved-real')).toMatchObject({
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
    }], false, 'approved-real')).toMatchObject({
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
    expect(resolveWebWorkbenchProjects(undefined, false, 'fixture')).toBeUndefined();
    expect(resolveWebWorkbenchProjects(undefined, false, 'approved-real')).toEqual([]);
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

  it('projects Hub Project Group threads, @Agent metadata, and orchestrator queue into visible project slots', () => {
    const message = {
      id: 'message-1',
      project_id: 'project-1',
      thread_id: 'thread-1',
      seq_id: 7,
      client_msg_id: 'client-message-1',
      sender_type: 'user',
      sender_id: 'user-1',
      content_type: 'text',
      content: JSON.stringify({
        text: '@Reviewer audit the Web A2A slice',
        metadata: {
          im_kind: 'project_group',
          mentions: [{ type: 'agent', id: 'agent-reviewer', display_name: 'Reviewer' }],
          orchestrator_queue: {
            status: 'queued',
            route: 'review',
            correlation_id: 'corr-project-1',
          },
        },
      }),
      created_at: '2026-06-09T12:34:00Z',
    };

    expect(parseWorkspaceProjectThreadMessageContent(message)).toEqual({
      text: '@Reviewer audit the Web A2A slice',
      agentMentions: ['Reviewer'],
      queue: {
        status: 'queued',
        route: 'review',
        correlationId: 'corr-project-1',
      },
    });

    expect(resolveWebWorkbenchProjects([
      {
        id: 'project-1',
        name: 'AgentHub Web',
        description: 'Project Group mainchain',
      },
    ], true, 'approved-real', {
      'project-1': {
        threads: [{
          id: 'thread-1',
          project_id: 'project-1',
          type: 'group',
          name: 'Web/A2A 项目群',
          owner_user_id: 'owner-1',
          role: 'owner',
          member_count: 3,
          last_message_at: '2026-06-09T12:34:00Z',
          created_at: '2026-06-09T12:00:00Z',
        }],
        messages: [message],
      },
    })).toEqual([
      expect.objectContaining({
        id: 'project-1',
        status: 'Hub group',
        meta: '1 threads · 1 messages',
        members: ['owner', 'Reviewer'],
        runs: [
          expect.objectContaining({
            id: 'thread-thread-1',
            name: 'Project group: Web/A2A 项目群',
            status: 'running',
            owner: 'owner',
            meta: '3 members',
          }),
          expect.objectContaining({
            id: 'queue-message-1',
            name: 'Orchestrator queue: review',
            status: 'waiting',
            owner: 'Reviewer',
            meta: 'corr-project-1',
          }),
        ],
        feed: expect.arrayContaining([
          expect.objectContaining({
            id: 'message-message-1',
            time: '12:34',
            text: '@Reviewer audit the Web A2A slice -> @Reviewer · queue queued',
          }),
        ]),
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

  it('surfaces real-mode signed-out Projects state instead of a silent empty list', () => {
    expect(resolveWebProjectsStatus(
      { isFetching: false, error: undefined },
      undefined,
      undefined,
      false,
      'approved-real',
    )).toEqual({
      loading: false,
      error: 'Sign in to Hub to load workspace projects.',
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

  it('merges selected Hub project detail over the list item', () => {
    const listProjects = [
      {
        id: 'project-1',
        name: 'AgentHub List',
        description: 'List summary',
      },
      {
        id: 'project-2',
        name: 'Other Project',
        description: 'Other summary',
      },
    ];

    expect(mergeWorkspaceProjectDetail(listProjects, {
      id: 'project-1',
      name: 'AgentHub Detail',
      description: 'Loaded from Hub detail',
    })).toEqual([
      expect.objectContaining({
        id: 'project-1',
        name: 'AgentHub Detail',
        description: 'Loaded from Hub detail',
      }),
      expect.objectContaining({
        id: 'project-2',
        name: 'Other Project',
      }),
    ]);
    expect(mergeWorkspaceProjectDetail(listProjects, undefined)).toBe(listProjects);
  });

  it('keeps selected Hub project detail visible when it is outside the current page', () => {
    expect(mergeWorkspaceProjectDetail([
      {
        id: 'project-1',
        name: 'Listed Project',
        description: 'Current /web/projects page',
      },
    ], {
      id: 'project-selected',
      name: 'Selected Project',
      description: 'Loaded through /web/projects/{id}',
    })).toEqual([
      expect.objectContaining({
        id: 'project-selected',
        name: 'Selected Project',
        description: 'Loaded through /web/projects/{id}',
      }),
      expect.objectContaining({
        id: 'project-1',
        name: 'Listed Project',
      }),
    ]);
  });

  it('surfaces selected project detail errors in real mode without falling back to mock projects', () => {
    expect(resolveWebProjectsStatus(
      { isFetching: false, error: undefined },
      undefined,
      undefined,
      true,
      'approved-real',
      false,
      { isFetching: false, error: new Error('Hub project detail failed') },
    )).toEqual({
      loading: false,
      error: 'Hub project detail failed',
      actionError: undefined,
      saving: false,
    });
  });

  it('surfaces Project Group loading and errors only in real Hub project mode', () => {
    expect(resolveWebProjectsStatus(
      { isFetching: false, error: undefined },
      undefined,
      undefined,
      true,
      'approved-real',
      false,
      { isFetching: false },
      { isFetching: true },
    )).toEqual({
      loading: true,
      error: undefined,
      actionError: undefined,
      saving: false,
    });

    expect(resolveWebProjectsStatus(
      { isFetching: false, error: undefined },
      undefined,
      undefined,
      true,
      'approved-real',
      false,
      { isFetching: false },
      { isFetching: false, error: new Error('Hub Project Group unavailable') },
    )).toEqual({
      loading: false,
      error: 'Hub Project Group unavailable',
      actionError: undefined,
      saving: false,
    });

    expect(resolveWebProjectsStatus(
      { isFetching: false, error: undefined },
      undefined,
      undefined,
      false,
      'auto',
      false,
      { isFetching: false },
      { isFetching: false, error: new Error('ignored in demo auto mode') },
    )).toEqual({
      loading: false,
      error: undefined,
      actionError: undefined,
      saving: false,
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

  it('derives side-panel runtime evidence from Hub replay artifact refs', () => {
    const transcript = resolveWebWorkbenchTranscript(
      true,
      'hub-session-1',
      [],
      [
        {
          id: 'evt-artifact-1',
          task_id: 'task-1',
          edge_run_id: 'edge-run-1',
          session_id: 'hub-session-1',
          event_seq: 3,
          event_type: 'artifact.created',
          payload: {
            artifactId: 'artifact-1',
            path: 'reports/demo-evidence.md',
            kind: 'summary',
            mimeType: 'text/markdown',
          },
          created_at: '2026-06-09T05:00:03Z',
        },
      ],
    );

    expect(resolveWebRuntimeEvidence(transcript)).toEqual({
      runId: 'edge-run-1',
      diffs: [],
      artifacts: [{
        id: 'artifact-1',
        runId: 'edge-run-1',
        threadId: 'hub-session-1',
        kind: 'summary',
        path: 'reports/demo-evidence.md',
        sizeBytes: 0,
        createdAt: '2026-06-09T05:00:03Z',
      }],
      previews: [],
      sources: { diff: 'none', artifacts: 'event', previews: 'none' },
    });
  });

  it('projects Hub single-task approvals and artifacts into visible transcript blocks', () => {
    const projected = mergeHubTaskContractEvents([], {
      task_id: 'task-1',
      edge_run_id: 'edge-run-1',
      session_id: 'hub-session-1',
      approvals: [{
        approval_id: 'approval-1',
        task_id: 'task-1',
        edge_run_id: 'edge-run-1',
        session_id: 'hub-session-1',
        source_event_id: 'evt-approval-1',
        event_seq: 5,
        request_id: 'perm-1',
        tool_name: 'Write',
        status: 'pending',
        reason: 'Modify workspace file',
        created_at: '2026-06-09T05:00:02Z',
      }],
      pending: [],
      decided: [],
      last_event_seq: 5,
    }, {
      task_id: 'task-1',
      edge_run_id: 'edge-run-1',
      session_id: 'hub-session-1',
      artifacts: [{
        task_id: 'task-1',
        edge_run_id: 'edge-run-1',
        session_id: 'hub-session-1',
        source_event_id: 'evt-artifact-1',
        event_seq: 6,
        artifact_id: 'artifact-1',
        path: 'reports/demo-evidence.md',
        action: 'created',
        tool_name: 'Write',
        mime_type: 'text/markdown',
        size_bytes: 128,
        created_at: '2026-06-09T05:00:03Z',
      }],
      last_event_seq: 6,
    });
    const transcript = resolveWebWorkbenchTranscript(true, 'hub-session-1', [], projected);

    expect(transcript).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'edge-event-hub-runtime-evt-approval-1',
        kind: 'permission_request',
        requestId: 'perm-1',
        toolName: 'Write',
        agentTaskId: 'task-1',
        reason: 'Modify workspace file',
      }),
      expect.objectContaining({
        id: 'edge-event-hub-runtime-evt-artifact-1',
        kind: 'artifact',
        artifactId: 'artifact-1',
        title: 'reports/demo-evidence.md',
        path: 'reports/demo-evidence.md',
        mimeType: 'text/markdown',
      }),
    ]));
  });

  it('projects Hub single-task file-change diff metadata into transcript and runtime evidence', () => {
    const projected = mergeHubTaskContractEvents([], undefined, {
      task_id: 'task-1',
      edge_run_id: 'edge-run-1',
      session_id: 'hub-session-1',
      artifacts: [{
        task_id: 'task-1',
        edge_run_id: 'edge-run-1',
        session_id: 'hub-session-1',
        source_event_id: 'evt-file-change-1',
        event_seq: 7,
        artifact_id: 'artifact-file-change-1',
        path: 'src/runtime.ts',
        action: 'modified',
        status: 'file_change',
        tool_name: 'Edit',
        diff: '@@ -1 +1 @@\n-old runtime\n+new runtime\n',
        edit_id: 'edit-runtime-1',
        review_status: 'needs_review',
        can_apply: false,
        can_revert: true,
        created_at: '2026-06-09T05:00:04Z',
      }],
      last_event_seq: 7,
    });
    const transcript = resolveWebWorkbenchTranscript(true, 'hub-session-1', [], projected);

    expect(transcript).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'edge-event-hub-runtime-evt-file-change-1',
        kind: 'file_change',
        path: 'src/runtime.ts',
        action: 'modified',
        patch: '@@ -1 +1 @@\n-old runtime\n+new runtime',
        editId: 'edit-runtime-1',
        reviewStatus: 'needs_review',
        canApply: false,
        canRevert: true,
      }),
    ]));
    expect(resolveWebRuntimeEvidence(transcript)).toEqual(expect.objectContaining({
      runId: 'edge-run-1',
      diffs: [expect.objectContaining({
        filePath: 'src/runtime.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        editId: 'edit-runtime-1',
        reviewStatus: 'needs_review',
        canApply: false,
        canRevert: true,
      })],
      sources: { diff: 'event', artifacts: 'none', previews: 'none' },
    }));
  });

  it('submits single-task approval decisions through the Hub task contract when agentTaskId is present', async () => {
    const hubClient = {
      decideTaskApproval: vi.fn().mockResolvedValue(undefined),
      decideTeamApproval: vi.fn().mockResolvedValue(undefined),
    };

    await decideWebApprovalWithHubClient(hubClient, {
      approvalId: 'approval-1',
      decision: 'allow',
      agentTaskId: 'agent-task-1',
    });

    expect(hubClient.decideTaskApproval).toHaveBeenCalledWith('agent-task-1', 'approval-1', {
      decision: 'allow',
    });
    expect(hubClient.decideTeamApproval).not.toHaveBeenCalled();
  });

  it('keeps TeamRun approval decisions on the Hub TeamRun client', async () => {
    const hubClient = {
      decideTaskApproval: vi.fn().mockResolvedValue(undefined),
      decideTeamApproval: vi.fn().mockResolvedValue(undefined),
    };

    await decideWebApprovalWithHubClient(hubClient, {
      approvalId: 'approval-1',
      teamId: 'team-1',
      teamRunId: 'team-run-1',
      decision: 'allow',
      agentTaskId: 'agent-task-1',
    });

    expect(hubClient.decideTeamApproval).toHaveBeenCalledWith('team-1', 'team-run-1', 'approval-1', {
      decision: 'allow',
    });
    expect(hubClient.decideTaskApproval).not.toHaveBeenCalled();
  });

  it('uses preview and Hub empty transcripts for unauthenticated and empty Hub states', () => {
    expect(resolveWebWorkbenchTranscript(false, null, undefined, [])).toBe(webTranscript);
    expect(resolveWebWorkbenchTranscript(true, null, undefined, [])[0]).toEqual(expect.objectContaining({
      id: 'web-hub-empty',
      text: 'Hub session 已连接，暂无可显示会话。',
    }));
    expect(resolveWebWorkbenchTranscript(false, null, undefined, [], 'approved-real')[0]).toEqual(expect.objectContaining({
      id: 'web-hub-empty',
      text: 'Hub session 已连接，暂无可显示会话。',
    }));
  });

  it('surfaces explicit real-mode execution target states without mock fallback', () => {
    expect(resolveWebExecutionTargetStatus({
      hubReady: false,
      dataMode: 'approved-real',
      isFetching: false,
      error: null,
      targets: undefined,
    })).toMatchObject({
      state: 'signed-out',
      block: { text: expect.stringContaining('Sign in to Hub') },
    });

    expect(resolveWebExecutionTargetStatus({
      hubReady: true,
      dataMode: 'approved-real',
      isFetching: true,
      error: null,
      targets: undefined,
    })).toMatchObject({
      state: 'loading',
      block: { text: expect.stringContaining('Loading Hub execution targets') },
    });

    expect(resolveWebExecutionTargetStatus({
      hubReady: true,
      dataMode: 'approved-real',
      isFetching: false,
      error: new Error('Hub target inventory failed'),
      targets: undefined,
    })).toMatchObject({
      state: 'error',
      block: { text: expect.stringContaining('Hub target inventory failed') },
    });

    expect(resolveWebExecutionTargetStatus({
      hubReady: true,
      dataMode: 'approved-real',
      isFetching: false,
      error: null,
      targets: [],
    })).toMatchObject({
      state: 'no-target',
      selectedTarget: undefined,
      block: { text: expect.stringContaining('No online local_edge execution target') },
    });

    expect(resolveWebExecutionTargetStatus({
      hubReady: true,
      dataMode: 'approved-real',
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
      state: 'wrong-profile',
      selectedTarget: undefined,
      block: { text: expect.stringContaining('none are local_edge') },
    });

    expect(resolveWebExecutionTargetStatus({
      hubReady: true,
      dataMode: 'approved-real',
      isFetching: false,
      error: null,
      targets: [
        {
          id: 'target-local-edge-degraded',
          name: 'Degraded Desktop Edge',
          target_type: 'local_edge',
          workspace_allowlist: [],
          health_state: 'degraded',
          trust_level: 'local',
          is_online: true,
        },
      ],
    })).toMatchObject({
      state: 'degraded',
      selectedTarget: undefined,
      block: { text: expect.stringContaining('Degraded Desktop Edge') },
    });

    expect(resolveWebExecutionTargetStatus({
      hubReady: true,
      dataMode: 'approved-real',
      isFetching: false,
      error: null,
      targets: [
        {
          id: 'target-local-edge-mismatch',
          name: 'Mismatched Desktop Edge',
          target_type: 'local_edge',
          workspace_allowlist: [],
          health_state: 'mismatch',
          trust_level: 'local',
          is_online: false,
        },
      ],
    })).toMatchObject({
      state: 'mismatch',
      selectedTarget: undefined,
      block: { text: expect.stringContaining('binding mismatch') },
    });

    expect(resolveWebExecutionTargetStatus({
      hubReady: true,
      dataMode: 'approved-real',
      isFetching: false,
      error: null,
      targets: [
        {
          id: 'target-local-edge-stale',
          name: 'Stale Desktop Edge',
          target_type: 'local_edge',
          workspace_allowlist: [],
          health_state: 'stale',
          trust_level: 'local',
          is_online: true,
        },
      ],
    })).toMatchObject({
      state: 'stale',
      selectedTarget: undefined,
      block: { text: expect.stringContaining('health is stale') },
    });

    expect(resolveWebExecutionTargetStatus({
      hubReady: true,
      dataMode: 'approved-real',
      isFetching: false,
      error: null,
      targets: [
        {
          id: 'target-local-edge-offline',
          name: 'Offline Desktop Edge',
          target_type: 'local_edge',
          workspace_allowlist: [],
          health_state: 'offline',
          trust_level: 'local',
          is_online: false,
        },
      ],
    })).toMatchObject({
      state: 'offline',
      selectedTarget: undefined,
      block: { text: expect.stringContaining('offline') },
    });

    expect(resolveWebExecutionTargetStatus({
      hubReady: true,
      dataMode: 'approved-real',
      isFetching: false,
      error: null,
      targets: [
        {
          id: 'target-local-edge-1',
          name: 'Online Desktop Edge',
          target_type: 'local_edge',
          workspace_allowlist: ['D:\\Code\\TokenDance\\AgentHub'],
          health_state: 'online',
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

  it('merges REST replayed and live Hub runtime events with live events winning duplicates', () => {
    const merged = mergeHubRuntimeEvents([
      {
        id: 'evt-replay-1',
        task_id: 'task-1',
        edge_run_id: 'run-1',
        event_seq: 1,
        event_type: 'run.agent.text_block',
        payload: { content: 'from replay' },
      },
      {
        id: 'evt-terminal',
        task_id: 'task-1',
        edge_run_id: 'run-1',
        event_seq: 2,
        event_type: 'run.agent.result',
        payload: { content: 'stale terminal', success: true },
      },
    ], [
      {
        id: 'evt-terminal',
        task_id: 'task-1',
        edge_run_id: 'run-1',
        event_seq: 2,
        event_type: 'run.agent.result',
        payload: { content: 'fresh terminal', success: true },
      },
    ]);

    expect(merged).toEqual([
      expect.objectContaining({ id: 'evt-replay-1', payload: { content: 'from replay' } }),
      expect.objectContaining({ id: 'evt-terminal', payload: { content: 'fresh terminal', success: true } }),
    ]);
  });
});
