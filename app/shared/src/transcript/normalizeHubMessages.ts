import type { TranscriptAuthor, TranscriptBlock } from './types';

export interface HubMessageTranscriptInput {
  id?: string;
  message_id?: string;
  client_msg_id?: string;
  session_id?: string;
  seq_id?: number;
  sender_type?: string;
  sender_id?: string;
  content_type?: string;
  content?: unknown;
  recalled?: boolean;
  created_at?: string;
  sender?: {
    username?: string;
    nickname?: string;
  };
}

export function normalizeHubMessagesToTranscript(
  messages: HubMessageTranscriptInput[] | undefined,
): TranscriptBlock[] {
  if (!messages?.length) return [];

  return messages
    .map((message, index) => ({ block: normalizeHubMessage(message), index, timestamp: timestampMs(message) }))
    .filter((entry): entry is { block: TranscriptBlock; index: number; timestamp: number } => Boolean(entry.block))
    .sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      const seq = (messageSeq(a.block.id) ?? 0) - (messageSeq(b.block.id) ?? 0);
      if (seq !== 0) return seq;
      return a.index - b.index;
    })
    .map((entry) => entry.block);
}

function normalizeHubMessage(message: HubMessageTranscriptInput): TranscriptBlock | null {
  const id = message.client_msg_id ?? message.id ?? message.message_id ?? fallbackMessageId(message);
  if (!id) return null;

  const text = message.recalled ? '消息已撤回' : renderHubContent(message.content);
  if (!text.trim()) return null;

  return {
    id: `hub-message-${id}`,
    author: normalizeAuthor(message),
    ...(message.created_at ? { createdAt: message.created_at } : {}),
    kind: 'text',
    text,
  };
}

function normalizeAuthor(message: HubMessageTranscriptInput): TranscriptAuthor {
  const senderType = message.sender_type?.trim().toLowerCase();
  if (senderType === 'agent' || senderType === 'assistant') {
    return {
      id: message.sender_id ?? 'hub-agent',
      name: message.sender?.nickname ?? message.sender?.username ?? 'Hub Agent',
      role: 'agent',
    };
  }
  if (senderType === 'system') {
    return { id: message.sender_id ?? 'hub-system', name: 'AgentHub', role: 'system' };
  }
  return {
    id: message.sender_id ?? 'hub-user',
    name: message.sender?.nickname ?? message.sender?.username ?? '用户',
    role: 'human',
  };
}

function renderHubContent(content: unknown): string {
  if (typeof content === 'string') {
    const parsed = parseJsonRecord(content);
    if (typeof parsed?.text === 'string') return parsed.text;
    if (typeof parsed?.content === 'string') return parsed.content;
    return content;
  }
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const record = content as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (typeof record.content === 'string') return record.content;
  }
  return content == null ? '' : JSON.stringify(content);
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function timestampMs(message: HubMessageTranscriptInput): number {
  const parsed = Date.parse(message.created_at ?? '');
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function fallbackMessageId(message: HubMessageTranscriptInput): string | undefined {
  if (!message.session_id || message.seq_id == null) return undefined;
  return `${message.session_id}-${message.seq_id}`;
}

function messageSeq(blockId: string): number | undefined {
  const match = blockId.match(/-(\d+)$/);
  return match ? Number(match[1]) : undefined;
}
