import type { AttachmentRef } from '../composer';
import type { TranscriptAuthor, TranscriptBlock, BadgeVariant } from './types';
import { isRuntimeDiagnosticText } from './runtimeDiagnostics';

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

export interface HubMessageAttachment {
  id: string;
  hash?: string;
  size: number;
  mime_type: string;
  original_name?: string;
  uploader_user_id?: string;
  metadata?: string;
  created_at?: string;
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
  /**
   * Message-level pin state. Hub REST messages carry no pin field — pin lives
   * in the `message_pins` table, surfaced via MESSAGE_PIN/MESSAGE_UNPIN WS
   * frames and `GET /client/sessions/{id}/pins`; callers merge the pinMap
   * store snapshot via `withPinnedState` before normalizing (see below). The
   * adapter writes it through to `block.pinned`.
   */
  pinned?: boolean;
  created_at?: string;
  attachments?: HubMessageAttachment[];
  sender?: {
    username?: string;
    nickname?: string;
  };
}

/** zh fallback for `message.recalled` when no translator is injected. */
const RECALLED_TEXT_FALLBACK = '消息已撤回';

/**
 * zh fallbacks for the missing-attachment degraded labels (#1972) when no
 * translator is injected. Keys live in the shared 'chatview' namespace.
 */
const ATTACHMENT_MISSING_IMAGE_FALLBACK = '图片附件缺失';
const ATTACHMENT_MISSING_FILE_FALLBACK = '文件附件缺失';

/**
 * Plain-text translator callback for i18n of normalizer-owned labels.
 * Key space: the shared 'chatview' namespace (see chatview/i18n/resources.ts).
 */
export type NormalizeHubTranslate = (key: string) => string;

/**
 * pin 状态来源（已落地，2026-08-02 专项清理时确认闭环）：
 *
 * Survey (2026-08-01, sonnet-unpin-recall 续23 → unpin menu entry):
 * - hub-server `model.Message` has no `pinned` field; pins live in the
 *   separate `message_pins` table (`model.MessagePin`), surfaced only via
 *   REST `GET /client/sessions/{id}/pins` — which the frontend has no runtime
 *   consumer for (only e2e mocks / payload path builders).
 * - WS frames `message.pin` (payload: session_id, message_id,
 *   pinned_by_user_id, pinned_at) and `message.unpin` (session_id,
 *   message_id) carry the pin events, but the consumers only refresh:
 *   web (webHubRealtime.ts) invalidates the hub-messages query — whose
 *   re-fetched payload still has no pin field — and desktop
 *   (useHubEventStream.ts / hubEventBridge.ts) just touches `lastMessage`.
 * - `hubClientDomainTypes.HubMessage.pinned` was deliberately NOT added:
 *   the REST message shape has no such field, so it would be a dead field.
 *
 * Landed store path: the web / desktop WS handlers maintain a
 * session-scoped `messageId → pinned` map (pinMap.ts, fed by the
 * MESSAGE_PIN/MESSAGE_UNPIN frames, seeded from `GET /client/sessions/{id}/pins`),
 * and the normalize callers (webWorkbenchTranscript.ts /
 * useDesktopWorkbenchModel.ts) merge the map via `withPinnedState` into
 * `HubMessageTranscriptInput.pinned` before calling this function — the
 * adapter below writes it through to `block.pinned`, and the context menu
 * toggles pin/unpin off `block.pinned`.
 */

export function normalizeHubMessagesToTranscript(
  messages: HubMessageTranscriptInput[] | undefined,
  t?: NormalizeHubTranslate,
): TranscriptBlock[] {
  if (!messages?.length) return [];

  return messages
    .map((message, index) => ({ block: normalizeHubMessage(message, t), index, timestamp: timestampMs(message) }))
    .filter((entry): entry is { block: TranscriptBlock; index: number; timestamp: number } => Boolean(entry.block))
    .sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      const seq = (messageSeq(a.block.id) ?? 0) - (messageSeq(b.block.id) ?? 0);
      if (seq !== 0) return seq;
      return a.index - b.index;
    })
    .map((entry) => entry.block);
}

/**
 * Transcript block id for a hub message — single source of truth for the
 * `hub-message-` prefix so unread-divider anchors (desktop IM) match blocks.
 * Returns undefined when no stable id can be derived.
 */
export function hubMessageBlockId(message: HubMessageTranscriptInput): string | undefined {
  const id = message.client_msg_id ?? message.id ?? message.message_id ?? fallbackMessageId(message);
  return id ? `hub-message-${id}` : undefined;
}

function normalizeHubMessage(
  message: HubMessageTranscriptInput,
  t?: NormalizeHubTranslate,
): TranscriptBlock | null {
  const id = hubMessageBlockId(message);
  if (!id) return null;

  const contentType = message.content_type?.trim().toLowerCase();
  const recalled = message.recalled;
  // Only `pinned: true` is written through — absent/false keeps the field
  // unset so `block.pinned` defaults to `undefined` (exactOptional style).
  const pinned = message.pinned === true;

  // Image or file attachment message
  if (!recalled && (contentType === 'image' || contentType === 'file')) {
    const attachment = message.attachments?.[0];
    if (attachment) {
      const attachmentRef: AttachmentRef = {
        id: attachment.id,
        name: attachment.original_name ?? 'file',
        ...(attachment.original_name ? { original_name: attachment.original_name } : {}),
        size: attachment.size,
        mime_type: attachment.mime_type,
        ...(attachment.hash ? { hash: attachment.hash } : {}),
        ...(attachment.created_at ? { created_at: attachment.created_at } : {}),
      };
      return {
        id,
        author: normalizeAuthor(message),
        ...(message.created_at ? { createdAt: message.created_at } : {}),
        ...(pinned ? { pinned: true } : {}),
        kind: 'attachment',
        attachmentRef,
        contentType: contentType === 'image' ? 'image' : 'file',
      };
    }
    // #1972 honest degradation: the Hub delivered an image/file message but
    // the attachment record is missing. Emit an attachment block with an
    // unresolvable ref (empty id) so the renderer degrades to the #1938
    // chip + explicit status notice. The text fallback below cannot render
    // image/file content, so dropping the message there would silently lose
    // it — forbidden by the #1972 acceptance contract.
    return {
      id,
      author: normalizeAuthor(message),
      ...(message.created_at ? { createdAt: message.created_at } : {}),
      ...(pinned ? { pinned: true } : {}),
      kind: 'attachment',
      attachmentRef: {
        id: '',
        name: contentType === 'image'
          ? (t?.('message.attachmentMissingImage') ?? ATTACHMENT_MISSING_IMAGE_FALLBACK)
          : (t?.('message.attachmentMissingFile') ?? ATTACHMENT_MISSING_FILE_FALLBACK),
        size: 0,
        mime_type: '',
      },
      contentType: contentType === 'image' ? 'image' : 'file',
    };
  }

  const metadata = recalled ? null : hubContentMetadata(message.content);
  const text = recalled ? (t?.('message.recalled') ?? RECALLED_TEXT_FALLBACK) : renderHubContent(message.content, metadata?.record);
  if (!text.trim()) return null;
  if (isRuntimeDiagnosticText(text)) return null;

  if (metadata?.routeDecision) {
    return {
      id,
      author: normalizeAuthor(message),
      ...(message.created_at ? { createdAt: message.created_at } : {}),
      ...(pinned ? { pinned: true } : {}),
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
    id,
    author: normalizeAuthor(message),
    ...(message.created_at ? { createdAt: message.created_at } : {}),
    ...(pinned ? { pinned: true } : {}),
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
  badgeVariant?: BadgeVariant;
} {
  if (!metadata) return {};

  const sender = normalizeAuthor(message);
  const toAgentLabel = agentLabel(metadata.toAgent);
  const fromAgentLabel = agentLabel(metadata.fromAgent) ?? (sender.role === 'agent' ? sender.name : undefined);
  const mentionLabels = metadata.mentions.map(agentLabel).filter((label): label is string => Boolean(label));
  const taskStatus = metadata.agentTask?.status;
  // 内部 taskID 不进主聊天流（AGENTS §5）——detail 只保留人类可读信息
  const detailParts = [
    metadata.imKind ? `IM ${metadata.imKind}` : undefined,
    fromAgentLabel && toAgentLabel ? `${fromAgentLabel} -> ${toAgentLabel}` : undefined,
    mentionLabels.length ? `mentions ${mentionLabels.map((label) => `@${label}`).join(', ')}` : undefined,
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
