// Hub WebSocket event type constants.
// 1:1 mirror of the constants in hub-server/internal/ws/frame.go — every key
// here MUST have a matching Type* constant there (and vice versa). Do not add
// client-only event names: types without a server producer are dead protocol
// surface (#1362 / #1422 removed sync.request/sync.events, run.agent.plan_*,
// agent.regenerate, message.edited, agent.timeout wire, auth/auth.fail).
/**
 * Every Hub WS frame is JSON: `{ type, payload, seq_id? }`.
 *
 * ⚠️ **`seq_id` 字段契约警戒（#2101 G5；对照表见 api/events.md「seq 字段对照表」）**：
 * - `seq_id` 是 **Hub Frame 的 per-connection 投递序号**，由
 *   `hub-server/internal/ws/fanout.go:91` 在 `Manager.PushToConn` 内 stamp，定义于
 *   `hub-server/internal/ws/frame.go:7-14`。**重连时从 1 重新计数**。
 * - 合法用途仅限同连接内丢帧检测；**禁止**当作跨连接幂等键、持久 cursor、业务去重键，
 *   **禁止**写入客户端→服务端请求帧。
 * - 这 **不是** Edge EventEnvelope 的 `seq`（per-bus 持久单调序号，跨连接稳定，用作
 *   replay cursor；定义于 `edge-server/internal/events/types.go:28-38`）。把两者混用
 *   会导致静默丢事件或重复 apply。
 *
 * 业务重复投递语义（UPSERT by id / idempotent on apply / watermark / ephemeral）以
 * api/events.md 为准——任何 WS 增量回放实现前必须先核对该契约。
 */

export const HUB_EVENTS = {
  // ── Client→server frame types ─────────────────
  // ephemeral fanout; no durable idempotency key
  TYPING: 'typing',

  // ── Auth responses ────────────────────────────
  // idempotent handshake ack per connection
  AUTH_OK: 'auth.ok',

  // ── Message events ────────────────────────────
  // UPSERT / idempotent by message id; MESSAGE_READ is last_read_seq watermark
  MESSAGE_NEW: 'message.new',
  MESSAGE_RECALL: 'message.recall',
  MESSAGE_PIN: 'message.pin',
  MESSAGE_UNPIN: 'message.unpin',
  MESSAGE_REACTION_ADDED: 'message.reaction_added',
  MESSAGE_REACTION_REMOVED: 'message.reaction_removed',
  MESSAGE_READ: 'message.read',

  // ── Session events ────────────────────────────
  // UPSERT / terminal by session_id (+ member_id)
  SESSION_CREATED: 'session.created',
  SESSION_DISSOLVED: 'session.dissolved',
  SESSION_MEMBER_JOINED: 'session.member_joined',
  SESSION_MEMBER_LEFT: 'session.member_left',
  SESSION_INFO_UPDATED: 'session.info_updated',

  // ── Device events ─────────────────────────────
  // presence UPSERT by user_id; kicked terminal per conn
  DEVICE_ONLINE: 'device.online',
  DEVICE_OFFLINE: 'device.offline',
  DEVICE_KICKED: 'device.kicked',

  // ── Agent events ──────────────────────────────
  // UPSERT / terminal by task_id; STREAM also watermarks event_seq
  AGENT_DISPATCH: 'agent.dispatch',
  AGENT_STREAM: 'agent.stream',
  AGENT_DONE: 'agent.done',
  AGENT_FAILED: 'agent.failed',
  AGENT_CANCEL: 'agent.cancel',
  AGENT_CONTROL: 'agent.control',

  // ── Team run events ───────────────────────────
  // UPSERT / terminal by run_id or assignment id (see api/events.md)
  TEAM_RUN_STARTED: 'team.run.started',
  TEAM_EVENT: 'team.event',
  TEAM_ASSIGNMENT_DONE: 'team.assignment.done',
  TEAM_ASSIGNMENT_FAILED: 'team.assignment.failed',

  // ── Team subagent live-stream (#1478 Phase A) ──
  // UPSERT by (agent_task_id, event_seq) + event_seq watermark; aggregates
  // per-task run.agent.* flow into the team-run view. Phase A ships only the
  // single-event stream frame; activity/batch/subscribe arrive later — do NOT
  // add them until they have a wire producer (#1362/#1422 dead-surface ban).
  TEAM_SUBAGENT_STREAM: 'team.subagent.stream',

  // ── Notification & social ─────────────────────
  // UPSERT by notification / request / user id
  NOTIFICATION_NEW: 'notification.new',
  FRIEND_REQUEST: 'friend.request',
  FRIEND_ACCEPTED: 'friend.accepted',
} as const;

export type HubEventType = (typeof HUB_EVENTS)[keyof typeof HUB_EVENTS];
