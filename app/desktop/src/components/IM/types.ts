// IM (Instant Messaging) shared types for Hub WS message integration.
// Extended with Trump's IM enhancements (PR #220): recall, read receipts, friend/notification types.
// Extended with rich message rendering: optional blocks for Tool/Diff/Thinking/Approval (Sprint #2).

import type { MessageBlock } from '@shared/types/chat';

export type AuthorityType = 'hub' | 'edge' | 'hybrid';

export interface IMMessageMention {
  agentId: string;
  agentName: string;
}

export type IMSendState = 'pending' | 'failed';

export interface IMMessage {
  id: string;
  sessionId: string;
  clientMsgId?: string;
  senderId: string;
  senderName: string;
  senderType: 'user' | 'agent';
  authority: AuthorityType;
  content: string;
  /** Optional structured blocks for rich rendering (Sprint #2).
   *  When present, v4 transcript renderers can consume blocks instead of parsing content. */
  blocks?: MessageBlock[];
  timestamp: string;
  replyToId?: string;
  recalled?: boolean;
  read?: boolean;
  readBy?: string | string[];
  readAt?: string;
  readSeq?: number;
  actionError?: string;
  /** Agents @mentioned in this message (from structured content envelope). */
  mentions?: IMMessageMention[];
  /** Optimistic send state: 'pending' while awaiting server, 'failed' on error. Undefined once confirmed. */
  sendState?: IMSendState;
  /** Error message when sendState is 'failed'. */
  sendError?: string;
}

export interface IMMessageWithHubState extends IMMessage {
  hubSent?: boolean;
  hubError?: string;
}

/** Richer payload built by IMMessageInput internally. Backward-compatible with onSend(content, mentions). */
export interface ComposerPayload {
  content: string;
  mentions?: IMMessageMention[];
}

export interface IMContact {
  id: string;
  name: string;
  type: 'user' | 'agent' | 'group';
  authority?: AuthorityType;
  online: boolean;
  avatar?: string;
  lastSeen?: string;
  dissolved?: boolean;
  statusHint?: string;
  statusHintParams?: Record<string, string | number>;
  unreadCount?: number;
}
