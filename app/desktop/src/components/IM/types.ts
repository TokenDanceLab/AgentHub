// IM (Instant Messaging) shared types for Hub WS message integration.
// Extended with Trump's IM enhancements (PR #220): recall, read receipts, friend/notification types.

export type AuthorityType = 'hub' | 'edge' | 'hybrid';

export interface IMMessageMention {
  agentId: string;
  agentName: string;
}

export interface IMMessage {
  id: string;
  sessionId: string;
  clientMsgId?: string;
  senderId: string;
  senderName: string;
  senderType: 'user' | 'agent';
  authority: AuthorityType;
  content: string;
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
}

export interface IMMessageWithHubState extends IMMessage {
  hubSent?: boolean;
  hubError?: string;
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
