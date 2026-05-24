// Hub WebSocket protocol constants and payload types.
// Canonical event type constants are in @shared/hubEvents.
// This module adds desktop-specific payload interfaces and the legacy
// per-constant re-exports for backward compatibility.

// ── Re-export canonical constants ────────────────
export { HUB_EVENTS } from '@shared/hubEvents';
export type { HubEventType } from '@shared/hubEvents';

// ── Legacy per-constant exports (backward compat) ─
export {
  HUB_EVENTS as default,
} from '@shared/hubEvents';

// Re-export every constant individually so existing imports don't break.
const E = {
  AUTH: 'auth',
  AUTH_OK: 'auth.ok',
  AUTH_FAIL: 'auth.fail',
  MESSAGE_NEW: 'message.new',
  MESSAGE_RECALL: 'message.recall',
  MESSAGE_PIN: 'message.pin',
  MESSAGE_UNPIN: 'message.unpin',
  MESSAGE_READ: 'message.read',
  SESSION_CREATED: 'session.created',
  SESSION_DISSOLVED: 'session.dissolved',
  SESSION_MEMBER_JOINED: 'session.member_joined',
  SESSION_MEMBER_LEFT: 'session.member_left',
  SESSION_INFO_UPDATED: 'session.info_updated',
  DEVICE_ONLINE: 'device.online',
  DEVICE_OFFLINE: 'device.offline',
  DEVICE_KICKED: 'device.kicked',
  AGENT_DISPATCH: 'agent.dispatch',
  AGENT_STREAM: 'agent.stream',
  AGENT_DONE: 'agent.done',
  AGENT_FAILED: 'agent.failed',
  AGENT_CANCEL: 'agent.cancel',
  NOTIFICATION_NEW: 'notification.new',
  FRIEND_REQUEST: 'friend.request',
  FRIEND_ACCEPTED: 'friend.accepted',
} as const;

export const TYPE_AUTH = E.AUTH;
export const TYPE_AUTH_OK = E.AUTH_OK;
export const TYPE_AUTH_FAIL = E.AUTH_FAIL;
export const TYPE_TYPING = 'typing';
export const TYPE_MESSAGE_NEW = E.MESSAGE_NEW;
export const TYPE_MESSAGE_RECALL = E.MESSAGE_RECALL;
export const TYPE_MESSAGE_PIN = E.MESSAGE_PIN;
export const TYPE_MESSAGE_UNPIN = E.MESSAGE_UNPIN;
export const TYPE_MESSAGE_READ = E.MESSAGE_READ;
export const TYPE_SESSION_CREATED = E.SESSION_CREATED;
export const TYPE_SESSION_DISSOLVED = E.SESSION_DISSOLVED;
export const TYPE_SESSION_MEMBER_JOINED = E.SESSION_MEMBER_JOINED;
export const TYPE_SESSION_MEMBER_LEFT = E.SESSION_MEMBER_LEFT;
export const TYPE_SESSION_INFO_UPDATED = E.SESSION_INFO_UPDATED;
export const TYPE_DEVICE_ONLINE = E.DEVICE_ONLINE;
export const TYPE_DEVICE_OFFLINE = E.DEVICE_OFFLINE;
export const TYPE_DEVICE_KICKED = E.DEVICE_KICKED;
export const TYPE_AGENT_DISPATCH = E.AGENT_DISPATCH;
export const TYPE_AGENT_STREAM = E.AGENT_STREAM;
export const TYPE_AGENT_DONE = E.AGENT_DONE;
export const TYPE_AGENT_FAILED = E.AGENT_FAILED;
export const TYPE_AGENT_CANCEL = E.AGENT_CANCEL;
export const TYPE_NOTIFICATION_NEW = E.NOTIFICATION_NEW;
export const TYPE_FRIEND_REQUEST = E.FRIEND_REQUEST;
export const TYPE_FRIEND_ACCEPTED = E.FRIEND_ACCEPTED;

/** All server-to-client event frame types (including auth responses). */
export const SERVER_EVENT_TYPES = new Set([
  TYPE_AUTH_OK,
  TYPE_AUTH_FAIL,
  TYPE_MESSAGE_NEW,
  TYPE_MESSAGE_RECALL,
  TYPE_MESSAGE_PIN,
  TYPE_MESSAGE_UNPIN,
  TYPE_MESSAGE_READ,
  TYPE_SESSION_CREATED,
  TYPE_SESSION_DISSOLVED,
  TYPE_SESSION_MEMBER_JOINED,
  TYPE_SESSION_MEMBER_LEFT,
  TYPE_SESSION_INFO_UPDATED,
  TYPE_DEVICE_ONLINE,
  TYPE_DEVICE_OFFLINE,
  TYPE_DEVICE_KICKED,
  TYPE_AGENT_DISPATCH,
  TYPE_AGENT_STREAM,
  TYPE_AGENT_DONE,
  TYPE_AGENT_FAILED,
  TYPE_AGENT_CANCEL,
  TYPE_NOTIFICATION_NEW,
  TYPE_FRIEND_REQUEST,
  TYPE_FRIEND_ACCEPTED,
]);

// ── Wire types ───────────────────────────────────

export interface HubFrame<T = unknown> {
  type: string;
  seq_id?: number;
  payload?: T;
}

export interface AuthPayload {
  access_token: string;
}

export interface AuthFailPayload {
  reason: string;
}

export interface HubMessage {
  id: string;
  session_id: string;
  seq_id: number;
  sender_type: string;
  sender_id: string;
  content_type: string;
  content: string;
  reply_to_message_id?: string;
  recalled: boolean;
  created_at: string;
}

export interface HubSessionUpdate {
  session_id: string;
  name?: string;
  avatar_url?: string;
  announcement?: string;
}

export interface HubSessionMember {
  session_id: string;
  user_id: string;
  role: string;
}

export interface HubDevicePresence {
  user_id: string;
  device_type: string;
  device_id: string;
}

export interface HubAgentTask {
  task_id: string;
  session_id: string;
  agent_instance_id: string;
  status: string;
  content?: string;
  error?: string;
}

export interface HubNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  created_at: string;
}

export interface HubFriendEvent {
  user_id: string;
  username: string;
  nickname: string;
  avatar_url?: string;
}

export interface HubReadReceipt {
  session_id: string;
  user_id: string;
  last_read_seq: number;
}
