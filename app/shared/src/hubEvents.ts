// Hub WebSocket event type constants.
// Mirrors the event types defined in hub-server/internal/ws/frame.go.
// Every Hub WS frame is JSON: { type, payload, seq_id? }.

export const HUB_EVENTS = {
  // ── Auth frame types ──────────────────────────
  AUTH: 'auth',
  AUTH_OK: 'auth.ok',
  AUTH_FAIL: 'auth.fail',

  // ── Message events ────────────────────────────
  MESSAGE_NEW: 'message.new',
  MESSAGE_RECALL: 'message.recall',
  MESSAGE_PIN: 'message.pin',
  MESSAGE_UNPIN: 'message.unpin',
  MESSAGE_READ: 'message.read',

  // ── Session events ────────────────────────────
  SESSION_CREATED: 'session.created',
  SESSION_DISSOLVED: 'session.dissolved',
  SESSION_MEMBER_JOINED: 'session.member_joined',
  SESSION_MEMBER_LEFT: 'session.member_left',
  SESSION_INFO_UPDATED: 'session.info_updated',

  // ── Device events ─────────────────────────────
  DEVICE_ONLINE: 'device.online',
  DEVICE_OFFLINE: 'device.offline',
  DEVICE_KICKED: 'device.kicked',

  // ── Agent events ──────────────────────────────
  AGENT_DISPATCH: 'agent.dispatch',
  AGENT_STREAM: 'agent.stream',
  AGENT_DONE: 'agent.done',
  AGENT_FAILED: 'agent.failed',
  AGENT_CANCEL: 'agent.cancel',

  // ── Notification & social ─────────────────────
  NOTIFICATION_NEW: 'notification.new',
  FRIEND_REQUEST: 'friend.request',
  FRIEND_ACCEPTED: 'friend.accepted',
} as const;

export type HubEventType = (typeof HUB_EVENTS)[keyof typeof HUB_EVENTS];
