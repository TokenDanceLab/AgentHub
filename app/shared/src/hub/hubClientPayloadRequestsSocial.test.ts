// real_tested=true
import { describe, it, expect } from 'vitest';
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

function initBodyKeys(request: { init: Record<string, unknown> }): string[] {
  return Object.keys(request.init);
}

describe('hubClientPayloadRequestsSocial (#1101)', () => {
  describe('friend request lifecycle', () => {
    it('builds send-friend-request with optional message included', () => {
      expect(buildSendFriendRequest('user-1', 'hello there')).toEqual({
        path: '/client/contacts/friend-requests',
        init: {
          method: 'POST',
          body: JSON.stringify({ friend_id: 'user-1', message: 'hello there' }),
        },
      });
    });

    it('builds send-friend-request omitting the message key when omitted', () => {
      const request = buildSendFriendRequest('user-2');
      expect(request.path).toBe('/client/contacts/friend-requests');
      expect(request.init.method).toBe('POST');
      expect(request.init.body).toBe(JSON.stringify({ friend_id: 'user-2' }));
      expect(JSON.parse(request.init.body)).not.toHaveProperty('message');
    });

    it('builds send-friend-request keeping an explicitly empty message', () => {
      expect(buildSendFriendRequest('user-3', '').init.body).toBe(
        JSON.stringify({ friend_id: 'user-3', message: '' }),
      );
    });

    it('accepts a friend request with a bodyless POST', () => {
      const request = buildAcceptFriendRequest('req/1');
      expect(request).toEqual({
        path: '/client/contacts/friend-requests/req%2F1/accept',
        init: { method: 'POST' },
      });
      expect(initBodyKeys(request)).toEqual(['method']);
    });

    it('rejects a friend request with a bodyless POST', () => {
      const request = buildRejectFriendRequest('req/2');
      expect(request).toEqual({
        path: '/client/contacts/friend-requests/req%2F2/reject',
        init: { method: 'POST' },
      });
      expect(initBodyKeys(request)).toEqual(['method']);
    });
  });

  describe('contact management', () => {
    it('builds update-contact-remark as PUT with remark JSON body', () => {
      expect(buildUpdateContactRemarkRequest('friend/9', 'buddy')).toEqual({
        path: '/client/contacts/friend%2F9/remark',
        init: { method: 'PUT', body: JSON.stringify({ remark: 'buddy' }) },
      });
    });

    it('builds update-contact-remark with an empty remark string', () => {
      expect(buildUpdateContactRemarkRequest('friend-10', '').init.body).toBe(
        JSON.stringify({ remark: '' }),
      );
    });

    it('builds remove-contact as a bodyless DELETE', () => {
      const request = buildRemoveContactRequest('friend/3');
      expect(request).toEqual({
        path: '/client/contacts/friend%2F3',
        init: { method: 'DELETE' },
      });
      expect(initBodyKeys(request)).toEqual(['method']);
    });

    it('builds block-contact as a bodyless POST', () => {
      const request = buildBlockContactRequest('user/spam');
      expect(request).toEqual({
        path: '/client/contacts/user%2Fspam/block',
        init: { method: 'POST' },
      });
      expect(initBodyKeys(request)).toEqual(['method']);
    });

    it('builds unblock-contact as a bodyless POST', () => {
      const request = buildUnblockContactRequest('user/ok');
      expect(request).toEqual({
        path: '/client/contacts/user%2Fok/unblock',
        init: { method: 'POST' },
      });
      expect(initBodyKeys(request)).toEqual(['method']);
    });

    it('encodes reserved characters in contact ids', () => {
      expect(buildBlockContactRequest('a b&c').path).toBe('/client/contacts/a%20b%26c/block');
      expect(buildRemoveContactRequest('id?x=1').path).toBe('/client/contacts/id%3Fx%3D1');
    });
  });

  describe('session membership and ownership', () => {
    it('builds add-session-members with member_ids JSON body', () => {
      expect(buildAddSessionMembersRequest('sess-1', ['u1', 'u2'])).toEqual({
        path: '/client/sessions/sess-1/members',
        init: { method: 'POST', body: JSON.stringify({ member_ids: ['u1', 'u2'] }) },
      });
    });

    it('builds add-session-members with an empty member list', () => {
      expect(buildAddSessionMembersRequest('sess-2', []).init.body).toBe(
        JSON.stringify({ member_ids: [] }),
      );
    });

    it('builds transfer-session-ownership with new_owner_id body', () => {
      expect(buildTransferSessionOwnershipRequest('sess/3', 'owner/9')).toEqual({
        path: '/client/sessions/sess%2F3/transfer-owner',
        init: { method: 'POST', body: JSON.stringify({ new_owner_id: 'owner/9' }) },
      });
    });

    it('builds remove-session-member as a bodyless DELETE with encoded ids', () => {
      const request = buildRemoveSessionMemberRequest('sess/1', 'user/2');
      expect(request).toEqual({
        path: '/client/sessions/sess%2F1/members/user%2F2',
        init: { method: 'DELETE' },
      });
      expect(initBodyKeys(request)).toEqual(['method']);
    });

    it('builds mark-read with the last_read_seq body', () => {
      expect(buildMarkReadRequest('sess-4', 42)).toEqual({
        path: '/client/sessions/sess-4/read',
        init: { method: 'POST', body: JSON.stringify({ last_read_seq: 42 }) },
      });
    });

    it('builds mark-read at the zero boundary and large sequence values', () => {
      expect(buildMarkReadRequest('sess-5', 0).init.body).toBe(
        JSON.stringify({ last_read_seq: 0 }),
      );
      expect(buildMarkReadRequest('sess-5', Number.MAX_SAFE_INTEGER).init.body).toBe(
        JSON.stringify({ last_read_seq: Number.MAX_SAFE_INTEGER }),
      );
    });

    it('builds leave-session as a bodyless POST', () => {
      const request = buildLeaveSessionRequest('sess/6');
      expect(request).toEqual({
        path: '/client/sessions/sess%2F6/leave',
        init: { method: 'POST' },
      });
      expect(initBodyKeys(request)).toEqual(['method']);
    });

    it('builds dissolve-session as a bodyless POST', () => {
      const request = buildDissolveSessionRequest('sess/7');
      expect(request).toEqual({
        path: '/client/sessions/sess%2F7/dissolve',
        init: { method: 'POST' },
      });
      expect(initBodyKeys(request)).toEqual(['method']);
    });

    it('builds delete-session as a bodyless DELETE on the session path', () => {
      const request = buildDeleteSessionRequest('sess/8');
      expect(request).toEqual({
        path: '/client/sessions/sess%2F8',
        init: { method: 'DELETE' },
      });
      expect(initBodyKeys(request)).toEqual(['method']);
    });
  });

  describe('session creation, info, settings, and messaging', () => {
    it('builds create-private-session with a passthrough JSON body', () => {
      const body = { peer_id: 'peer-1', note: 'hi' };
      expect(buildCreatePrivateSessionRequest(body)).toEqual({
        path: '/client/sessions/private',
        init: { method: 'POST', body: JSON.stringify(body) },
      });
    });

    it('builds create-group-session with a passthrough JSON body', () => {
      const body = { name: 'team', member_ids: ['a', 'b'] };
      expect(buildCreateGroupSessionRequest(body)).toEqual({
        path: '/client/sessions/group',
        init: { method: 'POST', body: JSON.stringify(body) },
      });
    });

    it('builds create-group-session with an empty object body', () => {
      expect(buildCreateGroupSessionRequest({}).init.body).toBe('{}');
    });

    it('builds update-session-info as PUT with passthrough JSON body', () => {
      const body = { name: 'renamed', avatar: 'a.png' };
      expect(buildUpdateSessionInfoRequest('sess/9', body)).toEqual({
        path: '/client/sessions/sess%2F9/info',
        init: { method: 'PUT', body: JSON.stringify(body) },
      });
    });

    it('builds update-session-settings as PUT with passthrough JSON body', () => {
      const body = { muted: true, pinned_order: 1 };
      expect(buildUpdateSessionSettingsRequest('sess/10', body)).toEqual({
        path: '/client/sessions/sess%2F10/settings',
        init: { method: 'PUT', body: JSON.stringify(body) },
      });
    });

    it('builds send-message as POST on the session messages path', () => {
      const body = { content: 'hello', client_msg_id: 'cm-1' };
      expect(buildSendMessageRequest('sess/11', body)).toEqual({
        path: '/client/sessions/sess%2F11/messages',
        init: { method: 'POST', body: JSON.stringify(body) },
      });
    });

    it('builds add-agent-to-session as POST on the session agents path', () => {
      const body = { agent_id: 'agent-1', config: { model: 'x' } };
      expect(buildAddAgentToSessionRequest('sess/12', body)).toEqual({
        path: '/client/sessions/sess%2F12/agents',
        init: { method: 'POST', body: JSON.stringify(body) },
      });
    });

    it('serializes null and array passthrough bodies via JSON.stringify', () => {
      expect(buildUpdateSessionInfoRequest('sess-13', null).init.body).toBe('null');
      expect(buildCreatePrivateSessionRequest(['a', 1]).init.body).toBe('["a",1]');
    });
  });

  describe('message actions', () => {
    it('builds pin-message as POST with session_id body', () => {
      expect(buildPinMessageRequest('msg/1', 'sess/1')).toEqual({
        path: '/client/messages/msg%2F1/pin',
        init: { method: 'POST', body: JSON.stringify({ session_id: 'sess/1' }) },
      });
    });

    it('builds unpin-message as DELETE on the same pin path', () => {
      expect(buildUnpinMessageRequest('msg/2', 'sess/2')).toEqual({
        path: '/client/messages/msg%2F2/pin',
        init: { method: 'DELETE', body: JSON.stringify({ session_id: 'sess/2' }) },
      });
    });

    it('builds forward-message with target_session_ids body', () => {
      expect(buildForwardMessageRequest('msg/3', ['s1', 's2'])).toEqual({
        path: '/client/messages/msg%2F3/forward',
        init: {
          method: 'POST',
          body: JSON.stringify({ target_session_ids: ['s1', 's2'] }),
        },
      });
    });

    it('builds forward-message with an empty target list', () => {
      expect(buildForwardMessageRequest('msg/4', []).init.body).toBe(
        JSON.stringify({ target_session_ids: [] }),
      );
    });

    it('builds add-message-reaction as POST with session_id and emoji body', () => {
      expect(buildAddMessageReactionRequest('msg/5', 'sess/5', { emoji: '👍' })).toEqual({
        path: '/client/messages/msg%2F5/reactions',
        init: {
          method: 'POST',
          body: JSON.stringify({ session_id: 'sess/5', emoji: '👍' }),
        },
      });
    });

    it('builds remove-message-reaction as DELETE with the same reaction body', () => {
      expect(buildRemoveMessageReactionRequest('msg/6', 'sess/6', { emoji: '🎉' })).toEqual({
        path: '/client/messages/msg%2F6/reactions',
        init: {
          method: 'DELETE',
          body: JSON.stringify({ session_id: 'sess/6', emoji: '🎉' }),
        },
      });
    });

    it('builds edit-message as PUT on the bare message path', () => {
      const body = { content: 'edited' };
      expect(buildEditMessageRequest('msg/7', body)).toEqual({
        path: '/client/messages/msg%2F7',
        init: { method: 'PUT', body: JSON.stringify(body) },
      });
    });

    it('builds recall-message as a bodyless POST', () => {
      const request = buildRecallMessageRequest('msg/8');
      expect(request).toEqual({
        path: '/client/messages/msg%2F8/recall',
        init: { method: 'POST' },
      });
      expect(initBodyKeys(request)).toEqual(['method']);
    });
  });
});
