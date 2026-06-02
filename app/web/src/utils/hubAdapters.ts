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

export interface AgentRunEventLike {
  id?: string;
  task_id?: string;
  edge_run_id?: string;
  session_id?: string;
  agent_instance_id?: string;
  event_seq?: number;
  event_type?: string;
  payload?: unknown;
  created_at?: string;
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

function readFirstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readString(record, key);
    if (value) return value;
  }
  return undefined;
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

function outputBatchText(record: Record<string, unknown>): string | undefined {
  if (record.stream !== undefined && record.stream !== 'stdout') return undefined;
  if (!Array.isArray(record.chunks)) return undefined;
  const text = record.chunks
    .map((chunk) => (isRecord(chunk) && typeof chunk.text === 'string' ? chunk.text : ''))
    .join('');
  return text || undefined;
}

function fileChangeBlocksFromRecord(record: Record<string, unknown>): MessageBlock[] {
  const files = Array.isArray(record.files)
    ? record.files
    : Array.isArray(record.changes)
      ? record.changes
      : null;

  if (files) {
    return files.flatMap((file) => {
      if (!isRecord(file)) return [];
      const path = readFirstString(file, ['path', 'filePath', 'file_path']);
      if (!path) return [];
      const block: Extract<MessageBlock, { kind: 'file_change' }> = {
        kind: 'file_change',
        path,
        action: normalizeFileAction(file.action ?? file.kind ?? file.status),
      };
      const diff = readString(file, 'diff');
      if (diff) block.diff = diff;
      return [block];
    });
  }

  const path = readFirstString(record, ['path', 'filePath', 'file_path']);
  if (!path || (record.action === undefined && record.kind === undefined && record.diff === undefined)) {
    return [];
  }
  const block: Extract<MessageBlock, { kind: 'file_change' }> = {
    kind: 'file_change',
    path,
    action: normalizeFileAction(record.action ?? record.kind ?? record.status),
  };
  const diff = readString(record, 'diff');
  if (diff) block.diff = diff;
  return [block];
}

function runtimePayloadToBlocks(content: unknown): MessageBlock[] | null {
  const record = parseJsonRecord(content);
  if (!record) return null;

  const envelopeEventType = readString(record, 'event_type');
  if (envelopeEventType) {
    const blocks = runtimeEventToBlocks({
      event_type: envelopeEventType,
      payload: record.payload,
    });
    if (blocks.length > 0) return blocks;
  }

  const batchText = outputBatchText(record);
  if (batchText) return [{ kind: 'text', content: batchText }];

  const fileBlocks = fileChangeBlocksFromRecord(record);
  if (fileBlocks.length > 0) return fileBlocks;

  const callId = readFirstString(record, ['callId', 'toolUseId', 'tool_use_id', 'callID']);
  const toolName = readFirstString(record, ['toolName', 'tool', 'name']);
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

  // ── Error block detection ─────────────────
  const errorMessage = readFirstString(record, ['error', 'error_message', 'errorMessage', 'message']);
  const errorType = readFirstString(record, ['error_type', 'errorType', 'error_code', 'errorCode']);
  const errorDetail = readFirstString(record, ['detail', 'stack', 'stack_trace', 'stackTrace']);
  const isRetryable = record.retryable === true || record.retry === true || record.can_retry === true;
  if (errorMessage || errorType) {
    const errorBlock: Extract<MessageBlock, { kind: 'error' }> = {
      kind: 'error',
      message: errorMessage ?? errorType,
      detail: errorDetail,
      retryable: isRetryable,
    };
    return [errorBlock];
  }

  // ── Citation block detection ──────────────
  const citationUrl = readString(record, 'url');
  const citationText = readFirstString(record, ['text', 'content', 'snippet']);
  const citationTitle = readString(record, 'title');
  if (citationUrl && (citationText || citationTitle)) {
    const citationBlock: Extract<MessageBlock, { kind: 'citation' }> = {
      kind: 'citation',
      url: citationUrl,
      text: citationText,
      title: citationTitle ?? citationUrl,
    };
    return [citationBlock];
  }

  // ── Simple text content ─────────────────────
  // Records whose only meaningful keys are content/text should be
  // surfaced as plain text blocks (matching the old null-fallback in
  // hubMessageToChatMessage) rather than being swallowed by the
  // compact-block fallback below.
  const simpleText = readFirstString(record, ['content', 'text']);
  if (simpleText) {
    return [{ kind: 'text', content: simpleText }];
  }

  // ── Compact block for unrecognized JSON ───
  const recordKeys = Object.keys(record).filter((k) => record[k] !== undefined && record[k] !== null);
  if (recordKeys.length > 0) {
    const summary = stringifyRuntimeValue(content).slice(0, 200);
    const textBlock: Extract<MessageBlock, { kind: 'text' }> = {
      kind: 'text',
      content: summary,
    };
    const compactBlock: Extract<MessageBlock, { kind: 'compact' }> = {
      kind: 'compact',
      summary: summary.length > 100 ? summary.slice(0, 100) + '...' : summary,
      items: [textBlock],
    };
    return [compactBlock];
  }

  return null;
}

function parseRunEventPayload(payload: unknown): unknown {
  if (typeof payload !== 'string') return payload;
  const trimmed = payload.trim();
  if (!trimmed) return '';
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return payload;
  }
}

function runtimeEventToBlocks(event: AgentRunEventLike): MessageBlock[] {
  const eventType = event.event_type ?? '';
  const payload = parseRunEventPayload(event.payload);
  const record = parseJsonRecord(payload);

  switch (eventType) {
    case 'run.agent.session_init':
      return [
        {
          kind: 'session_init',
          model: record ? readFirstString(record, ['model']) : undefined,
          tools: record && Array.isArray(record.tools)
            ? record.tools.filter((tool): tool is string => typeof tool === 'string')
            : undefined,
          permissionMode: record ? readFirstString(record, ['permissionMode', 'permission_mode']) : undefined,
        },
      ];

    case 'run.agent.text_delta':
    case 'run.agent.text_block': {
      const content = record ? readFirstString(record, ['content', 'text', 'delta']) : undefined;
      const text = content ?? (typeof payload === 'string' ? payload : stringifyRuntimeValue(payload));
      if (!text) return [];
      if (record?.contentType === 'code') {
        const block: Extract<MessageBlock, { kind: 'code' }> = { kind: 'code', content: text };
        const language = readString(record, 'language');
        if (language) block.language = language;
        return [block];
      }
      return [{ kind: 'text', content: text }];
    }

    case 'run.agent.thinking': {
      const content = record ? readFirstString(record, ['content', 'text', 'delta']) : undefined;
      const text = content ?? (typeof payload === 'string' ? payload : '');
      return text ? [{ kind: 'thinking', content: text }] : [];
    }

    case 'run.output.batch': {
      if (!record) return [];
      const text = outputBatchText(record);
      return text ? [{ kind: 'text', content: text }] : [];
    }

    case 'run.agent.error':
    case 'run.error': {
      if (!record) {
        const errorText = typeof payload === 'string' ? payload : stringifyRuntimeValue(payload);
        return [{ kind: 'error', message: errorText.slice(0, 500) }];
      }
      const errorBlock: Extract<MessageBlock, { kind: 'error' }> = {
        kind: 'error',
        message: readFirstString(record, ['message', 'error', 'error_message', 'errorMessage']),
        detail: readFirstString(record, ['detail', 'stack', 'stack_trace', 'stackTrace']),
        retryable: record.retryable === true || record.retry === true,
      };
      return [errorBlock];
    }

    case 'run.agent.citation':
    case 'run.citation': {
      if (!record) return [];
      const citationBlock: Extract<MessageBlock, { kind: 'citation' }> = {
        kind: 'citation',
        url: readString(record, 'url'),
        text: readFirstString(record, ['text', 'content', 'snippet']),
        title: readString(record, 'title'),
      };
      return citationBlock.url ? [citationBlock] : [];
    }

    default:
      return runtimePayloadToBlocks(payload) ?? [];
  }
}

export function agentRunEventToChatMessage(event: AgentRunEventLike): ChatMessage {
  const blocks = runtimeEventToBlocks(event);
  const fallback = stringifyRuntimeValue(parseRunEventPayload(event.payload));
  const messageId =
    event.id ??
    `${event.task_id ?? event.session_id ?? 'run-event'}-${event.event_seq ?? event.created_at ?? Date.now()}`;
  return {
    id: messageId,
    role: event.event_type === 'run.agent.session_init' ? 'system' : 'agent',
    timestamp: event.created_at ?? new Date().toISOString(),
    blocks: blocks.length > 0 ? blocks : [{ kind: 'text', content: fallback }],
  };
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

export function projectRunEvents(events: AgentRunEventLike[]): RunDetailProjection {
  return projectRunDetail(events.map((event) => agentRunEventToChatMessage(event)));
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

export function mergeAgentRunEvents<T extends AgentRunEventLike>(current: T[], incoming: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const event of current) {
    byKey.set(event.id ?? `${event.task_id ?? 'task'}-${event.event_seq ?? event.created_at ?? ''}`, event);
  }
  for (const event of incoming) {
    byKey.set(event.id ?? `${event.task_id ?? 'task'}-${event.event_seq ?? event.created_at ?? ''}`, event);
  }
  return [...byKey.values()].sort((a, b) => {
    const seq = (a.event_seq ?? 0) - (b.event_seq ?? 0);
    if (seq !== 0) return seq;
    return (a.created_at ?? '').localeCompare(b.created_at ?? '');
  });
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
