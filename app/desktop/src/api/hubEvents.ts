// Hub WebSocket protocol constants and payload types.
// Canonical event type constants are in @shared/hubEvents (which mirrors
// hub-server/internal/ws/frame.go 1:1 — the SSOT).
// This module adds desktop-specific payload interfaces and the legacy
// per-constant re-exports for backward compatibility.

import { HUB_EVENTS as E } from '@shared/hubEvents';

// ── Re-export canonical constants ────────────────
export { HUB_EVENTS } from '@shared/hubEvents';
export type { HubEventType } from '@shared/hubEvents';

// ── Legacy per-constant exports (backward compat) ─
export {
  HUB_EVENTS as default,
} from '@shared/hubEvents';

export const TYPE_AUTH_OK = E.AUTH_OK;
export const TYPE_TYPING = E.TYPING;
export const TYPE_MESSAGE_NEW = E.MESSAGE_NEW;
export const TYPE_MESSAGE_RECALL = E.MESSAGE_RECALL;
export const TYPE_MESSAGE_PIN = E.MESSAGE_PIN;
export const TYPE_MESSAGE_UNPIN = E.MESSAGE_UNPIN;
export const TYPE_MESSAGE_REACTION_ADDED = E.MESSAGE_REACTION_ADDED;
export const TYPE_MESSAGE_REACTION_REMOVED = E.MESSAGE_REACTION_REMOVED;
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
export const TYPE_AGENT_CONTROL = E.AGENT_CONTROL;
export const TYPE_NOTIFICATION_NEW = E.NOTIFICATION_NEW;
export const TYPE_FRIEND_REQUEST = E.FRIEND_REQUEST;
export const TYPE_FRIEND_ACCEPTED = E.FRIEND_ACCEPTED;
export const TYPE_TEAM_RUN_STARTED = E.TEAM_RUN_STARTED;
export const TYPE_TEAM_EVENT = E.TEAM_EVENT;
export const TYPE_TEAM_ASSIGNMENT_DONE = E.TEAM_ASSIGNMENT_DONE;
export const TYPE_TEAM_ASSIGNMENT_FAILED = E.TEAM_ASSIGNMENT_FAILED;

// ── Wire types ───────────────────────────────────

export interface HubFrame<T = unknown> {
  type: string;
  seq_id?: number;
  payload?: T;
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

export interface HubDevicePresence {
  user_id: string;
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
