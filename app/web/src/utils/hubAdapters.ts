import type { Session } from '@/api/hubClient';
import type { ChatMessage, MessageBlock } from '@/components/ChatView.types';
import type { ThreadInfo } from '@shared/types';

export interface HubMessageLike {
  id?: string;
  message_id?: string;
  client_msg_id?: string;
  sessionId?: string;
  session_id?: string;
  seq_id?: number;
  sender_id?: string;
  sender_type?: string;
  content_type?: string;
  content: unknown;
  reply_to_message_id?: string;
  recalled?: boolean;
  created_at?: string;
  sender?: { username?: string; nickname?: string };
}

export interface HubThreadInfo extends ThreadInfo {
  sessionType: string;
}

export function newClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16),
  );
}

export function renderHubContent(content: unknown): string {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        if (typeof parsed.text === 'string') return parsed.text;
        if (typeof parsed.content === 'string') return parsed.content;
      } catch {
        /* Plain text that happens to start with a brace. */
      }
    }
    return content;
  }
  if (content && typeof content === 'object') {
    const record = content as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (typeof record.content === 'string') return record.content;
  }
  return content == null ? '' : JSON.stringify(content);
}

export function hubMessageToChatMessage(msg: HubMessageLike): ChatMessage {
  const sessionId = msg.session_id ?? msg.sessionId ?? '';
  const messageId =
    msg.client_msg_id ??
    msg.id ??
    msg.message_id ??
    `${sessionId}-${msg.seq_id ?? Date.now()}`;
  const senderType = msg.sender_type === 'agent' ? 'agent' : 'user';
  const content = msg.recalled ? '[Message recalled]' : renderHubContent(msg.content);
  const block: MessageBlock = msg.content_type === 'code'
    ? { kind: 'code', content }
    : { kind: 'text', content };

  return {
    id: messageId,
    role: senderType,
    timestamp: msg.created_at ?? new Date().toISOString(),
    agentName:
      senderType === 'agent'
        ? msg.sender?.nickname ?? msg.sender?.username ?? 'Hub Agent'
        : undefined,
    blocks: [block],
  };
}

export function mergeChatMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const msg of current) byId.set(msg.id, msg);
  for (const msg of incoming) byId.set(msg.id, msg);
  return [...byId.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function sessionToThreadInfo(session: Session): HubThreadInfo {
  const fallback = session.type === 'private' ? 'Private session' : 'Group session';
  const updatedAt = session.updated_at ?? session.created_at ?? new Date().toISOString();
  const sessionId = session.id ?? session.session_id ?? '';
  return {
    threadId: sessionId,
    projectId: 'hub',
    title: session.name || fallback,
    status: session.type,
    sessionType: session.type,
    createdAt: session.created_at ?? updatedAt,
    updatedAt,
  };
}
