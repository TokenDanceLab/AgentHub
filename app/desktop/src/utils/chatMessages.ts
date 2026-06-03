import type { ChatMessage, MessageRole } from '@/components/ChatView.types';

export interface ThreadItemLike {
  id?: string;
  itemId?: string;
  threadId?: string;
  type?: string;
  role?: string;
  status?: string;
  content?: string;
  runId?: string;
  timestamp?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DisplayedRunLike {
  runId: string;
  status: string;
  outputText?: string;
}

const OPTIMISTIC_DEDUPE_WINDOW_MS = 2 * 60 * 1000;
const INTERNAL_RUNNER_OUTPUT_PATTERNS = [
  /(?:^|\s+)Initializing mock runner\.\.\.(?=\s+|$)/gi,
  /(?:^|\s+)Executing mock task step \d+\/\d+\.\.\.(?=\s+|$)/gi,
  /(?:^|\s+)Warning:\s*mock task is running in simulation mode(?=\s+|$)/gi,
  /(?:^|\s+)Warning:\s*no stdin data received.*?proceeding without it\.?(?=\s+|$)/gi,
];

export function buildChatMessagesFromThreadItems(items: ThreadItemLike[] | undefined): ChatMessage[] {
  if (!items?.length) return [];

  return sortMessagesByTimestampStable(items
    .map(projectThreadItemToChatMessage)
    .filter((msg): msg is ChatMessage => Boolean(msg)));
}

export function filterOptimisticMessagesForThread(
  messages: ChatMessage[],
  activeThreadId: string | null | undefined,
): ChatMessage[] {
  if (!activeThreadId) return messages.filter((message) => !message.threadId);
  return messages.filter((message) => message.threadId === activeThreadId);
}

export function mergeChatMessages({
  persisted = [],
  optimistic = [],
  live = [],
}: {
  persisted?: ChatMessage[];
  optimistic?: ChatMessage[];
  live?: ChatMessage[];
}): ChatMessage[] {
  const liveAgentRunIds = new Set(
    live
      .filter((msg) => msg.role === 'agent' && msg.parentId)
      .map((msg) => msg.parentId as string),
  );
  const persistedWithoutLiveDuplicates = persisted.filter(
    (msg) => !(msg.role === 'agent' && msg.parentId && liveAgentRunIds.has(msg.parentId)),
  );
  const merged: ChatMessage[] = [...persistedWithoutLiveDuplicates];

  for (const msg of optimistic) {
    if (!hasEquivalentPersistedMessage(msg, persistedWithoutLiveDuplicates)) {
      merged.push(msg);
    }
  }

  merged.push(...live);
  return sortMessagesByTimestampStable(dedupeById(merged));
}

export function buildDisplayedRunOutputMessage(
  run: DisplayedRunLike | undefined,
  agentName?: string,
): ChatMessage | null {
  const output = sanitizeAgentOutputText(run?.outputText ?? '').trim();
  if (!run || !output) return null;

  return {
    id: `run-output-${run.runId}-${run.status}`,
    role: 'agent',
    timestamp: new Date().toISOString(),
    parentId: run.runId,
    ...(agentName ? { agentName } : {}),
    blocks: [{ kind: 'text', content: output }],
  };
}

export function sanitizeAgentOutputText(content: string): string {
  let sanitized = content;
  for (const pattern of INTERNAL_RUNNER_OUTPUT_PATTERNS) {
    sanitized = sanitized.replace(pattern, ' ');
  }
  if (!sanitized.trim()) return '';
  return sanitized.replace(/[ \t]{2,}/g, ' ');
}

export function applyRuntimeAgentLabel(messages: ChatMessage[], runtimeName?: string): ChatMessage[] {
  const fallback = runtimeName?.trim();
  if (!fallback) return messages;

  return messages.map((message) => {
    if (message.role !== 'agent') return message;
    if (!shouldUseRuntimeAgentLabel(message.agentName)) return message;
    return { ...message, agentName: fallback };
  });
}

function projectThreadItemToChatMessage(item: ThreadItemLike): ChatMessage | null {
  const content = sanitizeAgentOutputText(item.content ?? '').trim();
  if (!content) return null;

  const role = normalizeRole(item.role);
  if (!role) return null;

  const type = item.type?.trim();
  if (type && !isMessageItemType(type)) return null;

  const id = item.itemId ?? item.id;
  if (!id) return null;

  return {
    id: `thread-item-${id}`,
    role,
    timestamp: item.createdAt ?? item.timestamp ?? new Date(0).toISOString(),
    ...(item.threadId ? { threadId: item.threadId } : {}),
    ...(item.runId ? { parentId: item.runId } : {}),
    blocks: [{ kind: 'text', content }],
  };
}

function normalizeRole(role: string | undefined): MessageRole | null {
  switch (role?.trim()) {
    case 'user':
      return 'user';
    case 'agent':
    case 'assistant':
      return 'agent';
    case 'system':
      return 'system';
    default:
      return null;
  }
}

function isMessageItemType(type: string): boolean {
  return type === 'message' || type === 'user_message' || type === 'agent_message' || type === 'assistant_message';
}

function shouldUseRuntimeAgentLabel(agentName: string | undefined): boolean {
  const normalized = agentName?.trim().toLowerCase();
  if (!normalized) return true;

  return (
    normalized === 'claude' ||
    normalized.includes('claude-opus') ||
    normalized.includes('claude-sonnet') ||
    normalized.includes('claude-haiku') ||
    normalized.includes('gpt') ||
    normalized.includes('glm') ||
    normalized.includes('qwen') ||
    normalized.includes('deepseek') ||
    normalized.includes('kimi') ||
    normalized.includes('tokendance')
  );
}

function hasEquivalentPersistedMessage(message: ChatMessage, persisted: ChatMessage[]): boolean {
  const messageText = textSignature(message);
  if (!messageText) return false;

  const messageTime = Date.parse(message.timestamp);
  return persisted.some((candidate) => {
    if (candidate.role !== message.role) return false;
    if (textSignature(candidate) !== messageText) return false;
    const candidateTime = Date.parse(candidate.timestamp);
    if (!Number.isFinite(messageTime) || !Number.isFinite(candidateTime)) return true;
    return Math.abs(candidateTime - messageTime) <= OPTIMISTIC_DEDUPE_WINDOW_MS;
  });
}

function textSignature(message: ChatMessage): string | null {
  const parts = message.blocks
    .filter((block): block is { kind: 'text'; content: string } => block.kind === 'text')
    .map((block) => block.content.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join('\n') : null;
}

function dedupeById(messages: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  const deduped: ChatMessage[] = [];
  for (const message of messages) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    deduped.push(message);
  }
  return deduped;
}

function sortMessagesByTimestampStable(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const aTime = timestampMs(a.message.timestamp);
      const bTime = timestampMs(b.message.timestamp);
      if (aTime !== bTime) return aTime - bTime;
      return a.index - b.index;
    })
    .map(({ message }) => message);
}

function timestampMs(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}
