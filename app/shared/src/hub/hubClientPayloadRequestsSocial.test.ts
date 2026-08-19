// real_tested=true
import { describe, expect, it } from 'vitest';
import {
  buildAcceptFriendRequest,
  buildAddAgentToSessionRequest,
  buildAddMessageReactionRequest,
  buildAddSessionMembersRequest,
  buildBlockContactRequest,
  buildCreateGroupSessionRequest,
  buildCreatePrivateSessionRequest,
  buildDeleteSessionRequest,
  buildDissolveSessionRequest,
  buildEditMessageRequest,
  buildForwardMessageRequest,
  buildLeaveSessionRequest,
  buildMarkReadRequest,
  buildPinMessageRequest,
  buildRecallMessageRequest,
  buildRejectFriendRequest,
  buildRemoveContactRequest,
  buildRemoveMessageReactionRequest,
  buildRemoveSessionMemberRequest,
  buildSendFriendRequest,
  buildSendMessageRequest,
  buildTransferSessionOwnershipRequest,
  buildUnblockContactRequest,
  buildUnpinMessageRequest,
  buildUpdateContactRemarkRequest,
  buildUpdateSessionInfoRequest,
  buildUpdateSessionSettingsRequest,
} from './hubClientPayloadRequestsSocial';

describe('hubClientPayloadRequestsSocial — friend request builders', () => {
  it('builds send-friend-request POST with optional message omitted when undefined', () => {
    expect(buildSendFriendRequest('u-2', 'hi')).toEqual({
      path: '/client/contacts/friend-requests',
      init: {
        method: 'POST',
        body: JSON.stringify({ friend_id: 'u-2', message: 'hi' }),
      },
    });

    const withoutMessage = buildSendFriendRequest('u-3');
    expect(withoutMessage).toEqual({
      path: '/client/contacts/friend-requests',
      init: { method: 'POST', body: JSON.stringify({ friend_id: 'u-3' }) },
    });
    const parsedBody = JSON.parse(withoutMessage.init.body) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(parsedBody, 'message')).toBe(false);

    // Explicit empty string is a provided value, not absence.
    const emptyMessage = buildSendFriendRequest('u-4', '');
    expect(JSON.parse(emptyMessage.init.body) as Record<string, unknown>).toEqual({
      friend_id: 'u-4',
      message: '',
    });

    // Friend id is only serialized in the body — never path-encoded.
    expect(buildSendFriendRequest('user/with spaces', '打招呼 👍')).toEqual({
      path: '/client/contacts/friend-requests',
      init: {
        method: 'POST',
        body: JSON.stringify({ friend_id: 'user/with spaces', message: '打招呼 👍' }),
      },
    });
  });

  it('builds accept-friend-request POST with no body key and encoded id', () => {
    expect(buildAcceptFriendRequest('req/1')).toEqual({
      path: '/client/contacts/friend-requests/req%2F1/accept',
      init: { method: 'POST' },
    });
    expect(Object.prototype.hasOwnProperty.call(buildAcceptFriendRequest('req/1').init, 'body')).toBe(
      false,
    );
    expect(buildAcceptFriendRequest('req 好友')).toEqual({
      path: `/client/contacts/friend-requests/${encodeURIComponent('req 好友')}/accept`,
      init: { method: 'POST' },
    });
  });

  it('builds reject-friend-request POST with no body key and encoded id', () => {
    expect(buildRejectFriendRequest('req/2')).toEqual({
      path: '/client/contacts/friend-requests/req%2F2/reject',
      init: { method: 'POST' },
    });
    expect(Object.prototype.hasOwnProperty.call(buildRejectFriendRequest('req/2').init, 'body')).toBe(
      false,
    );
  });

  it('builds update-contact-remark PUT with remark body and encoded id', () => {
    expect(buildUpdateContactRemarkRequest('user/c', 'buddy')).toEqual({
      path: '/client/contacts/user%2Fc/remark',
      init: { method: 'PUT', body: JSON.stringify({ remark: 'buddy' }) },
    });

    // Empty remark is a valid value and must be serialized.
    expect(buildUpdateContactRemarkRequest('user/c', '')).toEqual({
      path: '/client/contacts/user%2Fc/remark',
      init: { method: 'PUT', body: JSON.stringify({ remark: '' }) },
    });

    expect(buildUpdateContactRemarkRequest('好友 1', '备注')).toEqual({
      path: `/client/contacts/${encodeURIComponent('好友 1')}/remark`,
      init: { method: 'PUT', body: JSON.stringify({ remark: '备注' }) },
    });
  });
});

describe('hubClientPayloadRequestsSocial — contact lifecycle builders', () => {
  it('builds remove-contact DELETE with no body key and encoded id', () => {
    expect(buildRemoveContactRequest('friend/1')).toEqual({
      path: '/client/contacts/friend%2F1',
      init: { method: 'DELETE' },
    });
    expect(Object.prototype.hasOwnProperty.call(buildRemoveContactRequest('friend/1').init, 'body')).toBe(
      false,
    );

    // Empty id yields a trailing slash, not an encoded placeholder.
    expect(buildRemoveContactRequest('')).toEqual({
      path: '/client/contacts/',
      init: { method: 'DELETE' },
    });
  });

  it('builds block-contact POST with no body key and encoded id', () => {
    expect(buildBlockContactRequest('user/1')).toEqual({
      path: '/client/contacts/user%2F1/block',
      init: { method: 'POST' },
    });
    expect(Object.prototype.hasOwnProperty.call(buildBlockContactRequest('user/1').init, 'body')).toBe(
      false,
    );
    expect(buildBlockContactRequest('user with space')).toEqual({
      path: '/client/contacts/user%20with%20space/block',
      init: { method: 'POST' },
    });
  });

  it('builds unblock-contact POST with no body key and encoded id', () => {
    expect(buildUnblockContactRequest('user/2')).toEqual({
      path: '/client/contacts/user%2F2/unblock',
      init: { method: 'POST' },
    });
    expect(Object.prototype.hasOwnProperty.call(buildUnblockContactRequest('user/2').init, 'body')).toBe(
      false,
    );
  });
});

describe('hubClientPayloadRequestsSocial — session membership builders', () => {
  it('builds add-session-members POST for multiple, single, and empty member lists', () => {
    expect(buildAddSessionMembersRequest('sess/1', ['a', 'b'])).toEqual({
      path: '/client/sessions/sess%2F1/members',
      init: { method: 'POST', body: JSON.stringify({ member_ids: ['a', 'b'] }) },
    });
    expect(buildAddSessionMembersRequest('sess/1', ['only'])).toEqual({
      path: '/client/sessions/sess%2F1/members',
      init: { method: 'POST', body: JSON.stringify({ member_ids: ['only'] }) },
    });
    // Empty list is serialized as an empty array, not omitted.
    expect(buildAddSessionMembersRequest('sess/1', [])).toEqual({
      path: '/client/sessions/sess%2F1/members',
      init: { method: 'POST', body: JSON.stringify({ member_ids: [] }) },
    });
  });

  it('builds transfer-session-ownership POST with encoded ids', () => {
    expect(buildTransferSessionOwnershipRequest('sess/1', 'owner-9')).toEqual({
      path: '/client/sessions/sess%2F1/transfer-owner',
      init: { method: 'POST', body: JSON.stringify({ new_owner_id: 'owner-9' }) },
    });
    expect(buildTransferSessionOwnershipRequest('会话', '新主人')).toEqual({
      path: `/client/sessions/${encodeURIComponent('会话')}/transfer-owner`,
      init: { method: 'POST', body: JSON.stringify({ new_owner_id: '新主人' }) },
    });
  });

  it('builds remove-session-member DELETE with no body key and both ids encoded', () => {
    expect(buildRemoveSessionMemberRequest('sess/1', 'user/2')).toEqual({
      path: '/client/sessions/sess%2F1/members/user%2F2',
      init: { method: 'DELETE' },
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        buildRemoveSessionMemberRequest('sess/1', 'user/2').init,
        'body',
      ),
    ).toBe(false);
  });
});

describe('hubClientPayloadRequestsSocial — session lifecycle builders', () => {
  it('builds create-private-session POST serializing arbitrary bodies', () => {
    expect(buildCreatePrivateSessionRequest({ peer_user_id: 'p1' })).toEqual({
      path: '/client/sessions/private',
      init: { method: 'POST', body: JSON.stringify({ peer_user_id: 'p1' }) },
    });

    // Nested payloads round-trip through JSON.stringify untouched.
    const nested = { peer_user_id: 'p2', meta: { invite: true, tags: ['a', 'b'] } };
    expect(buildCreatePrivateSessionRequest(nested)).toEqual({
      path: '/client/sessions/private',
      init: { method: 'POST', body: JSON.stringify(nested) },
    });

    // Empty object serializes as '{}'.
    expect(buildCreatePrivateSessionRequest({})).toEqual({
      path: '/client/sessions/private',
      init: { method: 'POST', body: '{}' },
    });

    // null serializes as the string 'null'.
    expect(buildCreatePrivateSessionRequest(null as unknown)).toEqual({
      path: '/client/sessions/private',
      init: { method: 'POST', body: 'null' },
    });
  });

  it('builds create-group-session POST and handles undefined body edge', () => {
    expect(buildCreateGroupSessionRequest({ name: 'g' })).toEqual({
      path: '/client/sessions/group',
      init: { method: 'POST', body: JSON.stringify({ name: 'g' }) },
    });

    // JSON.stringify(undefined) yields undefined, so body is undefined at runtime.
    const undefinedBody = buildCreateGroupSessionRequest(undefined as unknown);
    expect(undefinedBody.init.method).toBe('POST');
    expect(undefinedBody.init.body).toBeUndefined();
  });

  it('builds update-session-info PUT with encoded session id', () => {
    expect(buildUpdateSessionInfoRequest('sess/1', { title: 't' })).toEqual({
      path: '/client/sessions/sess%2F1/info',
      init: { method: 'PUT', body: JSON.stringify({ title: 't' }) },
    });
    expect(buildUpdateSessionInfoRequest('sess/1', {})).toEqual({
      path: '/client/sessions/sess%2F1/info',
      init: { method: 'PUT', body: '{}' },
    });
  });

  it('builds update-session-settings PUT with encoded session id', () => {
    expect(buildUpdateSessionSettingsRequest('sess/1', { mute: true })).toEqual({
      path: '/client/sessions/sess%2F1/settings',
      init: { method: 'PUT', body: JSON.stringify({ mute: true }) },
    });
    expect(buildUpdateSessionSettingsRequest('会话/1', { mute: false })).toEqual({
      path: `/client/sessions/${encodeURIComponent('会话/1')}/settings`,
      init: { method: 'PUT', body: JSON.stringify({ mute: false }) },
    });
  });

  it('builds leave/dissolve/delete-session requests with method-only init', () => {
    expect(buildLeaveSessionRequest('sess/1')).toEqual({
      path: '/client/sessions/sess%2F1/leave',
      init: { method: 'POST' },
    });
    expect(Object.prototype.hasOwnProperty.call(buildLeaveSessionRequest('sess/1').init, 'body')).toBe(
      false,
    );

    expect(buildDissolveSessionRequest('sess/1')).toEqual({
      path: '/client/sessions/sess%2F1/dissolve',
      init: { method: 'POST' },
    });
    expect(
      Object.prototype.hasOwnProperty.call(buildDissolveSessionRequest('sess/1').init, 'body'),
    ).toBe(false);

    expect(buildDeleteSessionRequest('sess/1')).toEqual({
      path: '/client/sessions/sess%2F1',
      init: { method: 'DELETE' },
    });
    expect(
      Object.prototype.hasOwnProperty.call(buildDeleteSessionRequest('sess/1').init, 'body'),
    ).toBe(false);
  });
});

describe('hubClientPayloadRequestsSocial — message builders', () => {
  it('builds mark-read POST with boundary sequence values and encoded session id', () => {
    expect(buildMarkReadRequest('sess/1', 42)).toEqual({
      path: '/client/sessions/sess%2F1/read',
      init: { method: 'POST', body: JSON.stringify({ last_read_seq: 42 }) },
    });
    expect(buildMarkReadRequest('sess/1', 0)).toEqual({
      path: '/client/sessions/sess%2F1/read',
      init: { method: 'POST', body: JSON.stringify({ last_read_seq: 0 }) },
    });
    expect(buildMarkReadRequest('sess/1', -7)).toEqual({
      path: '/client/sessions/sess%2F1/read',
      init: { method: 'POST', body: JSON.stringify({ last_read_seq: -7 }) },
    });
    expect(buildMarkReadRequest('sess/1', Number.MAX_SAFE_INTEGER)).toEqual({
      path: '/client/sessions/sess%2F1/read',
      init: {
        method: 'POST',
        body: JSON.stringify({ last_read_seq: Number.MAX_SAFE_INTEGER }),
      },
    });
  });

  it('builds pin-message POST and unpin-message DELETE with shared path and session body', () => {
    expect(buildPinMessageRequest('msg/1', 'sess/9')).toEqual({
      path: '/client/messages/msg%2F1/pin',
      init: { method: 'POST', body: JSON.stringify({ session_id: 'sess/9' }) },
    });
    expect(buildUnpinMessageRequest('msg/1', 'sess/9')).toEqual({
      path: '/client/messages/msg%2F1/pin',
      init: { method: 'DELETE', body: JSON.stringify({ session_id: 'sess/9' }) },
    });
    expect(buildPinMessageRequest('消息 1', '会话 9')).toEqual({
      path: `/client/messages/${encodeURIComponent('消息 1')}/pin`,
      init: { method: 'POST', body: JSON.stringify({ session_id: '会话 9' }) },
    });
  });

  it('builds forward-message POST for multiple, single, and empty target lists', () => {
    expect(buildForwardMessageRequest('msg/1', ['s1', 's2'])).toEqual({
      path: '/client/messages/msg%2F1/forward',
      init: {
        method: 'POST',
        body: JSON.stringify({ target_session_ids: ['s1', 's2'] }),
      },
    });
    expect(buildForwardMessageRequest('msg/1', ['only'])).toEqual({
      path: '/client/messages/msg%2F1/forward',
      init: { method: 'POST', body: JSON.stringify({ target_session_ids: ['only'] }) },
    });
    expect(buildForwardMessageRequest('msg/1', [])).toEqual({
      path: '/client/messages/msg%2F1/forward',
      init: { method: 'POST', body: JSON.stringify({ target_session_ids: [] }) },
    });
  });

  it('builds add-message-reaction POST and remove-message-reaction DELETE', () => {
    expect(buildAddMessageReactionRequest('msg/1', 'sess-1', { emoji: '👍' })).toEqual({
      path: '/client/messages/msg%2F1/reactions',
      init: {
        method: 'POST',
        body: JSON.stringify({ session_id: 'sess-1', emoji: '👍' }),
      },
    });
    expect(buildRemoveMessageReactionRequest('msg/1', 'sess-1', { emoji: '❤️' })).toEqual({
      path: '/client/messages/msg%2F1/reactions',
      init: {
        method: 'DELETE',
        body: JSON.stringify({ session_id: 'sess-1', emoji: '❤️' }),
      },
    });

    // Reaction emoji is serialized verbatim (no path encoding involved).
    expect(buildAddMessageReactionRequest('msg/1', 'sess-1', { emoji: '🎉' })).toEqual({
      path: '/client/messages/msg%2F1/reactions',
      init: {
        method: 'POST',
        body: JSON.stringify({ session_id: 'sess-1', emoji: '🎉' }),
      },
    });
  });

  it('builds edit-message PUT with encoded message id', () => {
    expect(buildEditMessageRequest('msg/1', { content: 'edited' })).toEqual({
      path: '/client/messages/msg%2F1',
      init: { method: 'PUT', body: JSON.stringify({ content: 'edited' }) },
    });
    expect(buildEditMessageRequest('消息/1', {})).toEqual({
      path: `/client/messages/${encodeURIComponent('消息/1')}`,
      init: { method: 'PUT', body: '{}' },
    });
  });

  it('builds recall-message POST with no body key and encoded message id', () => {
    expect(buildRecallMessageRequest('msg/1')).toEqual({
      path: '/client/messages/msg%2F1/recall',
      init: { method: 'POST' },
    });
    expect(Object.prototype.hasOwnProperty.call(buildRecallMessageRequest('msg/1').init, 'body')).toBe(
      false,
    );
  });

  it('builds send-message POST with encoded session id and stringified body', () => {
    expect(buildSendMessageRequest('sess/1', { content: 'hi' })).toEqual({
      path: '/client/sessions/sess%2F1/messages',
      init: { method: 'POST', body: JSON.stringify({ content: 'hi' }) },
    });
    expect(buildSendMessageRequest('sess/1', null as unknown)).toEqual({
      path: '/client/sessions/sess%2F1/messages',
      init: { method: 'POST', body: 'null' },
    });
  });

  it('builds add-agent-to-session POST with encoded session id', () => {
    expect(buildAddAgentToSessionRequest('sess/1', { agent_type: 'codex' })).toEqual({
      path: '/client/sessions/sess%2F1/agents',
      init: { method: 'POST', body: JSON.stringify({ agent_type: 'codex' }) },
    });
    expect(buildAddAgentToSessionRequest('sess/1', {})).toEqual({
      path: '/client/sessions/sess%2F1/agents',
      init: { method: 'POST', body: '{}' },
    });
  });
});
