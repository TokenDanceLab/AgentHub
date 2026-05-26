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

export interface RunDetailToolCall {
  callId: string;
  toolName: string;
  status: string;
  timestamp: string;
  output?: string;
}

export interface RunDetailProjection {
  outputText: string;
  toolCalls: RunDetailToolCall[];
  changedFiles: Array<{ path: string; action: string; timestamp: string }>;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function normalizeFileAction(value: unknown): 'created' | 'modified' | 'deleted' {
  if (value === 'created' || value === 'added' || value === 'add') return 'created';
  if (value === 'deleted' || value === 'removed' || value === 'delete') return 'deleted';
  return 'modified';
}

function normalizeToolStatus(value: unknown): 'pending' | 'running' | 'completed' | 'failed' {
  if (value === 'pending') return 'pending';
  if (value === 'completed' || value === 'succeeded' || value === 'success') return 'completed';
  if (value === 'failed' || value === 'error') return 'failed';
  return 'running';
}

function stringifyRuntimeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function mapTokenUsage(value: unknown): { input: number; output: number } | undefined {
  if (!isRecord(value)) return undefined;
  const input = value.input ?? value.inputTokens ?? value.prompt_tokens;
  const output = value.output ?? value.outputTokens ?? value.completion_tokens;
  return typeof input === 'number' && typeof output === 'number' ? { input, output } : undefined;
}

function runtimePayloadToBlocks(content: unknown): MessageBlock[] | null {
  const record = parseJsonRecord(content);
  if (!record) return null;

  const path = readString(record, 'path') ?? readString(record, 'filePath');
  if (path && (record.action !== undefined || record.diff !== undefined)) {
    const block: Extract<MessageBlock, { kind: 'file_change' }> = {
      kind: 'file_change',
      path,
      action: normalizeFileAction(record.action),
    };
    const diff = readString(record, 'diff');
    if (diff) block.diff = diff;
    return [block];
  }

  const callId = readString(record, 'callId') ?? readString(record, 'toolUseId');
  const toolName = readString(record, 'toolName') ?? readString(record, 'tool') ?? readString(record, 'name');
  const rawInput = record.input ?? record.arguments ?? record.args;
  if (callId && toolName && rawInput !== undefined) {
    const block: Extract<MessageBlock, { kind: 'tool_use' }> = {
      kind: 'tool_use',
      callId,
      toolName,
      input: isRecord(rawInput) ? rawInput : { value: rawInput },
      status: normalizeToolStatus(record.status),
      children: [],
    };
    return [block];
  }

  const rawOutput = record.output ?? record.content ?? record.result;
  if (callId && rawOutput !== undefined) {
    const output = stringifyRuntimeValue(rawOutput);
    const failed = record.isError === true || record.error !== undefined || record.status === 'failed';
    return [
      {
        kind: 'tool_use',
        callId,
        toolName: toolName ?? 'Tool result',
        input: {},
        status: failed ? 'failed' : 'completed',
        children: [{ kind: 'generic_result', output }],
      },
    ];
  }

  if (typeof record.success === 'boolean') {
    const block: Extract<MessageBlock, { kind: 'result' }> = {
      kind: 'result',
      success: record.success,
    };
    const error = readString(record, 'error');
    if (error) block.error = error;
    const tokenUsage = mapTokenUsage(record.tokenUsage ?? record.usage);
    if (tokenUsage) block.tokenUsage = tokenUsage;
    return [block];
  }

  return null;
}

function toolResultOutput(children: Extract<MessageBlock, { kind: 'tool_use' }>['children']): string | undefined {
  if (!children || children.length === 0) return undefined;
  const output = children
    .map((child) => {
      switch (child.kind) {
        case 'read_result':
          return child.content ?? `${child.filePath} (${child.lineCount} lines)`;
        case 'write_result':
        case 'edit_result':
          return child.diff ? JSON.stringify(child.diff) : child.filePath;
        case 'bash_result':
          return [child.stdout, child.stderr].filter(Boolean).join('\n');
        case 'generic_result':
          return child.output;
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n');
  return output || undefined;
}

export function projectRunDetail(messages: ChatMessage[]): RunDetailProjection {
  const outputParts: string[] = [];
  const toolCallsById = new Map<string, RunDetailToolCall>();
  const changedFiles: RunDetailProjection['changedFiles'] = [];

  for (const message of messages) {
    if (message.role !== 'agent') continue;

    for (const block of message.blocks) {
      switch (block.kind) {
        case 'text':
        case 'code':
          if (block.content.trim()) outputParts.push(block.content);
          break;

        case 'tool_use': {
          const existing = toolCallsById.get(block.callId);
          const output = toolResultOutput(block.children);
          const mergedOutput = output ?? existing?.output;
          const projected: RunDetailToolCall = {
            callId: block.callId,
            toolName: existing?.toolName && existing.toolName !== 'Tool result'
              ? existing.toolName
              : block.toolName,
            status: block.status,
            timestamp: existing?.timestamp ?? message.timestamp,
          };
          if (mergedOutput) projected.output = mergedOutput;
          toolCallsById.set(block.callId, projected);
          break;
        }

        case 'file_change':
          changedFiles.push({
            path: block.path,
            action: block.action,
            timestamp: message.timestamp,
          });
          break;

        default:
          break;
      }
    }
  }

  return {
    outputText: outputParts.join('\n\n'),
    toolCalls: [...toolCallsById.values()],
    changedFiles,
  };
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
  const runtimeBlocks = msg.recalled ? null : runtimePayloadToBlocks(msg.content);
  const blocks: MessageBlock[] = runtimeBlocks ?? [
    msg.content_type === 'code'
      ? { kind: 'code', content }
      : { kind: 'text', content },
  ];

  return {
    id: messageId,
    role: senderType,
    timestamp: msg.created_at ?? new Date().toISOString(),
    agentName:
      senderType === 'agent'
        ? msg.sender?.nickname ?? msg.sender?.username ?? 'Hub Agent'
        : undefined,
    blocks,
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
