// real_tested=true
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
  buildAttachmentsPath,
  buildBlockContactPath,
  buildCancelAgentTaskPaths,
  buildContactRemarkPath,
  buildCreateGroupSessionPath,
  buildCreatePrivateSessionPath,
  buildCustomAgentPath,
  buildCustomAgentsPath,
  buildDecideTaskApprovalPath,
  buildDecideTeamApprovalPath,
  buildDissolveSessionPath,
  buildDocumentPath,
  buildDocumentsPath,
  buildDoneTaskPath,
  buildEditMessagePath,
  buildExecutionTargetPath,
  buildExecutionTargetsPath,
  buildFailTaskPath,
  buildForwardMessagePath,
  buildFriendRequestsPath,
  buildGetMessagesPath,
  buildGetTeamRunPath,
  buildGetTeamRunStatePath,
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
  buildListWorkspaceProjectThreadMessagesPath,
  buildListWorkspaceProjectsPath,
  buildLogoutPath,
  buildMarkNotificationReadPaths,
  buildMarkReadPath,
  buildMePath,
  buildMessageReactionsPath,
  buildOidcAuthorizePath,
  buildOidcCallbackPath,
  buildPinMessagePath,
  buildPingExecutionTargetPath,
  buildPostTeamRouteDecisionPath,
  buildProbeAttachmentPath,
  buildReadAllNotificationsPaths,
  buildRecallMessagePath,
  buildRefreshPath,
  buildRegenerateAgentTaskPath,
  buildRegisterDevicePaths,
  buildRejectFriendRequestPath,
  buildRelayCommandPath,
  buildRelayCommandsPath,
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
  buildSessionInfoPath,
  buildSessionMembersPath,
  buildSessionPath,
  buildSessionPinsPath,
  buildSessionSettingsPath,
  buildSettingsPath,
  buildStreamTaskPath,
  buildSyncMessagesPath,
  buildTaskRunEventSummaryPath,
  buildTransferSessionOwnerPath,
  buildUnblockContactPath,
  buildUpdateProfilePath,
  buildWorkspaceProjectPath,
  buildWorkspaceProjectThreadsPath,
  buildWorkspaceProjectsPath,
} from './hubClientPayloadPaths';

describe('hubClientPayloadPaths (#822 / #833 / #901 / #913)', () => {
  it('builds search paths with percent-encoded ids (#822)', () => {
    expect(buildSearchUserPath('user/1')).toBe('/client/contacts/search?id=user%2F1');
    expect(buildSearchUserPath('')).toBe('/client/contacts/search?id=');
    expect(buildSearchUserPath('用户@a&b')).toBe(
      '/client/contacts/search?id=%E7%94%A8%E6%88%B7%40a%26b',
    );
    expect(buildSearchSessionsPath('hello world')).toBe('/client/sessions/search?q=hello%20world');
    expect(buildListMessageReactionsPath('msg/1', 'sess/2')).toBe(
      '/client/messages/msg%2F1/reactions?session_id=sess%2F2',
    );
  });

  it('builds task event listing paths with numeric query params', () => {
    expect(buildListTaskRunEventsAfterPath('task/1', 7)).toBe(
      '/web/agent-tasks/task%2F1/events?after_seq=7&limit=500',
    );
    expect(buildListTaskRunEventsAfterPath('task/1', 0)).toBe(
      '/web/agent-tasks/task%2F1/events?after_seq=0&limit=500',
    );
    expect(buildListTaskRunEventsAfterPath('task/1', -3)).toBe(
      '/web/agent-tasks/task%2F1/events?after_seq=-3&limit=500',
    );
  });

  it('builds colon-then-slash fallback path pairs', () => {
    expect(buildCancelAgentTaskPaths('task/1')).toEqual([
      '/web/agent-tasks/task%2F1:cancel',
      '/web/agent-tasks/task%2F1/cancel',
    ]);
    expect(buildCancelAgentTaskPaths('t:1')).toEqual([
      '/web/agent-tasks/t%3A1:cancel',
      '/web/agent-tasks/t%3A1/cancel',
    ]);
    expect(buildMarkNotificationReadPaths('n/1')).toEqual([
      '/client/notifications/n%2F1:read',
      '/client/notifications/n%2F1/read',
    ]);
    expect(buildReadAllNotificationsPaths()).toEqual([
      '/client/notifications:read-all',
      '/client/notifications/read-all',
    ]);
  });

  it('builds team approval decision paths', () => {
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

  it('builds edge device registration fallback paths', () => {
    expect(buildRegisterDevicePaths()).toEqual([
      '/edge/devices:register',
      '/edge/devices/register',
    ]);
  });

  it('builds contact request, block and remark paths (#833 / #901)', () => {
    expect(buildAcceptFriendRequestPath('req/1')).toBe(
      '/client/contacts/friend-requests/req%2F1/accept',
    );
    expect(buildRejectFriendRequestPath('req/2')).toBe(
      '/client/contacts/friend-requests/req%2F2/reject',
    );
    expect(buildBlockContactPath('user/a')).toBe('/client/contacts/user%2Fa/block');
    expect(buildBlockContactPath('')).toBe('/client/contacts//block');
    expect(buildUnblockContactPath('user/b')).toBe('/client/contacts/user%2Fb/unblock');
    expect(buildContactRemarkPath('user/c')).toBe('/client/contacts/user%2Fc/remark');
    expect(buildRemoveContactPath('friend/x')).toBe('/client/contacts/friend%2Fx');
  });

  it('builds session message paths with optional query strings (#833)', () => {
    expect(buildRemoveSessionMemberPath('sess/1', 'user/2')).toBe(
      '/client/sessions/sess%2F1/members/user%2F2',
    );
    expect(buildGetMessagesPath('sess/1', { before_seq: 9, limit: 50 })).toBe(
      '/client/sessions/sess%2F1/messages?before_seq=9&limit=50',
    );
    expect(buildGetMessagesPath('sess/1')).toBe('/client/sessions/sess%2F1/messages');
    expect(buildGetMessagesPath('sess/1', {})).toBe('/client/sessions/sess%2F1/messages');
    expect(buildGetMessagesPath('sess/1', { before_seq: undefined })).toBe(
      '/client/sessions/sess%2F1/messages',
    );
    expect(buildGetMessagesPath('sess/1', { limit: 0 })).toBe(
      '/client/sessions/sess%2F1/messages?limit=0',
    );
    expect(buildSyncMessagesPath('sess/2', { after_seq: 3 })).toBe(
      '/client/sessions/sess%2F2/messages/sync?after_seq=3',
    );
    expect(buildSyncMessagesPath('sess/2', { after_seq: 0, limit: 10 })).toBe(
      '/client/sessions/sess%2F2/messages/sync?after_seq=0&limit=10',
    );
  });

  it('builds session message search paths with filters (#833)', () => {
    expect(buildSearchSessionMessagesPath('sess/3', { q: 'a b', content_type: 'text' })).toBe(
      '/client/sessions/sess%2F3/messages/search?q=a+b&content_type=text',
    );
    expect(
      buildSearchSessionMessagesPath('sess/3', {
        q: 'a b',
        content_type: 'text',
        from: 'u/1',
        to: 'u/2',
      }),
    ).toBe(
      '/client/sessions/sess%2F3/messages/search?q=a+b&content_type=text&from=u%2F1&to=u%2F2',
    );
    expect(buildSearchSessionMessagesPath('sess/4', { q: '' })).toBe(
      '/client/sessions/sess%2F4/messages/search?q=',
    );
  });

  it('builds workspace project thread message paths (#833)', () => {
    expect(buildListWorkspaceProjectThreadMessagesPath('p/1', 'th/2', { limit: 20 })).toBe(
      '/web/projects/p%2F1/threads/th%2F2/messages?limit=20',
    );
    expect(buildListWorkspaceProjectThreadMessagesPath('p/1', 'th/2')).toBe(
      '/web/projects/p%2F1/threads/th%2F2/messages',
    );
    expect(buildListWorkspaceProjectThreadMessagesPath('p/1', 'th/2', { limit: undefined })).toBe(
      '/web/projects/p%2F1/threads/th%2F2/messages',
    );
    expect(buildSendWorkspaceProjectThreadMessagePath('p/1', 'th/2')).toBe(
      '/web/projects/p%2F1/threads/th%2F2/messages',
    );
  });

  it('builds team run paths (#833)', () => {
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

  it('builds session lifecycle paths (#901)', () => {
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
  });

  it('builds message action paths (#901)', () => {
    expect(buildRecallMessagePath('msg/1')).toBe('/client/messages/msg%2F1/recall');
    expect(buildPinMessagePath('msg/1')).toBe('/client/messages/msg%2F1/pin');
    expect(buildForwardMessagePath('msg/1')).toBe('/client/messages/msg%2F1/forward');
    expect(buildEditMessagePath('msg/1')).toBe('/client/messages/msg%2F1');
    expect(buildMessageReactionsPath('msg/1')).toBe('/client/messages/msg%2F1/reactions');
  });

  it('builds message search and notification list query strings (#901)', () => {
    expect(buildSearchMessagesPath({ q: 'needle' })).toBe('/client/messages/search?q=needle');
    expect(
      buildSearchMessagesPath({
        q: 'a b',
        session_id: 's/1',
        content_type: 'image',
        from: '2024-01-01',
        to: '2024-02-01',
      }),
    ).toBe(
      '/client/messages/search?q=a+b&session_id=s%2F1&content_type=image&from=2024-01-01&to=2024-02-01',
    );
    expect(buildSearchMessagesPath({ q: '' })).toBe('/client/messages/search?q=');
    expect(buildListNotificationsPath()).toBe('/client/notifications');
    expect(buildListNotificationsPath({})).toBe('/client/notifications');
    expect(buildListNotificationsPath({ unread_only: true })).toBe(
      '/client/notifications?unread_only=true',
    );
    expect(buildListNotificationsPath({ unread_only: false, limit: 0, offset: 5 })).toBe(
      '/client/notifications?unread_only=false&limit=0&offset=5',
    );
    expect(buildListNotificationsPath({ limit: undefined, offset: undefined })).toBe(
      '/client/notifications',
    );
  });

  it('builds edge task lifecycle paths (#901)', () => {
    expect(buildAckTaskPath('task/1')).toBe('/edge/agent-tasks/task%2F1/ack');
    expect(buildStreamTaskPath('task/1')).toBe('/edge/agent-tasks/task%2F1/stream');
    expect(buildDoneTaskPath('task/1')).toBe('/edge/agent-tasks/task%2F1/done');
    expect(buildFailTaskPath('task/1')).toBe('/edge/agent-tasks/task%2F1/fail');
    expect(buildRegenerateAgentTaskPath('task/1')).toBe('/web/agent-tasks/task%2F1/regenerate');
  });

  it('builds execution-target list and detail paths (#901)', () => {
    expect(buildListExecutionTargetsPath()).toBe('/web/execution-targets');
    expect(
      buildListExecutionTargetsPath({ pageSize: 25, pageCursor: 'cur/1', target_type: 'edge' }),
    ).toBe('/web/execution-targets?pageSize=25&pageCursor=cur%2F1&target_type=edge');
    expect(buildListExecutionTargetsPath({ target_type: '' })).toBe(
      '/web/execution-targets?target_type=',
    );
    expect(buildExecutionTargetPath('et/1')).toBe('/web/execution-targets/et%2F1');
    expect(buildPingExecutionTargetPath('et/1')).toBe('/web/execution-targets/et%2F1/ping');
  });

  it('builds audit event and relay command paths (#901)', () => {
    expect(buildListAuditEventsPath()).toBe('/web/audit-events');
    expect(buildListAuditEventsPath({ pageSize: 50, pageCursor: 'p2' })).toBe(
      '/web/audit-events?pageSize=50&pageCursor=p2',
    );
    expect(buildRelayCommandPath('cmd/1')).toBe('/web/relay/commands/cmd%2F1');
    expect(buildAckRelayCommandPath('cmd/1')).toBe('/web/relay/commands/cmd%2F1/device-ack');
  });

  it('builds custom agent and public catalog paths with forced is_public (#901)', () => {
    expect(buildCustomAgentPath('ca/1')).toBe('/web/custom-agents/ca%2F1');
    expect(buildListPublicSkillsPath()).toBe('/web/skills?is_public=true');
    expect(buildListPublicSkillsPath({ skill_type: 'cli', q: 'git' })).toBe(
      '/web/skills?is_public=true&skill_type=cli&q=git',
    );
    expect(
      buildListPublicSkillsPath({ skill_type: undefined, pageCursor: 'c1', pageSize: 10 }),
    ).toBe('/web/skills?is_public=true&pageCursor=c1&pageSize=10');
    // A caller-supplied is_public is spread after the forced default and wins.
    expect(buildListPublicSkillsPath({ is_public: 'false', q: 'x' })).toBe(
      '/web/skills?is_public=false&q=x',
    );
    expect(buildListPublicMCPServersPath()).toBe('/web/mcp-servers?is_public=true');
    expect(buildListPublicMCPServersPath({ transport: 'streamable', pageSize: 20 })).toBe(
      '/web/mcp-servers?is_public=true&transport=streamable&pageSize=20',
    );
  });

  it('builds workspace project paths (#901)', () => {
    expect(buildListWorkspaceProjectsPath()).toBe('/web/projects');
    expect(buildListWorkspaceProjectsPath({ pageSize: 10, pageCursor: 'pc', q: 'name' })).toBe(
      '/web/projects?pageSize=10&pageCursor=pc&q=name',
    );
    expect(buildWorkspaceProjectPath('proj/1')).toBe('/web/projects/proj%2F1');
    expect(buildWorkspaceProjectThreadsPath('proj/1')).toBe('/web/projects/proj%2F1/threads');
  });

  it('builds agent team and task event paths (#901)', () => {
    expect(buildTaskRunEventSummaryPath('task/1')).toBe(
      '/web/agent-tasks/task%2F1/events/summary',
    );
    expect(buildListTaskRunEventsPath('task/1')).toBe('/web/agent-tasks/task%2F1/events');
    expect(buildAgentTeamPath('team/1')).toBe('/web/agent-teams/team%2F1');
    expect(buildAgentTeamMembersPath('team/1')).toBe('/web/agent-teams/team%2F1/members');
    expect(buildAgentTeamRunsPath('team/1')).toBe('/web/agent-teams/team%2F1/runs');
  });

  it('builds agent profile list and detail paths (#901)', () => {
    expect(buildListAgentProfilesPath()).toBe('/web/agent-profiles');
    expect(
      buildListAgentProfilesPath({ runtime_id: 'rt/1', q: 'ag', pageCursor: 'c', pageSize: 5 }),
    ).toBe('/web/agent-profiles?runtime_id=rt%2F1&q=ag&pageCursor=c&pageSize=5');
    expect(buildAgentProfilePath('prof/1')).toBe('/web/agent-profiles/prof%2F1');
  });

  it('builds document list and detail paths (#901)', () => {
    expect(buildListDocumentsPath()).toBe('/web/documents');
    expect(
      buildListDocumentsPath({
        status: 'ready',
        source: 'upload',
        tag: 't',
        pageCursor: 'c',
        pageSize: 10,
      }),
    ).toBe('/web/documents?status=ready&source=upload&tag=t&pageCursor=c&pageSize=10');
    expect(buildDocumentPath('doc/1')).toBe('/web/documents/doc%2F1');
  });

  it('builds task approval and artifact list paths (#901)', () => {
    expect(buildListTaskApprovalsPath('task/1')).toBe('/web/agent-tasks/task%2F1/approvals');
    expect(buildListTaskArtifactsPath('task/1')).toBe('/web/agent-tasks/task%2F1/artifacts');
  });

  it('builds auth static paths (#913)', () => {
    expect(buildRefreshPath()).toBe('/client/auth/refresh');
    expect(buildLogoutPath()).toBe('/client/auth/logout');
    expect(buildMePath()).toBe('/client/auth/me');
    expect(buildUpdateProfilePath()).toBe('/client/auth/profile');
    expect(buildOidcAuthorizePath()).toBe('/client/auth/oidc/authorize');
    expect(buildOidcCallbackPath()).toBe('/client/auth/oidc/callback');
  });

  it('builds static client collection paths (#913)', () => {
    expect(buildListContactsPath()).toBe('/client/contacts');
    expect(buildFriendRequestsPath()).toBe('/client/contacts/friend-requests');
    expect(buildListSessionsPath()).toBe('/client/sessions');
    expect(buildCreatePrivateSessionPath()).toBe('/client/sessions/private');
    expect(buildCreateGroupSessionPath()).toBe('/client/sessions/group');
    expect(buildSettingsPath()).toBe('/client/settings');
    expect(buildAttachmentsPath()).toBe('/client/attachments');
    expect(buildProbeAttachmentPath()).toBe('/client/attachments/probe');
  });

  it('builds static web collection paths (#913)', () => {
    expect(buildAgentTasksPath()).toBe('/web/agent-tasks');
    expect(buildExecutionTargetsPath()).toBe('/web/execution-targets');
    expect(buildRelayCommandsPath()).toBe('/web/relay/commands');
    expect(buildCustomAgentsPath()).toBe('/web/custom-agents');
    expect(buildAgentTeamsPath()).toBe('/web/agent-teams');
    expect(buildAgentProfilesPath()).toBe('/web/agent-profiles');
    expect(buildDocumentsPath()).toBe('/web/documents');
    expect(buildWorkspaceProjectsPath()).toBe('/web/projects');
  });

  it('percent-encodes unicode and reserved characters in path ids', () => {
    expect(buildSessionPath('会话/1?x=1&y=2')).toBe(
      '/client/sessions/%E4%BC%9A%E8%AF%9D%2F1%3Fx%3D1%26y%3D2',
    );
    expect(buildSessionPath('a b')).toBe('/client/sessions/a%20b');
    expect(buildSessionPath('')).toBe('/client/sessions/');
    expect(buildEditMessagePath('m#1!*')).toBe('/client/messages/m%231!*');
    expect(buildWorkspaceProjectPath('~keep._-')).toBe('/web/projects/~keep._-');
    expect(buildAgentTeamPath('team?a=b&c=d')).toBe('/web/agent-teams/team%3Fa%3Db%26c%3Dd');
  });

  it('percent-encodes unicode query values and skips null params', () => {
    expect(buildSearchMessagesPath({ q: '你好 世界' })).toBe(
      '/client/messages/search?q=%E4%BD%A0%E5%A5%BD+%E4%B8%96%E7%95%8C',
    );
    expect(buildGetMessagesPath('s1', { before_seq: null as unknown as number })).toBe(
      '/client/sessions/s1/messages',
    );
  });
});
