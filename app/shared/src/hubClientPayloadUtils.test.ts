import { describe, expect, it } from 'vitest';
import {
  buildAttachmentDownloadUrl,
  buildAttachmentFormData,
  buildCancelAgentTaskPaths,
  buildDecideTeamApprovalPath,
  buildForwardMessageBody,
  buildFriendRequestBody,
  buildListMessageReactionsPath,
  buildListTaskRunEventsAfterPath,
  buildMarkNotificationReadPaths,
  buildMarkReadBody,
  buildMemberIdsBody,
  buildOidcAuthorizeBody,
  buildPatchSettingsBody,
  buildPostTeamRouteDecisionPath,
  buildProbeAttachmentBody,
  buildReactionBody,
  buildReadAllNotificationsPaths,
  buildRefreshBody,
  buildRemarkBody,
  buildResolveTeamConflictPath,
  buildSearchSessionsPath,
  buildSearchUserPath,
  buildSessionIdBody,
  buildStreamTaskEventBody,
  buildTaskAckBody,
  buildTaskDoneBody,
  buildTaskFailBody,
  buildTaskStreamBody,
  buildTransferOwnerBody,
  buildTriggerAgentTaskBody,
  normalizeExecutionTargetsResponse,
  withPublicCatalogParams,
} from './hubClientPayloadUtils';

describe('hubClientPayloadUtils (#810 / #822)', () => {
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
      message: undefined,
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
});
