// IM (Instant Messaging) shared types for Hub WS message integration.

export type AuthorityType = 'hub' | 'edge' | 'hybrid';

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
  readBy?: string;
  readAt?: string;
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
}
