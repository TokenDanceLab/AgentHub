import type { TranscriptAuthor, TranscriptBlock } from './types';

export interface HubMessageAgentRef {
  id?: string;
  label?: string;
  runtime_id?: string;
}

export interface HubMessageAgentTaskRef {
  id?: string;
  task_id?: string;
  status?: 'queued' | 'assigned' | 'working' | 'dispatched' | 'running' | 'done' | 'failed' | 'cancelled';
  queue_id?: string;
}

export interface HubMessageRouteDecisionRef {
  action?: string;
  summary?: string;
  target_agent?: string;
  targetAgent?: string;
}

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

  const metadata = message.recalled ? null : hubContentMetadata(message.content);
  const text = message.recalled ? '消息已撤回' : renderHubContent(message.content, metadata?.record);
  if (!text.trim()) return null;

  if (metadata?.routeDecision) {
    return {
      id: `hub-message-${id}`,
      author: normalizeAuthor(message),
      ...(message.created_at ? { createdAt: message.created_at } : {}),
      kind: 'route_decision',
      action: metadata.routeDecision.action ?? 'route',
      ...(metadata.routeDecision.summary ?? text ? { summary: metadata.routeDecision.summary ?? text } : {}),
      ...(metadata.routeDecision.target_agent ?? metadata.routeDecision.targetAgent
        ? { targetAgent: metadata.routeDecision.target_agent ?? metadata.routeDecision.targetAgent }
        : {}),
    };
  }

  const visibleState = visibleIMState(message, metadata);
  return {
    id: `hub-message-${id}`,
    author: normalizeAuthor(message),
    ...(message.created_at ? { createdAt: message.created_at } : {}),
    kind: 'text',
    text,
    ...(visibleState.displayTitle ? { displayTitle: visibleState.displayTitle } : {}),
    ...(visibleState.displayDetail ? { displayDetail: visibleState.displayDetail } : {}),
    ...(visibleState.badgeLabel ? { badgeLabel: visibleState.badgeLabel, badgeVariant: visibleState.badgeVariant } : {}),
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

function renderHubContent(content: unknown, knownRecord?: Record<string, unknown>): string {
  if (knownRecord) {
    if (typeof knownRecord.text === 'string') return knownRecord.text;
    if (typeof knownRecord.content === 'string') return knownRecord.content;
    if (typeof knownRecord.summary === 'string') return knownRecord.summary;
  }
  if (typeof content === 'string') {
    const parsed = parseJsonRecord(content);
    if (typeof parsed?.text === 'string') return parsed.text;
    if (typeof parsed?.content === 'string') return parsed.content;
    if (typeof parsed?.summary === 'string') return parsed.summary;
    return content;
  }
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const record = content as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (typeof record.content === 'string') return record.content;
    if (typeof record.summary === 'string') return record.summary;
  }
  return content == null ? '' : JSON.stringify(content);
}

function hubContentMetadata(content: unknown): {
  record: Record<string, unknown>;
  mentions: HubMessageAgentRef[];
  toAgent?: HubMessageAgentRef;
  fromAgent?: HubMessageAgentRef;
  agentTask?: HubMessageAgentTaskRef;
  routeDecision?: HubMessageRouteDecisionRef;
  imKind?: string;
} | null {
  const record = contentRecord(content);
  if (!record) return null;
  const mentions = agentRefsFromArray(record.mentions);
  const toAgent = agentRefFromRecord(record.to_agent ?? record.toAgent ?? record.target_agent ?? record.targetAgent);
  const fromAgent = agentRefFromRecord(record.from_agent ?? record.fromAgent);
  const agentTask = agentTaskFromRecord(record.agent_task ?? record.agentTask);
  const routeDecision = routeDecisionFromRecord(record.route_decision ?? record.routeDecision);
  const imKind = stringField(record.im_kind ?? record.imKind ?? record.conversation_kind ?? record.conversationKind);
  if (!mentions.length && !toAgent && !fromAgent && !agentTask && !routeDecision && !imKind) return { record, mentions: [] };
  return {
    record,
    mentions,
    ...(toAgent ? { toAgent } : {}),
    ...(fromAgent ? { fromAgent } : {}),
    ...(agentTask ? { agentTask } : {}),
    ...(routeDecision ? { routeDecision } : {}),
    ...(imKind ? { imKind } : {}),
  };
}

function visibleIMState(
  message: HubMessageTranscriptInput,
  metadata: ReturnType<typeof hubContentMetadata>,
): {
  displayTitle?: string;
  displayDetail?: string;
  badgeLabel?: string;
  badgeVariant?: 'thinking' | 'success' | 'warning' | 'danger' | 'primary';
} {
  if (!metadata) return {};

  const sender = normalizeAuthor(message);
  const toAgentLabel = agentLabel(metadata.toAgent);
  const fromAgentLabel = agentLabel(metadata.fromAgent) ?? (sender.role === 'agent' ? sender.name : undefined);
  const mentionLabels = metadata.mentions.map(agentLabel).filter((label): label is string => Boolean(label));
  const taskID = metadata.agentTask?.id ?? metadata.agentTask?.task_id;
  const taskStatus = metadata.agentTask?.status;
  const detailParts = [
    metadata.imKind ? `IM ${metadata.imKind}` : undefined,
    fromAgentLabel && toAgentLabel ? `${fromAgentLabel} -> ${toAgentLabel}` : undefined,
    mentionLabels.length ? `mentions ${mentionLabels.map((label) => `@${label}`).join(', ')}` : undefined,
    taskID ? `task ${taskID}` : undefined,
  ].filter((part): part is string => Boolean(part));

  const isAgentDM = metadata.imKind === 'agent_dm' || Boolean(toAgentLabel);
  const isAgentToAgent = sender.role === 'agent' && Boolean(toAgentLabel);
  const hasMentionedAgents = mentionLabels.length > 0;
  return {
    ...(isAgentToAgent
      ? { displayTitle: 'Agent -> Agent' }
      : isAgentDM
        ? { displayTitle: 'Agent DM' }
        : hasMentionedAgents
          ? { displayTitle: 'Group @Agent' }
          : {}),
    ...(detailParts.length ? { displayDetail: detailParts.join(' · ') } : {}),
    ...(taskStatus
      ? {
          badgeLabel: `@Agent ${taskStatus}`,
          badgeVariant: taskStatusBadgeVariant(taskStatus),
        }
      : hasMentionedAgents
        ? { badgeLabel: '@Agent', badgeVariant: 'primary' as const }
        : {}),
  };
}

function contentRecord(content: unknown): Record<string, unknown> | null {
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    return content as Record<string, unknown>;
  }
  if (typeof content === 'string') return parseJsonRecord(content);
  return null;
}

function agentRefsFromArray(value: unknown): HubMessageAgentRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(agentRefFromRecord)
    .filter((ref): ref is HubMessageAgentRef => Boolean(ref));
}

function agentRefFromRecord(value: unknown): HubMessageAgentRef | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const id = stringField(record.id ?? record.agent_id ?? record.agentId);
  const label = stringField(record.label ?? record.name ?? record.display_name ?? record.displayName);
  const runtimeID = stringField(record.runtime_id ?? record.runtimeId);
  if (!id && !label && !runtimeID) return undefined;
  return {
    ...(id ? { id } : {}),
    ...(label ? { label } : {}),
    ...(runtimeID ? { runtime_id: runtimeID } : {}),
  };
}

function agentTaskFromRecord(value: unknown): HubMessageAgentTaskRef | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const id = stringField(record.id);
  const taskID = stringField(record.task_id ?? record.taskId);
  const status = taskStatusField(record.status);
  const queueID = stringField(record.queue_id ?? record.queueId);
  if (!id && !taskID && !status && !queueID) return undefined;
  return {
    ...(id ? { id } : {}),
    ...(taskID ? { task_id: taskID } : {}),
    ...(status ? { status } : {}),
    ...(queueID ? { queue_id: queueID } : {}),
  };
}

function routeDecisionFromRecord(value: unknown): HubMessageRouteDecisionRef | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const action = stringField(record.action);
  const summary = stringField(record.summary ?? record.reasoning ?? record.instructions);
  const targetAgent = stringField(record.target_agent ?? record.targetAgent);
  if (!action && !summary && !targetAgent) return undefined;
  return {
    ...(action ? { action } : {}),
    ...(summary ? { summary } : {}),
    ...(targetAgent ? { target_agent: targetAgent } : {}),
  };
}

function agentLabel(ref: HubMessageAgentRef | undefined): string | undefined {
  return ref?.label ?? ref?.id;
}

function taskStatusField(value: unknown): HubMessageAgentTaskRef['status'] | undefined {
  const status = stringField(value);
  switch (status) {
    case 'queued':
    case 'assigned':
    case 'working':
    case 'dispatched':
    case 'running':
    case 'done':
    case 'failed':
    case 'cancelled':
      return status;
    default:
      return undefined;
  }
}

function taskStatusBadgeVariant(
  status: NonNullable<HubMessageAgentTaskRef['status']>,
): 'thinking' | 'success' | 'warning' | 'danger' | 'primary' {
  switch (status) {
    case 'done':
      return 'success';
    case 'failed':
    case 'cancelled':
      return 'danger';
    case 'running':
    case 'dispatched':
    case 'assigned':
    case 'working':
      return 'thinking';
    case 'queued':
    default:
      return 'primary';
  }
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

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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
