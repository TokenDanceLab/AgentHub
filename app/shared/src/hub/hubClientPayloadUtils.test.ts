import { describe, expect, it } from 'vitest';
import {
  buildAcceptFriendRequest,
  buildAcceptFriendRequestPath,
  buildAckRelayCommandPath,
  buildAckRelayCommandRequest,
  buildAckTaskPath,
  buildAckTaskRequest,
  buildAddAgentTeamMemberRequest,
  buildAddAgentToSessionRequest,
  buildAddMessageReactionRequest,
  buildAddSessionMembersRequest,
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
  buildBlockContactRequest,
  buildCancelAgentTaskPaths,
  buildContactRemarkPath,
  buildCreateAgentProfileRequest,
  buildCreateAgentTeamRequest,
  buildCreateCustomAgentRequest,
  buildCreateDocumentRequest,
  buildCreateExecutionTargetRequest,
  buildCreateGroupSessionPath,
  buildCreateGroupSessionRequest,
  buildCreatePrivateSessionPath,
  buildCreatePrivateSessionRequest,
  buildCreateRelayCommandRequest,
  buildCreateWorkspaceProjectRequest,
  buildCreateWorkspaceProjectThreadRequest,
  buildCustomAgentPath,
  buildCustomAgentsPath,
  buildDecideTaskApprovalPath,
  buildDecideTaskApprovalRequest,
  buildDecideTeamApprovalPath,
  buildDecideTeamApprovalRequest,
  buildDeleteAgentProfileRequest,
  buildDeleteAgentTeamRequest,
  buildDeleteCustomAgentRequest,
  buildDeleteDocumentRequest,
  buildDeleteExecutionTargetRequest,
  buildDeleteInit,
  buildDeleteSessionRequest,
  buildDissolveSessionPath,
  buildDissolveSessionRequest,
  buildDocumentPath,
  buildDocumentsPath,
  buildDoneTaskPath,
  buildDoneTaskRequest,
  buildEditMessagePath,
  buildEditMessageRequest,
  buildExecutionTargetPath,
  buildExecutionTargetsPath,
  buildFailTaskPath,
  buildFailTaskRequest,
  buildForwardMessageBody,
  buildForwardMessagePath,
  buildForwardMessageRequest,
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
  buildLeaveSessionRequest,
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
  buildLogoutPath,
  buildLogoutRequest,
  buildMarkNotificationReadPaths,
  buildMarkReadBody,
  buildMarkReadPath,
  buildMarkReadRequest,
  buildMemberIdsBody,
  buildMePath,
  buildMessageReactionsPath,
  buildOidcAuthorizeBody,
  buildOidcAuthorizePath,
  buildOidcAuthorizeRequest,
  buildOidcCallbackPath,
  buildOidcCallbackPathInit,
  buildOptionalJsonBody,
  buildPatchSettingsBody,
  buildPatchSettingsRequest,
  buildPingExecutionTargetPath,
  buildPingExecutionTargetRequest,
  buildPinMessagePath,
  buildPinMessageRequest,
  buildPostInit,
  buildPostTeamRouteDecisionPath,
  buildPostTeamRouteDecisionRequest,
  buildPostWithOptionalJsonBody,
  buildProbeAttachmentBody,
  buildProbeAttachmentPath,
  buildProbeAttachmentRequest,
  buildPutInit,
  buildReactionBody,
  buildReadAllNotificationsPaths,
  buildRecallMessagePath,
  buildRecallMessageRequest,
  buildRefreshBody,
  buildRefreshPath,
  buildRefreshRequest,
  buildRegenerateAgentTaskPath,
  buildRegenerateAgentTaskRequest,
  buildRegisterDevicePaths,
  buildRejectFriendRequest,
  buildRejectFriendRequestPath,
  buildRelayCommandPath,
  buildRelayCommandsPath,
  buildRemarkBody,
  buildRemoveAgentTeamMemberPath,
  buildRemoveAgentTeamMemberRequest,
  buildRemoveContactPath,
  buildRemoveContactRequest,
  buildRemoveMessageReactionRequest,
  buildRemoveSessionMemberPath,
  buildRemoveSessionMemberRequest,
  buildResolveTeamConflictPath,
  buildResolveTeamConflictRequest,
  buildSearchMessagesPath,
  buildSearchSessionMessagesPath,
  buildSearchSessionsPath,
  buildSearchUserPath,
  buildSendFriendRequest,
  buildSendMessageRequest,
  buildSendWorkspaceProjectThreadMessagePath,
  buildSendWorkspaceProjectThreadMessageRequest,
  buildSessionAgentsPath,
  buildSessionIdBody,
  buildSessionInfoPath,
  buildSessionMembersPath,
  buildSessionPath,
  buildSessionPinsPath,
  buildSessionSettingsPath,
  buildSettingsPath,
  buildStartTeamRunRequest,
  buildStreamTaskEventBody,
  buildStreamTaskEventRequest,
  buildStreamTaskPath,
  buildStreamTaskRequest,
  buildSyncMessagesPath,
  buildTaskAckBody,
  buildTaskDoneBody,
  buildTaskFailBody,
  buildTaskRunEventSummaryPath,
  buildTaskStreamBody,
  buildTransferOwnerBody,
  buildTransferSessionOwnerPath,
  buildTransferSessionOwnershipRequest,
  buildTriggerAgentTaskBody,
  buildTriggerAgentTaskRequest,
  buildUnblockContactPath,
  buildUnblockContactRequest,
  buildUnpinMessageRequest,
  buildUpdateContactRemarkRequest,
  buildUpdateCustomAgentRequest,
  buildUpdateDocumentRequest,
  buildUpdateExecutionTargetRequest,
  buildUpdateProfilePath,
  buildUpdateProfileRequest,
  buildUpdateSessionInfoRequest,
  buildUpdateSessionSettingsRequest,
  buildUpdateAgentProfileRequest,
  buildUpdateAgentTeamRequest,
  buildUpdateWorkspaceProjectRequest,
  buildUploadAttachmentRequest,
  buildWorkspaceProjectPath,
  buildWorkspaceProjectsPath,
  buildWorkspaceProjectThreadsPath,
  normalizeExecutionTargetsResponse,
  withPublicCatalogParams,
} from './hubClientPayloadUtils';

describe('hubClientPayloadUtils (#810 / #822 / #833 / #901 / #913 / #978)', () => {
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
    expect(buildPingExecutionTargetPath('t/1')).toBe('/web/execution-targets/t%2F1/ping');
    expect(buildListAuditEventsPath({ pageCursor: 'c/1' })).toBe(
      '/web/audit-events?pageCursor=c%2F1',
    );
    expect(buildRelayCommandPath('cmd/1')).toBe('/web/relay/commands/cmd%2F1');
    expect(buildAckRelayCommandPath('cmd/1')).toBe('/web/relay/commands/cmd%2F1/device-ack');
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
    expect(buildRefreshPath()).toBe('/client/auth/refresh');
    expect(buildLogoutPath()).toBe('/client/auth/logout');
    expect(buildMePath()).toBe('/client/auth/me');
    expect(buildUpdateProfilePath()).toBe('/client/auth/profile');
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

  it('builds composite path+init residual helpers (#978)', () => {
    expect(buildRefreshRequest('rt-1')).toEqual({
      path: '/client/auth/refresh',
      init: { method: 'POST', body: JSON.stringify({ refresh_token: 'rt-1' }) },
    });
    expect(buildOidcAuthorizeRequest({ code_challenge: 'xyz' })).toEqual({
      path: '/client/auth/oidc/authorize',
      init: {
        method: 'POST',
        body: JSON.stringify({ code_challenge_method: 'S256', code_challenge: 'xyz' }),
      },
    });
    expect(buildSendFriendRequest('u-2', 'hi')).toEqual({
      path: '/client/contacts/friend-requests',
      init: { method: 'POST', body: JSON.stringify({ friend_id: 'u-2', message: 'hi' }) },
    });
    expect(buildSendFriendRequest('u-3')).toEqual({
      path: '/client/contacts/friend-requests',
      init: { method: 'POST', body: JSON.stringify({ friend_id: 'u-3' }) },
    });
    expect(buildUpdateContactRemarkRequest('user/c', 'buddy')).toEqual({
      path: '/client/contacts/user%2Fc/remark',
      init: { method: 'PUT', body: JSON.stringify({ remark: 'buddy' }) },
    });
    expect(buildAddSessionMembersRequest('sess/1', ['a', 'b'])).toEqual({
      path: '/client/sessions/sess%2F1/members',
      init: { method: 'POST', body: JSON.stringify({ member_ids: ['a', 'b'] }) },
    });
    expect(buildTransferSessionOwnershipRequest('sess/1', 'owner-9')).toEqual({
      path: '/client/sessions/sess%2F1/transfer-owner',
      init: { method: 'POST', body: JSON.stringify({ new_owner_id: 'owner-9' }) },
    });
    expect(buildMarkReadRequest('sess/1', 42)).toEqual({
      path: '/client/sessions/sess%2F1/read',
      init: { method: 'POST', body: JSON.stringify({ last_read_seq: 42 }) },
    });
    expect(buildPinMessageRequest('msg/1', 'sess/9')).toEqual({
      path: '/client/messages/msg%2F1/pin',
      init: { method: 'POST', body: JSON.stringify({ session_id: 'sess/9' }) },
    });
    expect(buildUnpinMessageRequest('msg/1', 'sess/9')).toEqual({
      path: '/client/messages/msg%2F1/pin',
      init: { method: 'DELETE', body: JSON.stringify({ session_id: 'sess/9' }) },
    });
    expect(buildForwardMessageRequest('msg/1', ['s1', 's2'])).toEqual({
      path: '/client/messages/msg%2F1/forward',
      init: { method: 'POST', body: JSON.stringify({ target_session_ids: ['s1', 's2'] }) },
    });

    expect(buildAckTaskRequest('task/1')).toEqual({
      path: '/edge/agent-tasks/task%2F1/ack',
      init: { method: 'POST' },
    });
    expect(
      Object.prototype.hasOwnProperty.call(buildAckTaskRequest('task/1').init, 'body'),
    ).toBe(false);
    expect(buildAckTaskRequest('task/1', 'run-9')).toEqual({
      path: '/edge/agent-tasks/task%2F1/ack',
      init: { method: 'POST', body: JSON.stringify({ run_id: 'run-9' }) },
    });
    expect(buildStreamTaskRequest('task/1', 'hello', 'run-2')).toEqual({
      path: '/edge/agent-tasks/task%2F1/stream',
      init: { method: 'POST', body: JSON.stringify({ content: 'hello', run_id: 'run-2' }) },
    });
    expect(buildDoneTaskRequest('task/1', 'done')).toEqual({
      path: '/edge/agent-tasks/task%2F1/done',
      init: { method: 'POST', body: JSON.stringify({ final_content: 'done' }) },
    });
    expect(buildFailTaskRequest('task/1', 'boom', 'run-4')).toEqual({
      path: '/edge/agent-tasks/task%2F1/fail',
      init: { method: 'POST', body: JSON.stringify({ error: 'boom', run_id: 'run-4' }) },
    });
    expect(buildTriggerAgentTaskRequest('msg-1', { agent_type: 'claude' })).toEqual({
      path: '/web/agent-tasks',
      init: {
        method: 'POST',
        body: JSON.stringify({ trigger_message_id: 'msg-1', agent_type: 'claude' }),
      },
    });
    expect(buildAddMessageReactionRequest('msg/1', 'sess-1', { emoji: '👍' })).toEqual({
      path: '/client/messages/msg%2F1/reactions',
      init: { method: 'POST', body: JSON.stringify({ session_id: 'sess-1', emoji: '👍' }) },
    });
    expect(buildRemoveMessageReactionRequest('msg/1', 'sess-1', { emoji: '👍' })).toEqual({
      path: '/client/messages/msg%2F1/reactions',
      init: { method: 'DELETE', body: JSON.stringify({ session_id: 'sess-1', emoji: '👍' }) },
    });
    expect(buildPatchSettingsRequest({ theme: 'dark' })).toEqual({
      path: '/client/settings',
      init: { method: 'PATCH', body: JSON.stringify({ values: { theme: 'dark' } }) },
    });
    expect(buildProbeAttachmentRequest('sha256')).toEqual({
      path: '/client/attachments/probe',
      init: { method: 'POST', body: JSON.stringify({ hash: 'sha256' }) },
    });
    expect(buildStreamTaskEventRequest('task/1', 'token', { t: 1 }, { runId: 'r1' })).toEqual({
      path: '/edge/agent-tasks/task%2F1/stream',
      init: {
        method: 'POST',
        body: JSON.stringify({ event_type: 'token', payload: { t: 1 }, run_id: 'r1' }),
      },
    });

    const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
    const upload = buildUploadAttachmentRequest(file, 'hash-1');
    expect(upload.path).toBe('/client/attachments');
    expect(upload.formData.get('hash')).toBe('hash-1');
    expect(upload.formData.get('original_name')).toBe('note.txt');
  });

  it('peels remaining path+init composites used by createHubClient (#1055)', () => {
    expect(buildLogoutRequest()).toEqual({
      path: '/client/auth/logout',
      init: { method: 'POST' },
    });
    expect(buildUpdateProfileRequest({ nickname: 'n' })).toEqual({
      path: '/client/auth/profile',
      init: { method: 'PUT', body: JSON.stringify({ nickname: 'n' }) },
    });
    expect(buildOidcCallbackPathInit({ code: 'c', state: 's' })).toEqual({
      path: '/client/auth/oidc/callback',
      init: { method: 'POST', body: JSON.stringify({ code: 'c', state: 's' }) },
    });
    expect(buildAcceptFriendRequest('req/1')).toEqual({
      path: '/client/contacts/friend-requests/req%2F1/accept',
      init: { method: 'POST' },
    });
    expect(buildRejectFriendRequest('req/1')).toEqual({
      path: '/client/contacts/friend-requests/req%2F1/reject',
      init: { method: 'POST' },
    });
    expect(buildRemoveContactRequest('friend/1')).toEqual({
      path: '/client/contacts/friend%2F1',
      init: { method: 'DELETE' },
    });
    expect(buildBlockContactRequest('user/1')).toEqual({
      path: '/client/contacts/user%2F1/block',
      init: { method: 'POST' },
    });
    expect(buildUnblockContactRequest('user/1')).toEqual({
      path: '/client/contacts/user%2F1/unblock',
      init: { method: 'POST' },
    });
    expect(buildCreatePrivateSessionRequest({ peer_user_id: 'p1' })).toEqual({
      path: '/client/sessions/private',
      init: { method: 'POST', body: JSON.stringify({ peer_user_id: 'p1' }) },
    });
    expect(buildCreateGroupSessionRequest({ name: 'g' })).toEqual({
      path: '/client/sessions/group',
      init: { method: 'POST', body: JSON.stringify({ name: 'g' }) },
    });
    expect(buildRemoveSessionMemberRequest('sess/1', 'user/2')).toEqual({
      path: '/client/sessions/sess%2F1/members/user%2F2',
      init: { method: 'DELETE' },
    });
    expect(buildLeaveSessionRequest('sess/1')).toEqual({
      path: '/client/sessions/sess%2F1/leave',
      init: { method: 'POST' },
    });
    expect(buildDissolveSessionRequest('sess/1')).toEqual({
      path: '/client/sessions/sess%2F1/dissolve',
      init: { method: 'POST' },
    });
    expect(buildUpdateSessionInfoRequest('sess/1', { title: 't' })).toEqual({
      path: '/client/sessions/sess%2F1/info',
      init: { method: 'PUT', body: JSON.stringify({ title: 't' }) },
    });
    expect(buildUpdateSessionSettingsRequest('sess/1', { mute: true })).toEqual({
      path: '/client/sessions/sess%2F1/settings',
      init: { method: 'PUT', body: JSON.stringify({ mute: true }) },
    });
    expect(buildDeleteSessionRequest('sess/1')).toEqual({
      path: '/client/sessions/sess%2F1',
      init: { method: 'DELETE' },
    });
    expect(buildSendMessageRequest('sess/1', { content: 'hi' })).toEqual({
      path: '/client/sessions/sess%2F1/messages',
      init: { method: 'POST', body: JSON.stringify({ content: 'hi' }) },
    });
    expect(buildRecallMessageRequest('msg/1')).toEqual({
      path: '/client/messages/msg%2F1/recall',
      init: { method: 'POST' },
    });
    expect(buildAddAgentToSessionRequest('sess/1', { agent_type: 'codex' })).toEqual({
      path: '/client/sessions/sess%2F1/agents',
      init: { method: 'POST', body: JSON.stringify({ agent_type: 'codex' }) },
    });
    expect(buildRegenerateAgentTaskRequest('task/1')).toEqual({
      path: '/web/agent-tasks/task%2F1/regenerate',
      init: { method: 'POST' },
    });
    expect(buildCreateExecutionTargetRequest({ name: 'edge' })).toEqual({
      path: '/web/execution-targets',
      init: { method: 'POST', body: JSON.stringify({ name: 'edge' }) },
    });
    expect(buildUpdateExecutionTargetRequest('t1', { name: 'edge-2' })).toEqual({
      path: '/web/execution-targets/t1',
      init: { method: 'PATCH', body: JSON.stringify({ name: 'edge-2' }) },
    });
    expect(buildDeleteExecutionTargetRequest('t1')).toEqual({
      path: '/web/execution-targets/t1',
      init: { method: 'DELETE' },
    });
    expect(buildPingExecutionTargetRequest('t1')).toEqual({
      path: '/web/execution-targets/t1/ping',
      init: { method: 'POST' },
    });
    expect(buildCreateRelayCommandRequest({ command: 'ping' })).toEqual({
      path: '/web/relay/commands',
      init: { method: 'POST', body: JSON.stringify({ command: 'ping' }) },
    });
    expect(buildAckRelayCommandRequest('cmd/1', 'dev-1')).toEqual({
      path: '/web/relay/commands/cmd%2F1/device-ack',
      init: { method: 'POST', body: JSON.stringify({ device_id: 'dev-1' }) },
    });
    expect(buildCreateCustomAgentRequest({ name: 'a' })).toEqual({
      path: '/web/custom-agents',
      init: { method: 'POST', body: JSON.stringify({ name: 'a' }) },
    });
    expect(buildUpdateCustomAgentRequest('a1', { name: 'b' })).toEqual({
      path: '/web/custom-agents/a1',
      init: { method: 'PUT', body: JSON.stringify({ name: 'b' }) },
    });
    expect(buildDeleteCustomAgentRequest('a1')).toEqual({
      path: '/web/custom-agents/a1',
      init: { method: 'DELETE' },
    });
    expect(buildCreateWorkspaceProjectRequest({ name: 'p' })).toEqual({
      path: '/web/projects',
      init: { method: 'POST', body: JSON.stringify({ name: 'p' }) },
    });
    expect(buildUpdateWorkspaceProjectRequest('p1', { name: 'p2' })).toEqual({
      path: '/web/projects/p1',
      init: { method: 'PATCH', body: JSON.stringify({ name: 'p2' }) },
    });
    expect(buildCreateWorkspaceProjectThreadRequest('p1', { title: 't' })).toEqual({
      path: '/web/projects/p1/threads',
      init: { method: 'POST', body: JSON.stringify({ title: 't' }) },
    });
    expect(
      buildSendWorkspaceProjectThreadMessageRequest('p1', 'th1', { content: 'hi' }),
    ).toEqual({
      path: '/web/projects/p1/threads/th1/messages',
      init: { method: 'POST', body: JSON.stringify({ content: 'hi' }) },
    });
    expect(buildEditMessageRequest('msg/1', { content: 'edited' })).toEqual({
      path: '/client/messages/msg%2F1',
      init: { method: 'PUT', body: JSON.stringify({ content: 'edited' }) },
    });
    expect(buildCreateAgentTeamRequest({ name: 'team' })).toEqual({
      path: '/web/agent-teams',
      init: { method: 'POST', body: JSON.stringify({ name: 'team' }) },
    });
    expect(buildUpdateAgentTeamRequest('team/1', { name: 'team2' })).toEqual({
      path: '/web/agent-teams/team%2F1',
      init: { method: 'PUT', body: JSON.stringify({ name: 'team2' }) },
    });
    expect(buildDeleteAgentTeamRequest('team/1')).toEqual({
      path: '/web/agent-teams/team%2F1',
      init: { method: 'DELETE' },
    });
    expect(buildAddAgentTeamMemberRequest('team/1', { member_id: 'm1' })).toEqual({
      path: '/web/agent-teams/team%2F1/members',
      init: { method: 'POST', body: JSON.stringify({ member_id: 'm1' }) },
    });
    expect(buildStartTeamRunRequest('team/1', { goal: 'g' })).toEqual({
      path: '/web/agent-teams/team%2F1/runs',
      init: { method: 'POST', body: JSON.stringify({ goal: 'g' }) },
    });
    expect(
      buildDecideTeamApprovalRequest('team/1', 'run/1', 'ap/1', { decision: 'approve' }),
    ).toEqual({
      path: '/web/agent-teams/team%2F1/runs/run%2F1/approvals/ap%2F1/decide',
      init: { method: 'POST', body: JSON.stringify({ decision: 'approve' }) },
    });
    expect(
      buildResolveTeamConflictRequest('team/1', 'run/1', 'cf/1', { choice: 'a' }),
    ).toEqual({
      path: '/web/agent-teams/team%2F1/runs/run%2F1/conflicts/cf%2F1/resolve',
      init: { method: 'POST', body: JSON.stringify({ choice: 'a' }) },
    });
    expect(buildCreateAgentProfileRequest({ name: 'prof' })).toEqual({
      path: '/web/agent-profiles',
      init: { method: 'POST', body: JSON.stringify({ name: 'prof' }) },
    });
    expect(buildUpdateAgentProfileRequest('prof1', { name: 'prof2' })).toEqual({
      path: '/web/agent-profiles/prof1',
      init: { method: 'PATCH', body: JSON.stringify({ name: 'prof2' }) },
    });
    expect(buildDeleteAgentProfileRequest('prof1')).toEqual({
      path: '/web/agent-profiles/prof1',
      init: { method: 'DELETE' },
    });
    expect(buildCreateDocumentRequest({ title: 'doc' })).toEqual({
      path: '/web/documents',
      init: { method: 'POST', body: JSON.stringify({ title: 'doc' }) },
    });
    expect(buildUpdateDocumentRequest('doc1', { title: 'doc2' })).toEqual({
      path: '/web/documents/doc1',
      init: { method: 'PATCH', body: JSON.stringify({ title: 'doc2' }) },
    });
    expect(buildDeleteDocumentRequest('doc1')).toEqual({
      path: '/web/documents/doc1',
      init: { method: 'DELETE' },
    });
    expect(buildRemoveAgentTeamMemberRequest('team/1', 'mem/1')).toEqual({
      path: '/web/agent-teams/team%2F1/members/mem%2F1',
      init: { method: 'DELETE' },
    });
    expect(
      buildPostTeamRouteDecisionRequest('team/1', 'run/1', { route: 'a' }),
    ).toEqual({
      path: '/web/agent-teams/team%2F1/runs/run%2F1/route-decisions',
      init: { method: 'POST', body: JSON.stringify({ route: 'a' }) },
    });
    expect(
      buildDecideTaskApprovalRequest('task/1', 'ap/1', { decision: 'approve' }),
    ).toEqual({
      path: '/web/agent-tasks/task%2F1/approvals/ap%2F1/decide',
      init: { method: 'POST', body: JSON.stringify({ decision: 'approve' }) },
    });
  });
});
