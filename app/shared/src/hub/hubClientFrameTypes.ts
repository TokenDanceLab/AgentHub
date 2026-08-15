/**
 * Hub client WebSocket frame payload and typed frame DTOs.
 * Extracted from hubClient.ts (#788) — pure types only; re-exported by hubClient.
 * Keep public names stable for web/desktop imports via @shared/hub/hubClient.
 */

import { HUB_EVENTS, type HubEventType } from '../hubEvents';
import type {
  HubAgentTaskStatus,
  HubMessage,
  HubNotification,
  HubSession,
  HubTaskDoneRequest,
  HubTaskStreamRequest,
} from './hubClientDomainTypes';

export interface HubDevicePresencePayload {
  user_id: string;
}

export interface HubDeviceKickedPayload {
  device_id?: string;
  device_type?: string;
  session_id?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface HubAgentDispatchPayload {
  task_id: string;
  delivery_id?: string;
  agent_instance_id: string;
  agent_type: string;
  custom_agent_id?: string;
  target_id?: string;
  edge_device_id?: string;
  session_id: string;
  trigger_message_id: string;
  trigger_user_id: string;
  prompt: string;
  display_name: string;
  system_prompt?: string;
  model_params?: string;
  tool_whitelist?: string;
  team_id?: string;
  team_run_id?: string;
  team_member_id?: string;
  team_member_role?: string;
  messages?: unknown[];
  pinned_messages?: unknown[];
  structured_output_schema?: unknown;
}

export interface HubAgentStreamPayload extends HubTaskStreamRequest {
  task_id: string;
}

export interface HubAgentDonePayload extends HubTaskDoneRequest {
  task_id: string;
  status?: HubAgentTaskStatus;
}

export interface HubAgentFailedPayload {
  task_id: string;
  error?: string;
  error_message?: string;
  run_id?: string;
  edge_run_id?: string;
}

export interface HubAgentCancelPayload {
  task_id: string;
}

export interface HubFriendEventPayload {
  request_id?: string;
  user_id?: string;
  friend_id?: string;
  username?: string;
  nickname?: string;
  avatar_url?: string;
  message?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface HubFrame<TPayload = unknown, TType extends string = string> {
  type: TType;
  seq_id?: number;
  payload?: TPayload;
}

export type HubAuthOkFrame = HubFrame<unknown, typeof HUB_EVENTS.AUTH_OK>;
export type HubMessageNewFrame = HubFrame<
  HubMessage,
  typeof HUB_EVENTS.MESSAGE_NEW
>;
export type HubMessageRecallFrame = HubFrame<
  { message_id?: string; id?: string; session_id?: string },
  typeof HUB_EVENTS.MESSAGE_RECALL
>;
export type HubMessageReadFrame = HubFrame<
  { session_id: string; user_id: string; last_read_seq: number },
  typeof HUB_EVENTS.MESSAGE_READ
>;
export type HubSessionCreatedFrame = HubFrame<
  HubSession | { session_id: string },
  typeof HUB_EVENTS.SESSION_CREATED
>;
export type HubSessionInfoUpdatedFrame = HubFrame<
  Partial<HubSession> & { session_id: string },
  typeof HUB_EVENTS.SESSION_INFO_UPDATED
>;
export type HubSessionDissolvedFrame = HubFrame<
  { session_id: string },
  typeof HUB_EVENTS.SESSION_DISSOLVED
>;
export type HubAgentDispatchFrame = HubFrame<
  HubAgentDispatchPayload,
  typeof HUB_EVENTS.AGENT_DISPATCH
>;
export type HubAgentStreamFrame = HubFrame<
  HubAgentStreamPayload,
  typeof HUB_EVENTS.AGENT_STREAM
>;
export type HubAgentDoneFrame = HubFrame<
  HubAgentDonePayload,
  typeof HUB_EVENTS.AGENT_DONE
>;
export type HubAgentFailedFrame = HubFrame<
  HubAgentFailedPayload,
  typeof HUB_EVENTS.AGENT_FAILED
>;
export type HubAgentCancelFrame = HubFrame<
  HubAgentCancelPayload,
  typeof HUB_EVENTS.AGENT_CANCEL
>;
export type HubDeviceOnlineFrame = HubFrame<
  HubDevicePresencePayload,
  typeof HUB_EVENTS.DEVICE_ONLINE
>;
export type HubDeviceOfflineFrame = HubFrame<
  HubDevicePresencePayload,
  typeof HUB_EVENTS.DEVICE_OFFLINE
>;
export type HubDeviceKickedFrame = HubFrame<
  HubDeviceKickedPayload,
  typeof HUB_EVENTS.DEVICE_KICKED
>;
export type HubNotificationNewFrame = HubFrame<
  HubNotification,
  typeof HUB_EVENTS.NOTIFICATION_NEW
>;
export type HubFriendRequestFrame = HubFrame<
  HubFriendEventPayload,
  typeof HUB_EVENTS.FRIEND_REQUEST
>;
export type HubFriendAcceptedFrame = HubFrame<
  HubFriendEventPayload,
  typeof HUB_EVENTS.FRIEND_ACCEPTED
>;

// ── WS frame types matching hub-server/internal/ws/frame.go ──

export interface HubMessagePinPayload {
  session_id: string;
  message_id: string;
  pinned_by_user_id: string;
  pinned_at: string;
}

export type HubMessagePinFrame = HubFrame<
  HubMessagePinPayload,
  typeof HUB_EVENTS.MESSAGE_PIN
>;

export interface HubMessageUnpinPayload {
  session_id: string;
  message_id: string;
}

export type HubMessageUnpinFrame = HubFrame<
  HubMessageUnpinPayload,
  typeof HUB_EVENTS.MESSAGE_UNPIN
>;

export interface HubMessageReactionPayload {
  action: string;
  user_id: string;
  message_id: string;
  session_id: string;
  reaction: string;
  count: number;
}

export type HubMessageReactionAddedFrame = HubFrame<
  HubMessageReactionPayload,
  typeof HUB_EVENTS.MESSAGE_REACTION_ADDED
>;

export type HubMessageReactionRemovedFrame = HubFrame<
  HubMessageReactionPayload,
  typeof HUB_EVENTS.MESSAGE_REACTION_REMOVED
>;

export interface HubSessionMemberEventPayload {
  session_id: string;
  member_id: string;
  member_type?: string;
}

export type HubSessionMemberJoinedFrame = HubFrame<
  HubSessionMemberEventPayload,
  typeof HUB_EVENTS.SESSION_MEMBER_JOINED
>;

export type HubSessionMemberLeftFrame = HubFrame<
  HubSessionMemberEventPayload,
  typeof HUB_EVENTS.SESSION_MEMBER_LEFT
>;

export type HubKnownFrame =
  | HubAuthOkFrame
  | HubMessageNewFrame
  | HubMessageRecallFrame
  | HubMessagePinFrame
  | HubMessageUnpinFrame
  | HubMessageReadFrame
  | HubMessageReactionAddedFrame
  | HubMessageReactionRemovedFrame
  | HubSessionCreatedFrame
  | HubSessionInfoUpdatedFrame
  | HubSessionDissolvedFrame
  | HubSessionMemberJoinedFrame
  | HubSessionMemberLeftFrame
  | HubAgentDispatchFrame
  | HubAgentStreamFrame
  | HubAgentDoneFrame
  | HubAgentFailedFrame
  | HubAgentCancelFrame
  | HubDeviceOnlineFrame
  | HubDeviceOfflineFrame
  | HubDeviceKickedFrame
  | HubNotificationNewFrame
  | HubFriendRequestFrame
  | HubFriendAcceptedFrame
  | HubFrame<unknown, HubEventType>;
