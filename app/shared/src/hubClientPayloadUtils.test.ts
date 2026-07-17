import { describe, expect, it } from 'vitest';
import {
  buildAcceptFriendRequestPath,
  buildAckRelayCommandPath,
  buildAckTaskPath,
  buildAgentProfilePath,
  buildAgentProfilesPath,
  buildAgentTasksPath,
  buildAgentTeamMembersPath,
  buildAgentTeamPath,
  buildAgentTeamRunsPath,
  buildAgentTeamsPath,
  buildAttachmentDownloadUrl,
  buildAttachmentFormData,
  buildAttachmentsPath,
  buildBlockContactPath,
  buildCancelAgentTaskPaths,
  buildChangePasswordFallback,
  buildChangePasswordFallbackPath,
  buildChangePasswordPath,
  buildChangePasswordPrimary,
  buildContactRemarkPath,
  buildCreateGroupSessionPath,
  buildCreatePrivateSessionPath,
  buildCustomAgentPath,
  buildCustomAgentsPath,
  buildDecideTaskApprovalPath,
  buildDecideTeamApprovalPath,
  buildDeleteInit,
  buildDissolveSessionPath,
  buildDocumentPath,
  buildDocumentsPath,
  buildDoneTaskPath,
  buildEditMessagePath,
  buildExecutionTargetPath,
  buildExecutionTargetsPath,
  buildFailTaskPath,
  buildForwardMessageBody,
  buildForwardMessagePath,
  buildFriendRequestBody,
  buildFriendRequestsPath,
  buildGetMessagesPath,
  buildGetTeamRunPath,
  buildGetTeamRunStatePath,
  buildJsonDeleteInit,
  buildJsonPatchInit,
  buildJsonPostInit,
  buildJsonPutInit,
  buildLeaveSessionPath,
  buildListAgentProfilesPath,
  buildListAuditEventsPath,
  buildListContactsPath,
  buildListDocumentsPath,
  buildListExecutionTargetsPath,
  buildListMessageReactionsPath,
  buildListNotificationsPath,
  buildListPublicMCPServersPath,
  buildListPublicSkillsPath,
  buildListSessionsPath,
  buildListTaskApprovalsPath,
  buildListTaskArtifactsPath,
  buildListTaskRunEventsAfterPath,
  buildListTaskRunEventsPath,
  buildListTeamEventsPath,
  buildListTeamTasksPath,
  buildListWorkspaceProjectsPath,
  buildListWorkspaceProjectThreadMessagesPath,
  buildLoginPath,
  buildLogoutPath,
  buildMarkNotificationReadPaths,
  buildMarkReadBody,
  buildMarkReadPath,
  buildMemberIdsBody,
  buildMePath,
  buildMessageReactionsPath,
  buildOidcAuthorizeBody,
  buildOidcAuthorizePath,
  buildOidcCallbackPath,
  buildOptionalJsonBody,
  buildPatchSettingsBody,
  buildPingExecutionTargetPath,
  buildPinMessagePath,
  buildPostInit,
  buildPostTeamRouteDecisionPath,
  buildPostWithOptionalJsonBody,
  buildProbeAttachmentBody,
  buildProbeAttachmentPath,
  buildPutInit,
  buildReactionBody,
  buildReadAllNotificationsPaths,
  buildRecallMessagePath,
  buildRefreshBody,
  buildRefreshPath,
  buildRegenerateAgentTaskPath,
  buildRegisterDevicePaths,
  buildRegisterPath,
  buildRejectFriendRequestPath,
  buildRelayCommandPath,
  buildRelayCommandsPath,
  buildRemarkBody,
  buildRemoveAgentTeamMemberPath,
  buildRemoveContactPath,
  buildRemoveSessionMemberPath,
  buildResolveTeamConflictPath,
  buildSearchMessagesPath,
  buildSearchSessionMessagesPath,
  buildSearchSessionsPath,
  buildSearchUserPath,
  buildSendWorkspaceProjectThreadMessagePath,
  buildSessionAgentsPath,
  buildSessionIdBody,
  buildSessionInfoPath,
  buildSessionMembersPath,
  buildSessionPath,
  buildSessionPinsPath,
  buildSessionSettingsPath,
  buildSettingsPath,
  buildStreamTaskEventBody,
  buildStreamTaskPath,
  buildSyncMessagesPath,
  buildTaskAckBody,
  buildTaskDoneBody,
  buildTaskFailBody,
  buildTaskRunEventSummaryPath,
  buildTaskStreamBody,
  buildTransferOwnerBody,
  buildTransferSessionOwnerPath,
  buildTriggerAgentTaskBody,
  buildUnblockContactPath,
  buildUpdateProfilePath,
  buildWorkspaceProjectPath,
  buildWorkspaceProjectsPath,
  buildWorkspaceProjectThreadsPath,
  normalizeExecutionTargetsResponse,
  withPublicCatalogParams,
} from './hubClientPayloadUtils';

describe('hubClientPayloadUtils (#810 / #822 / #833 / #901 / #913)', () => {
  it('normalizes execution-target array vs {items,page} responses', () => {
    expect(
      normalizeExecutionTargetsResponse([
        { id: 't1', name: 'edge-a' },
        { id: 't2', name: 'edge-b' },
      ]),
    ).toEqual({
      items: [
        { id: 't1', name: 'edge-a' },
        { id: 't2', name: 'edge-b' },
      ],
      page: { hasMore: false },
    });

    expect(
      normalizeExecutionTargetsResponse({
        items: [{ id: 't3', name: 'edge-c' }],
        page: { hasMore: true, nextCursor: 'c1' },
      }),
    ).toEqual({
      items: [{ id: 't3', name: 'edge-c' }],
      page: { hasMore: true, nextCursor: 'c1' },
    });

    expect(
      normalizeExecutionTargetsResponse({
        items: undefined as unknown as [],
        page: undefined as unknown as { hasMore: boolean },
      }),
    ).toEqual({
      items: [],
      page: { hasMore: false },
    });
  });

  it('builds OIDC authorize body with S256 default before caller fields', () => {
    expect(
      buildOidcAuthorizeBody({
        code_challenge: 'abc',
        code_challenge_method: 'plain',
        device_type: 'desktop',
      }),
    ).toEqual({
      code_challenge_method: 'plain',
      code_challenge: 'abc',
      device_type: 'desktop',
    });

    expect(buildOidcAuthorizeBody({ code_challenge: 'xyz' })).toEqual({
      code_challenge_method: 'S256',
      code_challenge: 'xyz',
    });
  });

  it('builds task lifecycle bodies with optional run_id', () => {
    expect(buildTaskAckBody()).toBeUndefined();
    expect(buildTaskAckBody('run-1')).toEqual({ run_id: 'run-1' });

    expect(buildTaskStreamBody('hello')).toEqual({ content: 'hello' });
    expect(buildTaskStreamBody('hello', 'run-2')).toEqual({
      content: 'hello',
      run_id: 'run-2',
    });

    expect(buildTaskDoneBody()).toEqual({ final_content: '' });
    expect(buildTaskDoneBody('done', 'run-3')).toEqual({
      final_content: 'done',
      run_id: 'run-3',
    });

    expect(buildTaskFailBody('boom')).toEqual({ error: 'boom' });
    expect(buildTaskFailBody('boom', 'run-4')).toEqual({
      error: 'boom',
      run_id: 'run-4',
    });
  });

  it('builds stream event, trigger, settings, probe, and reaction bodies', () => {
    expect(buildStreamTaskEventBody('token', { t: 1 })).toEqual({
      event_type: 'token',
      payload: { t: 1 },
    });
    expect(
      buildStreamTaskEventBody('token', { t: 1 }, { runId: 'r1', clientMsgId: 'm1' }),
    ).toEqual({
      event_type: 'token',
      payload: { t: 1 },
      run_id: 'r1',
      client_msg_id: 'm1',
    });

    expect(buildTriggerAgentTaskBody('msg-1', { agent_type: 'claude' })).toEqual({
      trigger_message_id: 'msg-1',
      agent_type: 'claude',
    });

    expect(buildPatchSettingsBody({ theme: 'dark' })).toEqual({ values: { theme: 'dark' } });
    expect(buildProbeAttachmentBody('sha256')).toEqual({ hash: 'sha256' });
    expect(buildReactionBody('sess-1', { emoji: '👍' })).toEqual({
      session_id: 'sess-1',
      emoji: '👍',
    });
  });

  it('builds residual request-body object literals (#822)', () => {
    expect(buildRefreshBody('rt-1')).toEqual({ refresh_token: 'rt-1' });
    expect(buildFriendRequestBody('u-2', 'hi')).toEqual({
      friend_id: 'u-2',
      message: 'hi',
    });
    expect(buildFriendRequestBody('u-3')).toEqual({
      friend_id: 'u-3',
    });
    expect(buildRemarkBody('buddy')).toEqual({ remark: 'buddy' });
    expect(buildMemberIdsBody(['a', 'b'])).toEqual({ member_ids: ['a', 'b'] });
    expect(buildTransferOwnerBody('owner-9')).toEqual({ new_owner_id: 'owner-9' });
    expect(buildMarkReadBody(42)).toEqual({ last_read_seq: 42 });
    expect(buildSessionIdBody('sess-9')).toEqual({ session_id: 'sess-9' });
    expect(buildForwardMessageBody(['s1', 's2'])).toEqual({
      target_session_ids: ['s1', 's2'],
    });
  });

  it('builds residual path/query helpers (#822)', () => {
    expect(buildSearchUserPath('user/1')).toBe('/client/contacts/search?id=user%2F1');
    expect(buildSearchSessionsPath('hello world')).toBe(
      '/client/sessions/search?q=hello%20world',
    );
    expect(buildListMessageReactionsPath('msg/1', 'sess/2')).toBe(
      '/client/messages/msg%2F1/reactions?session_id=sess%2F2',
    );
    expect(buildListTaskRunEventsAfterPath('task/1', 7)).toBe(
      '/web/agent-tasks/task%2F1/events?after_seq=7&limit=500',
    );
    expect(buildCancelAgentTaskPaths('task/1')).toEqual([
      '/web/agent-tasks/task%2F1:cancel',
      '/web/agent-tasks/task%2F1/cancel',
    ]);
    expect(buildMarkNotificationReadPaths('n/1')).toEqual([
      '/client/notifications/n%2F1:read',
      '/client/notifications/n%2F1/read',
    ]);
    expect(buildReadAllNotificationsPaths()).toEqual([
      '/client/notifications:read-all',
      '/client/notifications/read-all',
    ]);
    expect(buildDecideTeamApprovalPath('t/1', 'r/2', 'a/3')).toBe(
      '/web/agent-teams/t%2F1/runs/r%2F2/approvals/a%2F3/decide',
    );
    expect(buildResolveTeamConflictPath('t/1', 'r/2', 'c/3')).toBe(
      '/web/agent-teams/t%2F1/runs/r%2F2/conflicts/c%2F3/resolve',
    );
    expect(buildPostTeamRouteDecisionPath('t/1', 'r/2')).toBe(
      '/web/agent-teams/t%2F1/runs/r%2F2/route-decisions',
    );
  });

  it('builds multi-segment path residual helpers (#833)', () => {
    expect(buildRegisterDevicePaths()).toEqual([
      '/edge/devices:register',
      '/edge/devices/register',
    ]);

    expect(buildAcceptFriendRequestPath('req/1')).toBe(
      '/client/contacts/friend-requests/req%2F1/accept',
    );
    expect(buildRejectFriendRequestPath('req/2')).toBe(
      '/client/contacts/friend-requests/req%2F2/reject',
    );
    expect(buildBlockContactPath('user/a')).toBe('/client/contacts/user%2Fa/block');
    expect(buildUnblockContactPath('user/b')).toBe('/client/contacts/user%2Fb/unblock');
    expect(buildContactRemarkPath('user/c')).toBe('/client/contacts/user%2Fc/remark');

    expect(buildRemoveSessionMemberPath('sess/1', 'user/2')).toBe(
      '/client/sessions/sess%2F1/members/user%2F2',
    );

    expect(buildGetMessagesPath('sess/1', { before_seq: 9, limit: 50 })).toBe(
      '/client/sessions/sess%2F1/messages?before_seq=9&limit=50',
    );
    expect(buildGetMessagesPath('sess/1')).toBe('/client/sessions/sess%2F1/messages');
    expect(buildSyncMessagesPath('sess/2', { after_seq: 3 })).toBe(
      '/client/sessions/sess%2F2/messages/sync?after_seq=3',
    );
    expect(buildSearchSessionMessagesPath('sess/3', { q: 'a b', content_type: 'text' })).toBe(
      '/client/sessions/sess%2F3/messages/search?q=a+b&content_type=text',
    );

    expect(buildListWorkspaceProjectThreadMessagesPath('p/1', 'th/2', { limit: 20 })).toBe(
      '/web/projects/p%2F1/threads/th%2F2/messages?limit=20',
    );
    expect(buildSendWorkspaceProjectThreadMessagePath('p/1', 'th/2')).toBe(
      '/web/projects/p%2F1/threads/th%2F2/messages',
    );

    expect(buildGetTeamRunPath('t/1', 'r/2')).toBe('/web/agent-teams/t%2F1/runs/r%2F2');
    expect(buildGetTeamRunStatePath('t/1', 'r/2')).toBe(
      '/web/agent-teams/t%2F1/runs/r%2F2/state',
    );
    expect(buildListTeamEventsPath('t/1', 'r/2')).toBe(
      '/web/agent-teams/t%2F1/runs/r%2F2/events',
    );
    expect(buildListTeamTasksPath('t/1', 'r/2')).toBe(
      '/web/agent-teams/t%2F1/runs/r%2F2/tasks',
    );
    expect(buildRemoveAgentTeamMemberPath('t/1', 'm/9')).toBe(
      '/web/agent-teams/t%2F1/members/m%2F9',
    );
    expect(buildDecideTaskApprovalPath('task/1', 'appr/2')).toBe(
      '/web/agent-tasks/task%2F1/approvals/appr%2F2/decide',
    );
  });

  it('omits optional JSON body key when payload is absent (#833 exactOptional)', () => {
    expect(buildOptionalJsonBody(undefined)).toEqual({});
    expect(Object.prototype.hasOwnProperty.call(buildOptionalJsonBody(undefined), 'body')).toBe(
      false,
    );
    expect(buildOptionalJsonBody(buildTaskAckBody())).toEqual({});
    expect(buildOptionalJsonBody(buildTaskAckBody('run-9'))).toEqual({
      body: JSON.stringify({ run_id: 'run-9' }),
    });
  });

  it('merges public catalog params and builds attachment helpers', () => {
    expect(withPublicCatalogParams()).toEqual({ is_public: 'true' });
    expect(withPublicCatalogParams({ q: 'search', pageSize: 10 })).toEqual({
      is_public: 'true',
      q: 'search',
      pageSize: 10,
    });
    // Caller may still override is_public after the default.
    expect(withPublicCatalogParams({ is_public: 'false' })).toEqual({ is_public: 'false' });

    expect(buildAttachmentDownloadUrl('http://hub.local', 'att/1')).toBe(
      'http://hub.local/client/attachments/att%2F1',
    );

    const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
    const formData = buildAttachmentFormData(file, 'hash-1');
    expect(formData.get('hash')).toBe('hash-1');
    expect(formData.get('original_name')).toBe('note.txt');
    expect(formData.get('file')).toBeInstanceOf(File);
  });

  it('builds residual single-id / query path helpers (#901)', () => {
    expect(buildRemoveContactPath('user/1')).toBe('/client/contacts/user%2F1');
    expect(buildSessionMembersPath('sess/1')).toBe('/client/sessions/sess%2F1/members');
    expect(buildLeaveSessionPath('sess/1')).toBe('/client/sessions/sess%2F1/leave');
    expect(buildTransferSessionOwnerPath('sess/1')).toBe(
      '/client/sessions/sess%2F1/transfer-owner',
    );
    expect(buildDissolveSessionPath('sess/1')).toBe('/client/sessions/sess%2F1/dissolve');
    expect(buildSessionInfoPath('sess/1')).toBe('/client/sessions/sess%2F1/info');
    expect(buildSessionSettingsPath('sess/1')).toBe('/client/sessions/sess%2F1/settings');
    expect(buildSessionPath('sess/1')).toBe('/client/sessions/sess%2F1');
    expect(buildMarkReadPath('sess/1')).toBe('/client/sessions/sess%2F1/read');
    expect(buildSessionPinsPath('sess/1')).toBe('/client/sessions/sess%2F1/pins');
    expect(buildSessionAgentsPath('sess/1')).toBe('/client/sessions/sess%2F1/agents');

    expect(buildRecallMessagePath('msg/1')).toBe('/client/messages/msg%2F1/recall');
    expect(buildPinMessagePath('msg/1')).toBe('/client/messages/msg%2F1/pin');
    expect(buildForwardMessagePath('msg/1')).toBe('/client/messages/msg%2F1/forward');
    expect(buildEditMessagePath('msg/1')).toBe('/client/messages/msg%2F1');
    expect(buildMessageReactionsPath('msg/1')).toBe('/client/messages/msg%2F1/reactions');
    expect(buildSearchMessagesPath({ q: 'a b', session_id: 's/1' })).toBe(
      '/client/messages/search?q=a+b&session_id=s%2F1',
    );
    expect(buildListNotificationsPath({ unread_only: true, limit: 10 })).toBe(
      '/client/notifications?unread_only=true&limit=10',
    );

    expect(buildAckTaskPath('task/1')).toBe('/edge/agent-tasks/task%2F1/ack');
    expect(buildStreamTaskPath('task/1')).toBe('/edge/agent-tasks/task%2F1/stream');
    expect(buildDoneTaskPath('task/1')).toBe('/edge/agent-tasks/task%2F1/done');
    expect(buildFailTaskPath('task/1')).toBe('/edge/agent-tasks/task%2F1/fail');
    expect(buildRegenerateAgentTaskPath('task/1')).toBe(
      '/web/agent-tasks/task%2F1/regenerate',
    );

    expect(buildListExecutionTargetsPath({ pageSize: 5, target_type: 'edge' })).toBe(
      '/web/execution-targets?pageSize=5&target_type=edge',
    );
    expect(buildExecutionTargetPath('t/1')).toBe('/web/execution-targets/t%2F1');
    expect(buildPingExecutionTargetPath('t/1')).toBe('/web/execution-targets/t%2F1:ping');
    expect(buildListAuditEventsPath({ pageCursor: 'c/1' })).toBe(
      '/web/audit-events?pageCursor=c%2F1',
    );
    expect(buildRelayCommandPath('cmd/1')).toBe('/web/relay/commands/cmd%2F1');
    expect(buildAckRelayCommandPath('cmd/1')).toBe('/web/relay/commands/cmd%2F1:ack');
    expect(buildCustomAgentPath('agent/1')).toBe('/web/custom-agents/agent%2F1');

    expect(buildListPublicSkillsPath({ q: 'x' })).toBe('/web/skills?is_public=true&q=x');
    expect(buildListPublicMCPServersPath({ transport: 'stdio' })).toBe(
      '/web/mcp-servers?is_public=true&transport=stdio',
    );
    expect(buildListWorkspaceProjectsPath({ q: 'p' })).toBe('/web/projects?q=p');
    expect(buildWorkspaceProjectPath('p/1')).toBe('/web/projects/p%2F1');
    expect(buildWorkspaceProjectThreadsPath('p/1')).toBe('/web/projects/p%2F1/threads');

    expect(buildTaskRunEventSummaryPath('task/1')).toBe(
      '/web/agent-tasks/task%2F1/events/summary',
    );
    expect(buildListTaskRunEventsPath('task/1')).toBe('/web/agent-tasks/task%2F1/events');
    expect(buildAgentTeamPath('t/1')).toBe('/web/agent-teams/t%2F1');
    expect(buildAgentTeamMembersPath('t/1')).toBe('/web/agent-teams/t%2F1/members');
    expect(buildAgentTeamRunsPath('t/1')).toBe('/web/agent-teams/t%2F1/runs');
    expect(buildListAgentProfilesPath({ runtime_id: 'rt/1' })).toBe(
      '/web/agent-profiles?runtime_id=rt%2F1',
    );
    expect(buildAgentProfilePath('ap/1')).toBe('/web/agent-profiles/ap%2F1');
    expect(buildListDocumentsPath({ tag: 'notes' })).toBe('/web/documents?tag=notes');
    expect(buildDocumentPath('doc/1')).toBe('/web/documents/doc%2F1');
    expect(buildListTaskApprovalsPath('task/1')).toBe('/web/agent-tasks/task%2F1/approvals');
    expect(buildListTaskArtifactsPath('task/1')).toBe('/web/agent-tasks/task%2F1/artifacts');
  });

  it('builds pure JSON RequestInit helpers (#901)', () => {
    expect(buildJsonPostInit({ a: 1 })).toEqual({
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
    });
    expect(buildJsonPutInit({ b: 2 })).toEqual({
      method: 'PUT',
      body: JSON.stringify({ b: 2 }),
    });
    expect(buildJsonPatchInit({ c: 3 })).toEqual({
      method: 'PATCH',
      body: JSON.stringify({ c: 3 }),
    });
    expect(buildJsonDeleteInit({ d: 4 })).toEqual({
      method: 'DELETE',
      body: JSON.stringify({ d: 4 }),
    });
    expect(buildPostInit()).toEqual({ method: 'POST' });
    expect(buildPutInit()).toEqual({ method: 'PUT' });
    expect(buildDeleteInit()).toEqual({ method: 'DELETE' });
  });

  it('builds static path residual helpers (#913)', () => {
    expect(buildRegisterPath()).toBe('/client/auth/register');
    expect(buildLoginPath()).toBe('/client/auth/login');
    expect(buildRefreshPath()).toBe('/client/auth/refresh');
    expect(buildLogoutPath()).toBe('/client/auth/logout');
    expect(buildMePath()).toBe('/client/auth/me');
    expect(buildUpdateProfilePath()).toBe('/client/auth/profile');
    expect(buildChangePasswordPath()).toBe('/client/auth/change-password');
    expect(buildChangePasswordFallbackPath()).toBe('/client/auth/password');
    expect(buildOidcAuthorizePath()).toBe('/client/auth/oidc/authorize');
    expect(buildOidcCallbackPath()).toBe('/client/auth/oidc/callback');
    expect(buildListContactsPath()).toBe('/client/contacts');
    expect(buildFriendRequestsPath()).toBe('/client/contacts/friend-requests');
    expect(buildListSessionsPath()).toBe('/client/sessions');
    expect(buildCreatePrivateSessionPath()).toBe('/client/sessions/private');
    expect(buildCreateGroupSessionPath()).toBe('/client/sessions/group');
    expect(buildAgentTasksPath()).toBe('/web/agent-tasks');
    expect(buildExecutionTargetsPath()).toBe('/web/execution-targets');
    expect(buildRelayCommandsPath()).toBe('/web/relay/commands');
    expect(buildCustomAgentsPath()).toBe('/web/custom-agents');
    expect(buildAgentTeamsPath()).toBe('/web/agent-teams');
    expect(buildAgentProfilesPath()).toBe('/web/agent-profiles');
    expect(buildDocumentsPath()).toBe('/web/documents');
    expect(buildWorkspaceProjectsPath()).toBe('/web/projects');
    expect(buildSettingsPath()).toBe('/client/settings');
    expect(buildProbeAttachmentPath()).toBe('/client/attachments/probe');
    expect(buildAttachmentsPath()).toBe('/client/attachments');
  });

  it('builds optional POST body init with exactOptional omit (#913)', () => {
    expect(buildPostWithOptionalJsonBody(undefined)).toEqual({ method: 'POST' });
    expect(
      Object.prototype.hasOwnProperty.call(
        buildPostWithOptionalJsonBody(undefined),
        'body',
      ),
    ).toBe(false);
    expect(buildPostWithOptionalJsonBody(buildTaskAckBody())).toEqual({ method: 'POST' });
    expect(buildPostWithOptionalJsonBody(buildTaskAckBody('run-9'))).toEqual({
      method: 'POST',
      body: JSON.stringify({ run_id: 'run-9' }),
    });
  });

  it('builds change-password primary/fallback request pairs (#957)', () => {
    const body = { old_password: 'a', new_password: 'b' };
    expect(buildChangePasswordPrimary(body)).toEqual({
      path: '/client/auth/change-password',
      init: { method: 'POST', body: JSON.stringify(body) },
    });
    expect(buildChangePasswordFallback(body)).toEqual({
      path: '/client/auth/password',
      init: { method: 'PUT', body: JSON.stringify(body) },
    });
  });
});
