import { describe, expect, it } from 'vitest';
import { HUB_EVENTS } from '../hubEvents';
import type {
  HubAgentCancelFrame,
  HubAgentCancelPayload,
  HubAgentDispatchFrame,
  HubAgentDispatchPayload,
  HubAgentDoneFrame,
  HubAgentDonePayload,
  HubAgentFailedFrame,
  HubAgentFailedPayload,
  HubAgentStreamFrame,
  HubAgentStreamPayload,
  HubAuthOkFrame,
  HubDeviceKickedFrame,
  HubDeviceKickedPayload,
  HubDeviceOfflineFrame,
  HubDeviceOnlineFrame,
  HubDevicePresencePayload,
  HubFrame,
  HubFriendAcceptedFrame,
  HubFriendEventPayload,
  HubFriendRequestFrame,
  HubKnownFrame,
  HubMessageNewFrame,
  HubMessagePinFrame,
  HubMessagePinPayload,
  HubMessageReactionAddedFrame,
  HubMessageReactionPayload,
  HubMessageReactionRemovedFrame,
  HubMessageReadFrame,
  HubMessageRecallFrame,
  HubMessageUnpinFrame,
  HubMessageUnpinPayload,
  HubNotificationNewFrame,
  HubSessionCreatedFrame,
  HubSessionDissolvedFrame,
  HubSessionInfoUpdatedFrame,
  HubSessionMemberEventPayload,
  HubSessionMemberJoinedFrame,
  HubSessionMemberLeftFrame,
} from './hubClientFrameTypes';
import type {
  HubAgentDispatchPayload as ReexportedDispatchPayload,
  HubFrame as ReexportedFrame,
  HubKnownFrame as ReexportedKnownFrame,
} from './hubClient';

describe('hubClientFrameTypes (#788)', () => {
  it('keeps device / agent / friend payload field contracts stable', () => {
    const presence: HubDevicePresencePayload = {
      user_id: 'u1',
    };
    const kicked: HubDeviceKickedPayload = {
      device_id: 'd1',
      reason: 'duplicate_login',
    };
    const dispatch: HubAgentDispatchPayload = {
      task_id: 't1',
      agent_instance_id: 'ai1',
      agent_type: 'codex',
      session_id: 's1',
      trigger_message_id: 'm1',
      trigger_user_id: 'u1',
      display_name: 'Helper',
    };
    const stream: HubAgentStreamPayload = {
      task_id: 't1',
      run_id: 'r1',
      content: 'chunk',
    };
    const done: HubAgentDonePayload = {
      task_id: 't1',
      run_id: 'r1',
      final_content: 'done',
      status: 'done',
    };
    const failed: HubAgentFailedPayload = {
      task_id: 't2',
      error_message: 'boom',
      run_id: 'r2',
    };
    const cancel: HubAgentCancelPayload = { task_id: 't3' };
    const friend: HubFriendEventPayload = {
      request_id: 'fr1',
      user_id: 'u2',
      nickname: 'Bob',
    };

    expect(presence.user_id).toBe('u1');
    expect(kicked.reason).toBe('duplicate_login');
    expect(dispatch.display_name).toBe('Helper');
    expect(stream.content).toBe('chunk');
    expect(done.status).toBe('done');
    expect(failed.error_message).toBe('boom');
    expect(cancel.task_id).toBe('t3');
    expect(friend.nickname).toBe('Bob');
  });

  it('keeps message pin / reaction / member payload contracts stable', () => {
    const pin: HubMessagePinPayload = {
      session_id: 's1',
      message_id: 'm1',
      pinned_by_user_id: 'u1',
      pinned_at: '2026-01-01T00:00:00Z',
    };
    const unpin: HubMessageUnpinPayload = {
      session_id: 's1',
      message_id: 'm1',
    };
    const reaction: HubMessageReactionPayload = {
      action: 'add',
      user_id: 'u1',
      message_id: 'm1',
      session_id: 's1',
      reaction: '👍',
      count: 1,
    };
    const member: HubSessionMemberEventPayload = {
      session_id: 's1',
      member_id: 'u2',
      member_type: 'user',
    };

    expect(pin.pinned_by_user_id).toBe('u1');
    expect(unpin.message_id).toBe('m1');
    expect(reaction.count).toBe(1);
    expect(member.member_type).toBe('user');
  });

  it('binds typed frames to HUB_EVENTS constants', () => {
    const authOk: HubAuthOkFrame = { type: HUB_EVENTS.AUTH_OK };
    const messageNew: HubMessageNewFrame = {
      type: HUB_EVENTS.MESSAGE_NEW,
      payload: {
        id: 'm1',
        session_id: 's1',
        seq_id: 1,
        sender_type: 'user',
        sender_id: 'u1',
        content_type: 'text',
        content: '{"text":"hi"}',
      },
    };
    const messageRecall: HubMessageRecallFrame = {
      type: HUB_EVENTS.MESSAGE_RECALL,
      payload: { message_id: 'm1', session_id: 's1' },
    };
    const messagePin: HubMessagePinFrame = {
      type: HUB_EVENTS.MESSAGE_PIN,
      payload: {
        session_id: 's1',
        message_id: 'm1',
        pinned_by_user_id: 'u1',
        pinned_at: '2026-01-01T00:00:00Z',
      },
    };
    const messageUnpin: HubMessageUnpinFrame = {
      type: HUB_EVENTS.MESSAGE_UNPIN,
      payload: { session_id: 's1', message_id: 'm1' },
    };
    const messageRead: HubMessageReadFrame = {
      type: HUB_EVENTS.MESSAGE_READ,
      payload: { session_id: 's1', user_id: 'u1', last_read_seq: 9 },
    };
    const reactionAdded: HubMessageReactionAddedFrame = {
      type: HUB_EVENTS.MESSAGE_REACTION_ADDED,
      payload: {
        action: 'add',
        user_id: 'u1',
        message_id: 'm1',
        session_id: 's1',
        reaction: '🎉',
        count: 2,
      },
    };
    const reactionRemoved: HubMessageReactionRemovedFrame = {
      type: HUB_EVENTS.MESSAGE_REACTION_REMOVED,
      payload: {
        action: 'remove',
        user_id: 'u1',
        message_id: 'm1',
        session_id: 's1',
        reaction: '🎉',
        count: 1,
      },
    };
    const sessionCreated: HubSessionCreatedFrame = {
      type: HUB_EVENTS.SESSION_CREATED,
      payload: { session_id: 's1', type: 'private' },
    };
    const sessionInfo: HubSessionInfoUpdatedFrame = {
      type: HUB_EVENTS.SESSION_INFO_UPDATED,
      payload: { session_id: 's1', name: 'Room' },
    };
    const sessionDissolved: HubSessionDissolvedFrame = {
      type: HUB_EVENTS.SESSION_DISSOLVED,
      payload: { session_id: 's1' },
    };
    const memberJoined: HubSessionMemberJoinedFrame = {
      type: HUB_EVENTS.SESSION_MEMBER_JOINED,
      payload: { session_id: 's1', member_id: 'u2' },
    };
    const memberLeft: HubSessionMemberLeftFrame = {
      type: HUB_EVENTS.SESSION_MEMBER_LEFT,
      payload: { session_id: 's1', member_id: 'u2' },
    };
    const agentDispatch: HubAgentDispatchFrame = {
      type: HUB_EVENTS.AGENT_DISPATCH,
      payload: {
        task_id: 't1',
        agent_instance_id: 'ai1',
        agent_type: 'codex',
        session_id: 's1',
        trigger_message_id: 'm1',
        trigger_user_id: 'u1',
        display_name: 'Helper',
      },
    };
    const agentStream: HubAgentStreamFrame = {
      type: HUB_EVENTS.AGENT_STREAM,
      payload: { task_id: 't1', run_id: 'r1', content: 'chunk' },
    };
    const agentDone: HubAgentDoneFrame = {
      type: HUB_EVENTS.AGENT_DONE,
      payload: { task_id: 't1', final_content: 'done', edge_run_id: 'r1' },
    };
    const agentFailed: HubAgentFailedFrame = {
      type: HUB_EVENTS.AGENT_FAILED,
      payload: { task_id: 't2', error_message: 'boom' },
    };
    const agentCancel: HubAgentCancelFrame = {
      type: HUB_EVENTS.AGENT_CANCEL,
      payload: { task_id: 't3' },
    };
    const deviceOnline: HubDeviceOnlineFrame = {
      type: HUB_EVENTS.DEVICE_ONLINE,
      payload: { user_id: 'u1' },
    };
    const deviceOffline: HubDeviceOfflineFrame = {
      type: HUB_EVENTS.DEVICE_OFFLINE,
      payload: { user_id: 'u1' },
    };
    const deviceKicked: HubDeviceKickedFrame = {
      type: HUB_EVENTS.DEVICE_KICKED,
      payload: { device_id: 'd1', reason: 'logout' },
    };
    const notification: HubNotificationNewFrame = {
      type: HUB_EVENTS.NOTIFICATION_NEW,
      payload: {
        id: 'n1',
        user_id: 'u1',
        type: 'friend_request',
        payload: '{}',
        read: false,
        created_at: '2026-01-01T00:00:00Z',
      },
    };
    const friendRequest: HubFriendRequestFrame = {
      type: HUB_EVENTS.FRIEND_REQUEST,
      payload: { request_id: 'fr1', user_id: 'u2' },
    };
    const friendAccepted: HubFriendAcceptedFrame = {
      type: HUB_EVENTS.FRIEND_ACCEPTED,
      payload: { user_id: 'u2', friend_id: 'u1' },
    };
    const generic: HubFrame<{ ok: boolean }, typeof HUB_EVENTS.TYPING> = {
      type: HUB_EVENTS.TYPING,
      payload: { ok: true },
      seq_id: 12,
    };

    const known: HubKnownFrame[] = [
      authOk,
      messageNew,
      messageRecall,
      messagePin,
      messageUnpin,
      messageRead,
      reactionAdded,
      reactionRemoved,
      sessionCreated,
      sessionInfo,
      sessionDissolved,
      memberJoined,
      memberLeft,
      agentDispatch,
      agentStream,
      agentDone,
      agentFailed,
      agentCancel,
      deviceOnline,
      deviceOffline,
      deviceKicked,
      notification,
      friendRequest,
      friendAccepted,
      generic,
    ];

    expect(known.map((frame) => frame.type)).toEqual([
      'auth.ok',
      'message.new',
      'message.recall',
      'message.pin',
      'message.unpin',
      'message.read',
      'message.reaction_added',
      'message.reaction_removed',
      'session.created',
      'session.info_updated',
      'session.dissolved',
      'session.member_joined',
      'session.member_left',
      'agent.dispatch',
      'agent.stream',
      'agent.done',
      'agent.failed',
      'agent.cancel',
      'device.online',
      'device.offline',
      'device.kicked',
      'notification.new',
      'friend.request',
      'friend.accepted',
      'typing',
    ]);
    expect(generic.seq_id).toBe(12);
  });

  it('re-exports frame types from hubClient without API rename', () => {
    const dispatch: ReexportedDispatchPayload = {
      task_id: 't1',
      agent_instance_id: 'ai1',
      agent_type: 'codex',
      session_id: 's1',
      trigger_message_id: 'm1',
      trigger_user_id: 'u1',
      display_name: 'Helper',
    };
    const frame: ReexportedFrame<ReexportedDispatchPayload, typeof HUB_EVENTS.AGENT_DISPATCH> = {
      type: HUB_EVENTS.AGENT_DISPATCH,
      payload: dispatch,
    };
    const known: ReexportedKnownFrame = frame;

    expect(known.type).toBe('agent.dispatch');
    expect(dispatch.session_id).toBe('s1');
  });
});
