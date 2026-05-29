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

export interface ThreadRunLike {
  id?: string;
  runId?: string;
  status?: string;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt?: string;
}

export interface RunReplayFallbackContext {
  runId: string;
  status: string;
  statusLabel: string;
  item: ThreadItemLike;
  run: ThreadRunLike;
}

export interface RunReplayFallbackOptions {
  agentName?: string;
  statusLabel?: (status: string) => string;
  content?: (context: RunReplayFallbackContext) => string;
}

export interface DisplayedRunLike {
  runId: string;
  status: string;
  outputText?: string;
}

const OPTIMISTIC_DEDUPE_WINDOW_MS = 2 * 60 * 1000;

export function buildChatMessagesFromThreadItems(items: ThreadItemLike[] | undefined): ChatMessage[] {
  if (!items?.length) return [];

  return sortMessagesByTimestampStable(items
    .map(projectThreadItemToChatMessage)
    .filter((msg): msg is ChatMessage => Boolean(msg)));
}

export function buildRunReplayFallbackMessages(
  items: ThreadItemLike[] | undefined,
  runs: ThreadRunLike[] | undefined,
  options: RunReplayFallbackOptions = {},
): ChatMessage[] {
  if (!items?.length || !runs?.length) return [];

  const agentMessageRunIds = new Set(
    items
      .filter((item) => {
        const content = item.content?.trim();
        if (!content || !item.runId) return false;
        const role = normalizeRole(item.role);
        return role === 'agent' && isMessageItemType(item.type?.trim() ?? 'message');
      })
      .map((item) => item.runId as string),
  );
  const runItems = new Map<string, ThreadItemLike>();
  for (const item of items) {
    if (item.type?.trim() !== 'run' || !item.runId || runItems.has(item.runId)) continue;
    runItems.set(item.runId, item);
  }

  const runsById = new Map<string, ThreadRunLike>();
  for (const run of runs) {
    const runId = run.runId ?? run.id;
    if (runId) runsById.set(runId, run);
  }

  const messages: ChatMessage[] = [];
  for (const [runId, item] of runItems) {
    if (agentMessageRunIds.has(runId)) continue;
    const run = runsById.get(runId);
    if (!run) continue;
    const status = normalizeStatus(run.status ?? item.status);
    if (!status || !isTerminalRunStatus(status)) continue;

    const statusLabel = options.statusLabel?.(status) ?? status;
    const content = options.content?.({ runId, status, statusLabel, item, run })
      ?? `Run ${statusLabel}, but no replayable agent output was saved.`;
    if (!content.trim()) continue;

    messages.push({
      id: `run-replay-fallback-${runId}`,
      role: 'agent',
      timestamp: run.finishedAt ?? run.updatedAt ?? item.updatedAt ?? run.startedAt ?? item.createdAt ?? run.createdAt ?? new Date(0).toISOString(),
      parentId: runId,
      ...(options.agentName ? { agentName: options.agentName } : {}),
      blocks: [{ kind: 'text', content }],
    });
  }

  return sortMessagesByTimestampStable(messages);
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
  const output = run?.outputText?.trim();
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
  const content = item.content?.trim();
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

function normalizeStatus(status: string | undefined): string | null {
  const normalized = status?.trim().toLowerCase();
  return normalized || null;
}

function isTerminalRunStatus(status: string): boolean {
  return status === 'finished' || status === 'failed' || status === 'cancelled' || status === 'completed';
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
