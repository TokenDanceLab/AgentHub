// Hub WebSocket event type constants.
// 1:1 mirror of the constants in hub-server/internal/ws/frame.go — every key
// here MUST have a matching Type* constant there (and vice versa). Do not add
// client-only event names: types without a server producer are dead protocol
// surface (#1362 removed sync.request/sync.events, run.agent.plan_*,
// agent.regenerate and message.edited for exactly that reason).
// Every Hub WS frame is JSON: { type, payload, seq_id? }.

export const HUB_EVENTS = {
  // ── Client→server frame types ─────────────────
  TYPING: 'typing',

  // ── Auth responses ────────────────────────────
  AUTH_OK: 'auth.ok',

  // ── Message events ────────────────────────────
  MESSAGE_NEW: 'message.new',
  MESSAGE_RECALL: 'message.recall',
  MESSAGE_PIN: 'message.pin',
  MESSAGE_UNPIN: 'message.unpin',
  MESSAGE_REACTION_ADDED: 'message.reaction_added',
  MESSAGE_REACTION_REMOVED: 'message.reaction_removed',
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
  AGENT_CONTROL: 'agent.control',

  // ── Team run events ───────────────────────────
  TEAM_RUN_STARTED: 'team.run.started',
  TEAM_EVENT: 'team.event',
  TEAM_ASSIGNMENT_DONE: 'team.assignment.done',
  TEAM_ASSIGNMENT_FAILED: 'team.assignment.failed',

  // ── Notification & social ─────────────────────
  NOTIFICATION_NEW: 'notification.new',
  FRIEND_REQUEST: 'friend.request',
  FRIEND_ACCEPTED: 'friend.accepted',
} as const;

export type HubEventType = (typeof HUB_EVENTS)[keyof typeof HUB_EVENTS];
