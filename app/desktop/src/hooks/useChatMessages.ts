// Builds ChatMessage objects from WebSocket agent events.
// P0-1: Uses RunState enum for typed status values.
// P0-1: Run lifecycle events invalidate TanStack Query caches; streaming state stays local.
// Status transitions are validated in runStore; invalid jumps are logged here as warnings.

import { useReducer, useEffect, useRef, useCallback } from 'react';
import { createEventStream } from '@/api/eventClient';
import type { StreamHandle } from '@/api/eventClient';
import type { EventEnvelope } from '@shared/events';
import type { ChatMessage, MessageBlock, ToolResultBlock, FileDiff } from '@/components/ChatView.types';
import { useConnectionStore } from '@/stores/connectionStore';
import { useToastStore } from '@/stores/toastStore';
import { useRunStore } from '@/stores/runStore';
import { RunState } from '@/utils/runStateMachine';
import { cancelRun } from '@/api/edgeClient';
import { queryClient } from '@/api/queryClient';
import { updateRunStatusInQueries, upsertRunInQueries } from '@/api/runQueries';

const MAX_MESSAGES = 500;
const MAX_OUTPUT_TEXT = 20000;

const LOOP_WARN_AT = 3;
const LOOP_CANCEL_AT = 5;
const LIVE_TAIL_CURSOR = String(Number.MAX_SAFE_INTEGER);
const THREAD_REPLAY_CURSOR = '0';

interface LoopEntry {
  count: number;
  warned: boolean;
  cancelled: boolean;
}

function hashSignature(toolName: string, input: Record<string, unknown> | undefined): string {
  const args = input ? JSON.stringify(input, Object.keys(input ?? {}).sort()) : '{}';
  return `${toolName}:${args}`;
}

interface RunStateData {
  runId: string;
  projectId?: string;
  threadId?: string;
  status: RunState;
  outputText: string;
  toolCalls: Array<{
    callId: string;
    toolName: string;
    status: string;
    timestamp: string;
    output?: string;
  }>;
  changedFiles: Array<{ path: string; action: string; timestamp: string }>;
  tasks: Array<{ taskId: string; description: string; status: string; summary?: string }>;
  artifacts: Array<{ id: string; path: string; kind: string; createdAt: string; sizeBytes?: number }>;
  previews: Array<{ id: string; url?: string; status: string; createdAt: string }>;
}

export interface PermissionRequestItem {
  requestId: string;
  runId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  /** Risk level from edge-server: low | medium | high | critical */
  riskLevel?: string;
  decision?: 'allow' | 'deny';
  reason?: string;
  timestamp: string;
}

interface State {
  messages: ChatMessage[];
  isConnected: boolean;
  isStreaming: boolean;
  currentRun: RunStateData | null;
  permissionRequests: PermissionRequestItem[];
  agentName: string;
}

type Action =
  | { type: 'EVENT_RECEIVED'; event: EventEnvelope }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'SET_CONNECTED'; connected: boolean }
  | { type: 'RESOLVE_PERMISSION'; requestId: string; decision: 'allow' | 'deny'; reason?: string };

export interface ChatState extends State {
  clearMessages: () => void;
  /** Mark a pending permission request as decided after Edge accepts the REST decision. */
  decidePermission: (requestId: string, decision: 'allow' | 'deny', reason?: string) => void;
}

function mergeBlock(blocks: MessageBlock[], block: MessageBlock): MessageBlock[] {
  // For streaming text: merge into the last text block if it exists
  if (block.kind === 'text') {
    const last = blocks[blocks.length - 1];
    if (last && last.kind === 'text') {
      return [...blocks.slice(0, -1), { kind: 'text', content: last.content + block.content }];
    }
  }
  // For thinking: merge into the last thinking block
  if (block.kind === 'thinking') {
    const last = blocks[blocks.length - 1];
    if (last && last.kind === 'thinking') {
      return [...blocks.slice(0, -1), { kind: 'thinking', content: last.content + block.content }];
    }
  }
  return [...blocks, block];
}

function newAgentMessage(id: string, timestamp: string, agentName?: string, parentId?: string | null): ChatMessage {
  return { id, role: 'agent', timestamp, blocks: [], agentName, ...(parentId ? { parentId } : {}) };
}

function canAppendToAgentMessage(message: ChatMessage | undefined, runId: string | null): message is ChatMessage {
  if (!message || message.role !== 'agent') return false;
  if (!runId || !message.parentId) return true;
  return message.parentId === runId;
}

function capMessages(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length > MAX_MESSAGES) {
    return messages.slice(messages.length - MAX_MESSAGES);
  }
  return messages;
}

function capOutputText(text: string): string {
  if (text.length > MAX_OUTPUT_TEXT) {
    return text.slice(text.length - MAX_OUTPUT_TEXT);
  }
  return text;
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberField(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const stringValue = stringField(value) ?? numberField(value);
    if (stringValue) return stringValue;
  }
  return null;
}

function eventThreadId(event: EventEnvelope): string | null {
  return stringField(event.scope?.threadId) ?? stringField(event.payload.threadId);
}

function eventRunId(event: EventEnvelope): string | null {
  return stringField(event.scope?.runId) ?? stringField(event.payload.runId);
}

function isThreadScopedEvent(event: EventEnvelope): boolean {
  return event.type.startsWith('run.') || event.type.startsWith('message.') || event.type.startsWith('item.');
}

function eventMatchesSelectedThread(event: EventEnvelope, selectedThreadId: string | null | undefined): boolean {
  if (!selectedThreadId || !isThreadScopedEvent(event)) return true;
  return eventThreadId(event) === selectedThreadId;
}

function extractPathFromContent(
  content: string | undefined,
  _toolName: string | undefined,
): string | undefined {
  if (!content) return undefined;
  // Claude Code Write tool output patterns:
  // "Wrote contents to /absolute/path/to/file"
  // "File created: /absolute/path/to/file"
  // "Successfully created and wrote to new file at /absolute/path/to/file"
  const patterns = [
    /(?:Wrote contents to|File created:\s*|file at)\s+(?<path>\/[^\s,]+)/,
    /(?:created|updated|modified)\s+(?<path>\/[^\s,]+)/i,
    /(?<path>\/[^\s,]+)\s+(?:has been (?:created|updated|modified)|written)/i,
  ];
  for (const p of patterns) {
    const m = content.match(p);
    if (m?.groups?.path) return m.groups.path;
  }
  return undefined;
}

function mapUsageToTokenUsage(
  usage: Record<string, unknown> | undefined,
): { input: number; output: number } | undefined {
  if (!usage) return undefined;
  // NDJSON: {inputTokens, outputTokens}
  // Codex: {input_tokens, output_tokens}
  // OpenCode: {input, output}
  const input = (usage.inputTokens ?? usage.input_tokens ?? usage.input) as number | undefined;
  const output = (usage.outputTokens ?? usage.output_tokens ?? usage.output) as number | undefined;
  if (input == null && output == null) return undefined;
  return { input: Number(input ?? 0), output: Number(output ?? 0) };
}

function taskStatus(value: unknown, fallback: Extract<MessageBlock, { kind: 'agent_task' }>['status']): Extract<MessageBlock, { kind: 'agent_task' }>['status'] {
  const normalized = stringField(value)?.toLowerCase();
  switch (normalized) {
    case 'pending':
    case 'queued':
      return 'pending';
    case 'running':
    case 'in_progress':
    case 'dispatching':
      return 'running';
    case 'done':
    case 'completed':
    case 'success':
    case 'succeeded':
      return 'completed';
    case 'failed':
    case 'error':
    case 'cancelled':
      return 'failed';
    default:
      return fallback;
  }
}

function numberValue(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function percentValue(value: unknown): number | undefined {
  const numeric = numericValue(value);
  if (numeric == null) return undefined;
  const pct = numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
  return Math.max(0, Math.min(100, pct));
}

function parseContextUsageBlock(
  event: EventEnvelope,
  variant: Extract<MessageBlock, { kind: 'context_usage' }>['variant'],
): Extract<MessageBlock, { kind: 'context_usage' }> | null {
  const payload = event.payload;
  const context = recordValue(payload.context) ?? payload;
  const cost = recordValue(payload.cost);

  const input = numericValue(context.inputTokens)
    ?? numericValue(context.input_tokens)
    ?? numericValue(context.input);
  const output = numericValue(context.outputTokens)
    ?? numericValue(context.output_tokens)
    ?? numericValue(context.output);
  const total = numericValue(context.totalTokens)
    ?? numericValue(context.total_tokens)
    ?? numericValue(context.total)
    ?? numericValue(payload.tokensUsed)
    ?? numericValue(payload.tokens_used)
    ?? (input != null || output != null ? (input ?? 0) + (output ?? 0) : undefined);
  const contextLimit = numericValue(context.contextLimit)
    ?? numericValue(context.context_limit)
    ?? numericValue(context.limit)
    ?? numericValue(context.maxTokens)
    ?? numericValue(context.max_tokens);
  const usagePercent = percentValue(context.usagePercent)
    ?? percentValue(context.usage_percent)
    ?? percentValue(context.usage)
    ?? percentValue(payload.usagePercent)
    ?? percentValue(payload.usage_percent);
  const remaining = numericValue(context.remaining)
    ?? numericValue(context.tokensRemaining)
    ?? numericValue(context.tokens_remaining)
    ?? numericValue(payload.tokensRemaining)
    ?? numericValue(payload.tokens_remaining);
  const threshold = percentValue(context.threshold) ?? percentValue(payload.threshold);
  const totalCost = numericValue(cost?.totalCostUsd)
    ?? numericValue(cost?.total_cost_usd)
    ?? numericValue(payload.totalCostUsd)
    ?? numericValue(payload.total_cost_usd);

  if (
    input == null &&
    output == null &&
    total == null &&
    contextLimit == null &&
    usagePercent == null &&
    remaining == null
  ) {
    return null;
  }

  return {
    kind: 'context_usage',
    runId: eventRunId(event) ?? undefined,
    input,
    output,
    total,
    contextLimit,
    usagePercent,
    remaining,
    threshold,
    totalCost,
    model: firstString(cost?.modelLabel, cost?.model_label, payload.model, payload.modelLabel) ?? undefined,
    provider: firstString(cost?.providerLabel, cost?.provider_label, payload.provider, payload.providerLabel) ?? undefined,
    variant,
  };
}

function upsertAgentTaskBlock(blocks: MessageBlock[], block: Extract<MessageBlock, { kind: 'agent_task' }>): MessageBlock[] {
  const index = blocks.findIndex((item) => item.kind === 'agent_task' && item.taskId === block.taskId);
  if (index < 0) return [...blocks, block];

  const current = blocks[index] as Extract<MessageBlock, { kind: 'agent_task' }>;
  const next = {
    ...current,
    ...block,
    title: block.title || current.title,
    summary: block.summary || current.summary,
    worker: block.worker || current.worker,
  };
  return [...blocks.slice(0, index), next, ...blocks.slice(index + 1)];
}

function upsertChildAgentBlock(blocks: MessageBlock[], block: Extract<MessageBlock, { kind: 'child_agent' }>): MessageBlock[] {
  const index = blocks.findIndex((item) => (
    item.kind === 'child_agent' &&
    (item.childId === block.childId || Boolean(block.childRunId && item.childRunId === block.childRunId))
  ));
  if (index < 0) return [...blocks, block];

  const current = blocks[index] as Extract<MessageBlock, { kind: 'child_agent' }>;
  const next = {
    ...current,
    ...block,
    title: block.title || current.title,
    agentName: block.agentName || current.agentName,
    parentRunId: block.parentRunId || current.parentRunId,
    childRunId: block.childRunId || current.childRunId,
    result: block.result || current.result,
    error: block.error || current.error,
    durationMs: block.durationMs ?? current.durationMs,
  };
  return [...blocks.slice(0, index), next, ...blocks.slice(index + 1)];
}

function upsertContextUsageBlock(blocks: MessageBlock[], block: Extract<MessageBlock, { kind: 'context_usage' }>): MessageBlock[] {
  const index = blocks.findIndex((item) => (
    item.kind === 'context_usage' &&
    (block.runId == null || item.runId == null || item.runId === block.runId)
  ));
  if (index < 0) return [...blocks, block];

  const current = blocks[index] as Extract<MessageBlock, { kind: 'context_usage' }>;
  const next = {
    ...current,
    ...block,
    input: block.input ?? current.input,
    output: block.output ?? current.output,
    total: block.total ?? current.total,
    contextLimit: block.contextLimit ?? current.contextLimit,
    usagePercent: block.usagePercent ?? current.usagePercent,
    remaining: block.remaining ?? current.remaining,
    threshold: block.threshold ?? current.threshold,
    totalCost: block.totalCost ?? current.totalCost,
    model: block.model || current.model,
    provider: block.provider || current.provider,
    variant: block.variant ?? current.variant,
  };
  return [...blocks.slice(0, index), next, ...blocks.slice(index + 1)];
}

function appendOrUpdateAgentBlock(
  messages: ChatMessage[],
  event: EventEnvelope,
  agentName: string | undefined,
  block: MessageBlock,
  parentRunIdOverride?: string | null,
): ChatMessage[] {
  const runId = parentRunIdOverride ?? eventRunId(event);
  const last = messages[messages.length - 1];
  const upsert = (blocks: MessageBlock[]) => {
    if (block.kind === 'agent_task') return upsertAgentTaskBlock(blocks, block);
    if (block.kind === 'child_agent') return upsertChildAgentBlock(blocks, block);
    if (block.kind === 'context_usage') return upsertContextUsageBlock(blocks, block);
    return [...blocks, block];
  };

  if (canAppendToAgentMessage(last, runId)) {
    return [...messages.slice(0, -1), { ...last, blocks: upsert(last.blocks) }];
  }

  const msg = newAgentMessage(event.id, event.sentAt, agentName, runId);
  msg.blocks = [block];
  return [...messages, msg];
}

function routeDecisionPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const nested = payload.decision ?? payload.route_decision ?? payload.routeDecision ?? payload.structuredOutput;
  return nested && typeof nested === 'object'
    ? { ...payload, ...(nested as Record<string, unknown>) }
    : payload;
}

function childAgentIdentity(payload: Record<string, unknown>, event: EventEnvelope): string {
  return firstString(
    payload.childId,
    payload.child_id,
    payload.subAgentId,
    payload.sub_agent_id,
    payload.agentInstanceId,
    payload.agent_instance_id,
    payload.agentId,
    payload.agent_id,
    payload.taskId,
    payload.task_id,
  ) ?? event.id;
}

function childAgentParentRunId(payload: Record<string, unknown>, event: EventEnvelope): string | null {
  return firstString(
    payload.parentRunId,
    payload.parent_run_id,
    payload.parentId,
    payload.parent_id,
    event.scope?.parentRunId,
    event.scope?.parent_id,
    event.scope?.runId,
  ) ?? eventRunId(event);
}

function childAgentRunId(payload: Record<string, unknown>, parentRunId: string | null): string | undefined {
  const explicit = firstString(
    payload.childRunId,
    payload.child_run_id,
    payload.subAgentRunId,
    payload.sub_agent_run_id,
  );
  if (explicit) return explicit;

  const payloadRunId = firstString(payload.runId, payload.run_id);
  return payloadRunId && payloadRunId !== parentRunId ? payloadRunId : undefined;
}

function processEvent(state: State, event: EventEnvelope): State {
  const ts = event.sentAt;
  let { messages } = state;
  let { currentRun } = state;
  let { isStreaming } = state;
  let { agentName } = state;

  switch (event.type) {
    case 'run.queued': {
      // Silently track – rendering handled by streaming indicator
      break;
    }

    case 'run.started': {
      const rid = event.payload.runId as string;
      currentRun = {
        runId: rid,
        projectId: (event.payload.projectId ?? event.scope.projectId) as string | undefined,
        threadId: (event.payload.threadId ?? event.scope.threadId) as string | undefined,
        status: RunState.RUNNING,
        outputText: '',
        toolCalls: [],
        changedFiles: [],
        tasks: [],
        artifacts: [],
        previews: [],
      };
      isStreaming = true;
      agentName = '';
      break;
    }

    case 'run.agent.session_init': {
      const block: MessageBlock = {
        kind: 'session_init',
        model: event.payload.model as string | undefined,
        tools: event.payload.tools as string[] | undefined,
        permissionMode: event.payload.permissionMode as string | undefined,
      };
      const last = messages[messages.length - 1];
      if (last && last.role === 'system') {
        messages = [...messages.slice(0, -1), { ...last, blocks: [...last.blocks, block] }];
      } else {
        messages = [...messages, { id: event.id, role: 'system', timestamp: ts, blocks: [block] }];
      }
      agentName = (event.payload.model as string) || '';
      break;
    }

    case 'run.agent.text_delta': {
      const content = event.payload.content as string;
      const runId = eventRunId(event);
      const block: MessageBlock = {
        kind: 'text',
        content,
      };
      const last = messages[messages.length - 1];
      if (canAppendToAgentMessage(last, runId)) {
        messages = [...messages.slice(0, -1), { ...last, blocks: mergeBlock(last.blocks, block) }];
      } else {
        const msg = newAgentMessage(event.id, ts, agentName, runId);
        msg.blocks = [block];
        messages = [...messages, msg];
      }
      // Accumulate into outputText for RunDetail Output tab (real-time text stream)
      const rid = event.payload.runId as string;
      if (currentRun && currentRun.runId === rid) {
        currentRun = {
          ...currentRun,
          outputText: capOutputText(currentRun.outputText + content),
        };
      }
      break;
    }

    case 'run.agent.text_block': {
      const runId = eventRunId(event);
      const block: MessageBlock = {
        kind: (event.payload.contentType as MessageBlock['kind']) === 'code' ? 'code' : 'text',
        content: event.payload.content as string,
        language: event.payload.language as string | undefined,
      };
      const last = messages[messages.length - 1];
      if (canAppendToAgentMessage(last, runId)) {
        messages = [...messages.slice(0, -1), { ...last, blocks: [...last.blocks, block] }];
      } else {
        const msg = newAgentMessage(event.id, ts, agentName, runId);
        msg.blocks = [block];
        messages = [...messages, msg];
      }
      break;
    }

    case 'run.agent.thinking': {
      const runId = eventRunId(event);
      const block: MessageBlock = {
        kind: 'thinking',
        content: event.payload.content as string,
      };
      const last = messages[messages.length - 1];
      if (canAppendToAgentMessage(last, runId)) {
        messages = [...messages.slice(0, -1), { ...last, blocks: mergeBlock(last.blocks, block) }];
      } else {
        const msg = newAgentMessage(event.id, ts, agentName, runId);
        msg.blocks = [block];
        messages = [...messages, msg];
      }
      break;
    }

    case 'run.agent.tool_call': {
      const callId = event.payload.callId as string;
      const toolName = event.payload.toolName as string;
      const input = event.payload.input as Record<string, unknown>;
      const status = (event.payload.status ?? 'running') as
        | 'pending'
        | 'running'
        | 'completed'
        | 'failed';
      const runId = eventRunId(event);
      const block: MessageBlock = {
        kind: 'tool_use',
        callId,
        toolName,
        input,
        status,
        children: [],
      };
      if (runId && currentRun && currentRun.runId === runId) {
        currentRun = {
          ...currentRun,
          toolCalls: [...currentRun.toolCalls, { callId, toolName, status, timestamp: ts }],
        };
      }
      const last = messages[messages.length - 1];
      if (canAppendToAgentMessage(last, runId)) {
        messages = [...messages.slice(0, -1), { ...last, blocks: [...last.blocks, block] }];
      } else {
        const msg = newAgentMessage(event.id, ts, agentName, runId);
        msg.blocks = [block];
        messages = [...messages, msg];
      }
      break;
    }

    case 'run.agent.tool_result': {
      const callId = event.payload.callId as string;
      const rawOutput = event.payload.output ?? event.payload.content;
      const outputStr = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput);
      const resultBlock: ToolResultBlock = {
        kind: 'generic_result',
        output: outputStr,
      };
      if (currentRun) {
        const updated = currentRun.toolCalls.map((tc) =>
          tc.callId === callId ? { ...tc, status: 'completed', output: outputStr } : tc,
        );
        // If draining and all tool calls are now terminal → transition to COMPLETED
        const allDone = updated.every(
          (tc) => tc.status === 'completed' || tc.status === 'failed',
        );
        const newStatus =
          currentRun.status === RunState.DRAINING && allDone
            ? RunState.COMPLETED
            : currentRun.status;
        currentRun = {
          ...currentRun,
          status: newStatus,
          toolCalls: updated,
        };
      }
      // Nest result as child of matching tool_use block
      messages = messages.map((msg) => ({
        ...msg,
        blocks: msg.blocks.map((b) =>
          b.kind === 'tool_use' && b.callId === callId
            ? { ...b, children: [...(b.children ?? []), resultBlock], status: 'completed' as const }
            : b,
        ),
      }));
      break;
    }

    case 'run.agent.file_change': {
      // Canonical shape: {path, action, diff?} per events.md
      // NDJSON fallback: {callId, toolName, content, isError}
      const runId = eventRunId(event);
      const content = event.payload.content as string | undefined;
      const toolName = event.payload.toolName as string | undefined;
      const filePath = (event.payload.path as string) ?? extractPathFromContent(content, toolName);
      const action =
        (event.payload.action as 'created' | 'modified' | 'deleted') ??
        (toolName === 'Write' ? 'created' : 'modified');
      if (!filePath) break;
      const block: MessageBlock = {
        kind: 'file_change',
        path: filePath,
        action,
        diff: event.payload.diff as string | undefined,
        structuredDiff: event.payload.structuredDiff as FileDiff | undefined,
      };
      if (runId && currentRun && currentRun.runId === runId) {
        currentRun = {
          ...currentRun,
          changedFiles: [...currentRun.changedFiles, { path: filePath, action, timestamp: ts }],
        };
      }
      const last = messages[messages.length - 1];
      if (canAppendToAgentMessage(last, runId)) {
        messages = [...messages.slice(0, -1), { ...last, blocks: [...last.blocks, block] }];
      } else {
        const msg = newAgentMessage(event.id, ts, agentName, runId);
        msg.blocks = [block];
        messages = [...messages, msg];
      }
      break;
    }

    case 'run.agent.result': {
      const runId = eventRunId(event);
      const rawTokenUsage =
        event.payload.tokenUsage ??
        mapUsageToTokenUsage(event.payload.usage as Record<string, unknown> | undefined);
      const success = event.payload.success as boolean;
      const block: MessageBlock = {
        kind: 'result',
        success,
        error: event.payload.error as string | undefined,
        tokenUsage: rawTokenUsage as { input: number; output: number } | undefined,
      };
      const last = messages[messages.length - 1];
      if (canAppendToAgentMessage(last, runId)) {
        messages = [...messages.slice(0, -1), { ...last, blocks: [...last.blocks, block] }];
      } else if (!success) {
        const msg = newAgentMessage(event.id, ts, agentName, runId);
        msg.blocks = [block];
        messages = [...messages, msg];
      }
      break;
    }

    case 'run.agent.route_decision': {
      const payload = routeDecisionPayload(event.payload);
      const action = firstString(payload.action) ?? 'route';
      const block: MessageBlock = {
        kind: 'route_decision',
        action,
        instructions: firstString(payload.instructions) ?? undefined,
        summary: firstString(payload.summary) ?? undefined,
        reasoning: firstString(payload.reasoning) ?? undefined,
        nextWorker: firstString(payload.next_worker, payload.nextWorker, payload.worker, payload.member_id) ?? undefined,
        blockedReason: firstString(payload.blocked_reason, payload.blockedReason) ?? undefined,
      };
      messages = appendOrUpdateAgentBlock(messages, event, agentName, block);
      break;
    }

    case 'run.agent.task_started': {
      const tid = firstString(
        event.payload.taskId,
        event.payload.task_id,
        event.payload.agent_task_id,
        event.payload.team_task_id,
      ) ?? event.id;
      const description = firstString(
        event.payload.description,
        event.payload.objective,
        event.payload.prompt,
        event.payload.task_prompt,
      ) ?? tid;
      if (currentRun) {
        currentRun = {
          ...currentRun,
          tasks: [
            ...currentRun.tasks,
            {
              taskId: tid,
              description,
              status: 'running',
            },
          ],
        };
      }
      messages = appendOrUpdateAgentBlock(messages, event, agentName, {
        kind: 'agent_task',
        taskId: tid,
        title: description,
        status: 'running',
        worker: firstString(event.payload.worker, event.payload.agent, event.payload.member_id, event.payload.assignee_member_id) ?? undefined,
      });
      break;
    }

    case 'run.agent.task_dispatched':
    case 'run.agent.child_spawn':
    case 'run.agent.child_started':
    case 'child_spawn': {
      const payload = event.payload;
      const parentRunId = childAgentParentRunId(payload, event);
      const childId = childAgentIdentity(payload, event);
      const childRunId = childAgentRunId(payload, parentRunId);
      const title = firstString(
        payload.title,
        payload.task,
        payload.description,
        payload.objective,
        payload.prompt,
        payload.message,
      ) ?? childId;
      const block: MessageBlock = {
        kind: 'child_agent',
        childId,
        parentRunId: parentRunId ?? undefined,
        childRunId,
        agentName: firstString(
          payload.agentName,
          payload.agent_name,
          payload.agent,
          payload.worker,
          payload.taskType,
          payload.task_type,
          payload.role,
        ) ?? undefined,
        title,
        status: taskStatus(payload.status, 'running'),
      };
      messages = appendOrUpdateAgentBlock(messages, event, agentName, block, parentRunId);
      break;
    }

    case 'run.agent.task_progress': {
      const tid = firstString(
        event.payload.taskId,
        event.payload.task_id,
        event.payload.agent_task_id,
        event.payload.team_task_id,
      ) ?? event.id;
      const description = firstString(
        event.payload.description,
        event.payload.objective,
        event.payload.title,
      );
      if (currentRun) {
        currentRun = {
          ...currentRun,
          tasks: currentRun.tasks.map((t) =>
            t.taskId === tid
              ? {
                  ...t,
                  description: description || t.description,
                  status: 'running',
                }
              : t,
          ),
        };
      }
      messages = appendOrUpdateAgentBlock(messages, event, agentName, {
        kind: 'agent_task',
        taskId: tid,
        title: description ?? '',
        status: 'running',
        summary: firstString(event.payload.summary, event.payload.message, event.payload.progress) ?? undefined,
        worker: firstString(event.payload.worker, event.payload.agent, event.payload.member_id, event.payload.assignee_member_id) ?? undefined,
      });
      break;
    }

    case 'run.agent.child_result':
    case 'run.agent.child_completed':
    case 'run.agent.child_failed':
    case 'child_result': {
      const payload = event.payload;
      const parentRunId = childAgentParentRunId(payload, event);
      const childId = childAgentIdentity(payload, event);
      const childRunId = childAgentRunId(payload, parentRunId);
      const explicitStatus = event.type === 'run.agent.child_failed'
        ? 'failed'
        : payload.success === false
          ? 'failed'
          : 'completed';
      const block: MessageBlock = {
        kind: 'child_agent',
        childId,
        parentRunId: parentRunId ?? undefined,
        childRunId,
        agentName: firstString(
          payload.agentName,
          payload.agent_name,
          payload.agent,
          payload.worker,
          payload.taskType,
          payload.task_type,
          payload.role,
        ) ?? undefined,
        title: firstString(
          payload.title,
          payload.task,
          payload.description,
          payload.objective,
          payload.prompt,
        ) ?? '',
        status: taskStatus(payload.status, explicitStatus),
        result: firstString(payload.result, payload.summary, payload.output, payload.message) ?? undefined,
        error: firstString(payload.error, payload.errorMessage, payload.error_message) ?? undefined,
        durationMs: numberValue(payload.durationMs) ?? numberValue(payload.duration_ms),
      };
      messages = appendOrUpdateAgentBlock(messages, event, agentName, block, parentRunId);
      break;
    }

    case 'run.agent.task_notification': {
      const tid = firstString(
        event.payload.taskId,
        event.payload.task_id,
        event.payload.agent_task_id,
        event.payload.team_task_id,
      ) ?? event.id;
      const status = taskStatus(event.payload.status, 'completed');
      const summary = firstString(event.payload.summary, event.payload.message, event.payload.result);
      if (currentRun) {
        currentRun = {
          ...currentRun,
          tasks: currentRun.tasks.map((t) =>
            t.taskId === tid
              ? {
                  ...t,
                  status,
                  summary: summary ?? '',
                }
              : t,
          ),
        };
      }
      messages = appendOrUpdateAgentBlock(messages, event, agentName, {
        kind: 'agent_task',
        taskId: tid,
        title: firstString(event.payload.description, event.payload.objective, event.payload.title) ?? '',
        status,
        summary: summary ?? undefined,
        worker: firstString(event.payload.worker, event.payload.agent, event.payload.member_id, event.payload.assignee_member_id) ?? undefined,
      });
      break;
    }

    case 'run.agent.session_metrics':
    case 'run.agent.context_usage':
    case 'run.agent.context_warning':
    case 'run.agent.context_compaction': {
      const variant =
        event.type === 'run.agent.context_warning'
          ? 'warning'
          : event.type === 'run.agent.context_compaction'
            ? 'compaction'
            : 'usage';
      const block = parseContextUsageBlock(event, variant);
      if (block) {
        messages = appendOrUpdateAgentBlock(messages, event, agentName, block);
        // Push live token stats to the UI store so StatusBar can display them
        if (block.total != null) {
          useRunStore.getState().setTokenStats({
            inputTokens: block.input ?? 0,
            outputTokens: block.output ?? 0,
            totalTokens: block.total,
            contextLimit: block.contextLimit,
            usagePercent: block.usagePercent,
          });
        }
      }
      break;
    }

    case 'run.finished': {
      isStreaming = false;
      const rid = event.payload.runId as string;
      if (currentRun && currentRun.runId === rid) {
        if (
          currentRun.status !== RunState.RUNNING &&
          currentRun.status !== RunState.STREAMING &&
          currentRun.status !== RunState.WAITING_FOR_INPUT &&
          currentRun.status !== RunState.DRAINING
        ) {
          console.warn(
            `[useChatMessages] run.finished: unexpected status ${currentRun.status} → ${RunState.COMPLETED}`,
          );
        }
        // Draining: final answer received but background tools still running
        const hasPending = currentRun.toolCalls.some(
          (tc) => tc.status === 'pending' || tc.status === 'running',
        );
        const nextStatus = hasPending ? RunState.DRAINING : RunState.COMPLETED;
        currentRun = { ...currentRun, status: nextStatus };

        // Mark still-running tool call blocks as 'draining' for visual distinction
        if (hasPending) {
          messages = messages.map((msg) => ({
            ...msg,
            blocks: msg.blocks.map((b) =>
              b.kind === 'tool_use' && (b.status === 'pending' || b.status === 'running')
                ? { ...b, status: 'draining' as const }
                : b,
            ),
          }));
        }
      }
      break;
    }

    case 'run.failed': {
      isStreaming = false;
      const rid = event.payload.runId as string;
      if (currentRun && currentRun.runId === rid) {
        if (
          currentRun.status !== RunState.RUNNING &&
          currentRun.status !== RunState.STREAMING &&
          currentRun.status !== RunState.WAITING_FOR_INPUT &&
          currentRun.status !== RunState.DRAINING
        ) {
          console.warn(
            `[useChatMessages] run.failed: unexpected status ${currentRun.status} → ${RunState.FAILED}`,
          );
        }
        currentRun = { ...currentRun, status: RunState.FAILED };
      }
      break;
    }

    case 'run.cancelled': {
      isStreaming = false;
      const rid = event.payload.runId as string;
      if (currentRun && currentRun.runId === rid) {
        if (
          currentRun.status !== RunState.RUNNING &&
          currentRun.status !== RunState.STREAMING &&
          currentRun.status !== RunState.WAITING_FOR_INPUT &&
          currentRun.status !== RunState.DRAINING
        ) {
          console.warn(
            `[useChatMessages] run.cancelled: unexpected status ${currentRun.status} → ${RunState.CANCELLED}`,
          );
        }
        currentRun = { ...currentRun, status: RunState.CANCELLED };
      }
      break;
    }

    case 'run.output.batch': {
      const rid = event.payload.runId as string;
      const chunks = event.payload.chunks as Array<{ offset: number; text: string }>;
      const text = chunks.map((c) => c.text).join('');
      if (currentRun && currentRun.runId === rid) {
        currentRun = {
          ...currentRun,
          outputText: capOutputText(currentRun.outputText + text),
        };
      }
      break;
    }

    case 'run.agent.permission_requested': {
      const reqId = event.payload.requestId as string;
      const runId = event.payload.runId as string;
      const toolName = event.payload.toolName as string;
      const toolInput = (event.payload.toolInput ?? event.payload.input ?? {}) as Record<string, unknown>;
      const riskLevel = (event.payload.riskLevel as string) ?? undefined;
      const existingIdx = state.permissionRequests.findIndex((r) => r.requestId === reqId);
      const item: PermissionRequestItem = {
        requestId: reqId,
        runId,
        toolName,
        toolInput,
        riskLevel,
        timestamp: ts,
      };
      if (currentRun && currentRun.runId === runId) {
        currentRun = { ...currentRun, status: RunState.WAITING_FOR_INPUT };
      }
      let reqs: PermissionRequestItem[];
      if (existingIdx >= 0) {
        reqs = [...state.permissionRequests];
        reqs[existingIdx] = item;
      } else {
        reqs = [...state.permissionRequests, item];
      }
      return { ...state, currentRun, permissionRequests: reqs.slice(-50) };
    }

    case 'run.agent.permission_decided': {
      const reqId = event.payload.requestId as string;
      const decision = event.payload.decision as 'allow' | 'deny';
      const reason = event.payload.reason as string | undefined;
      const reqs = state.permissionRequests.map((r) =>
        r.requestId === reqId ? { ...r, decision, reason } : r,
      );
      return { ...state, permissionRequests: reqs };
    }

    case 'artifact.created': {
      const runId = event.payload.runId as string;
      const artifactId = event.payload.artifactId as string;
      if (currentRun && currentRun.runId === runId && artifactId) {
        const artifact = {
          id: artifactId,
          path: (event.payload.path as string | undefined) ?? artifactId,
          kind: (event.payload.kind as string | undefined) ?? 'artifact',
          createdAt: ts,
          sizeBytes: event.payload.sizeBytes as number | undefined,
        };
        currentRun = {
          ...currentRun,
          artifacts: [
            ...currentRun.artifacts.filter((item) => item.id !== artifactId),
            artifact,
          ].slice(-20),
        };
      }
      break;
    }

    case 'preview.ready': {
      const runId = event.payload.runId as string;
      const previewId = event.payload.previewId as string;
      if (currentRun && currentRun.runId === runId && previewId) {
        const preview = {
          id: previewId,
          url: event.payload.url as string | undefined,
          status: (event.payload.status as string | undefined) ?? 'ready',
          createdAt: ts,
        };
        currentRun = {
          ...currentRun,
          previews: [
            ...currentRun.previews.filter((item) => item.id !== previewId),
            preview,
          ].slice(-20),
        };
      }
      break;
    }

    default:
      break;
  }

  messages = capMessages(messages);

  return { ...state, messages, isStreaming, currentRun, agentName };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'EVENT_RECEIVED':
      return processEvent(state, action.event);
    case 'CLEAR_MESSAGES':
      return { messages: [], isConnected: state.isConnected, isStreaming: false, currentRun: null, permissionRequests: [], agentName: state.agentName };
    case 'SET_CONNECTED':
      return { ...state, isConnected: action.connected };
    case 'RESOLVE_PERMISSION': {
      const reqs = state.permissionRequests.map((r) =>
        r.requestId === action.requestId
          ? { ...r, decision: action.decision, reason: action.reason }
          : r,
      );
      return { ...state, permissionRequests: reqs };
    }
    default:
      return state;
  }
}

const initialState: State = {
  messages: [],
  isConnected: false,
  isStreaming: false,
  currentRun: null,
  permissionRequests: [],
  agentName: '',
};

export function useChatMessages(online: boolean, selectedThreadId?: string | null): ChatState {
  const [state, dispatch] = useReducer(reducer, initialState);
  const mountedRef = useRef(true);
  const streamRef = useRef<StreamHandle | null>(null);

  const clearMessages = useCallback(() => {
    dispatch({ type: 'CLEAR_MESSAGES' });
  }, []);

  const decidePermission = useCallback(
    (requestId: string, decision: 'allow' | 'deny', reason?: string) => {
      dispatch({ type: 'RESOLVE_PERMISSION', requestId, decision, reason });
    },
    [],
  );

  // Loop detector — persists across renders, resets per run
  const loopDetectorRef = useRef(new Map<string, LoopEntry>());
  const currentRunIdRef = useRef<string | null>(null);
  // Track pending tool call IDs for draining-state detection.
  // run.finished + non-empty pending set → DRAINING instead of COMPLETED.
  const pendingToolCallIdsRef = useRef(new Set<string>());

  useEffect(() => {
    mountedRef.current = true;
    if (!online) {
      dispatch({ type: 'SET_CONNECTED', connected: false });
      return;
    }

    dispatch({ type: 'CLEAR_MESSAGES' });
    currentRunIdRef.current = null;
    loopDetectorRef.current.clear();

    const streamCursor = selectedThreadId ? THREAD_REPLAY_CURSOR : LIVE_TAIL_CURSOR;
    const stream = createEventStream(streamCursor);
    streamRef.current = stream;

    stream.onStatusChange((connected) => {
      if (!mountedRef.current) return;
      dispatch({ type: 'SET_CONNECTED', connected });
    });

    stream.subscribe((event: EventEnvelope) => {
      if (!mountedRef.current) return;
      if (!eventMatchesSelectedThread(event, selectedThreadId)) return;

      // ── Tool call loop detection + draining tracking ──
      if (event.type === 'run.agent.tool_call') {
        const toolName = event.payload.toolName as string;
        const input = event.payload.input as Record<string, unknown> | undefined;
        const runId = event.payload.runId as string;
        const callId = event.payload.callId as string;
        const status = event.payload.status as string | undefined;

        // Track pending tool calls for draining-state detection
        if (callId && runId && runId === currentRunIdRef.current) {
          if (status === 'completed' || status === 'failed') {
            pendingToolCallIdsRef.current.delete(callId);
          } else {
            pendingToolCallIdsRef.current.add(callId);
          }
        }

        if (runId && runId === currentRunIdRef.current) {
          const sig = hashSignature(toolName, input);
          const entry = loopDetectorRef.current.get(sig) || {
            count: 0,
            warned: false,
            cancelled: false,
          };
          entry.count++;

          if (entry.count >= LOOP_CANCEL_AT && !entry.cancelled) {
            entry.cancelled = true;
            cancelRun(runId).catch(() => {});
            useToastStore.getState().addToast({
              type: 'error',
              message: `Loop detected: "${toolName}" called ${entry.count} times with same args. Run cancelled.`,
            });
          } else if (entry.count >= LOOP_WARN_AT && !entry.warned) {
            entry.warned = true;
            useToastStore.getState().addToast({
              type: 'warning',
              message: `Loop warning: "${toolName}" called ${entry.count} times with same args.`,
            });
          }

          loopDetectorRef.current.set(sig, entry);
        }
      }

      if (event.type === 'run.queued') {
        const runId = event.payload.runId as string | undefined;
        if (runId) {
          upsertRunInQueries(queryClient, {
            runId,
            projectId: (event.payload.projectId ?? event.scope.projectId) as string | undefined,
            threadId: (event.payload.threadId ?? event.scope.threadId) as string | undefined,
            status: 'queued',
            createdAt: (event.payload.createdAt as string | undefined) ?? event.sentAt,
          });
        }
      } else if (event.type === 'run.status.changed') {
        const runId = event.payload.runId as string | undefined;
        const status = event.payload.status as string | undefined;
        if (runId && status) updateRunStatusInQueries(queryClient, runId, status);
      }

      // Reset loop detector on new run
      if (event.type === 'run.started') {
        const runId = event.payload.runId as string;
        currentRunIdRef.current = runId;
        loopDetectorRef.current.clear();
        pendingToolCallIdsRef.current.clear();
        useRunStore.getState().setRun(runId);
        upsertRunInQueries(queryClient, {
          runId,
          projectId: (event.payload.projectId ?? event.scope.projectId) as string | undefined,
          threadId: (event.payload.threadId ?? event.scope.threadId) as string | undefined,
          status: 'running',
          startedAt: (event.payload.startedAt as string | undefined) ?? event.sentAt,
        });
      } else if (event.type === 'run.finished') {
        const runId = event.payload.runId as string;
        useRunStore.getState().setRunState(RunState.COMPLETED);
        updateRunStatusInQueries(queryClient, runId, 'finished', {
          finishedAt: (event.payload.finishedAt as string | undefined) ?? event.sentAt,
        });
        queryClient.invalidateQueries({ queryKey: ['runs'] });
        queryClient.invalidateQueries({ queryKey: ['threads'] });
      } else if (event.type === 'run.failed') {
        const runId = event.payload.runId as string;
        useRunStore.getState().setRunState(RunState.FAILED);
        updateRunStatusInQueries(queryClient, runId, 'failed', {
          finishedAt: (event.payload.finishedAt as string | undefined) ?? event.sentAt,
        });
        queryClient.invalidateQueries({ queryKey: ['runs'] });
        queryClient.invalidateQueries({ queryKey: ['threads'] });
      } else if (event.type === 'run.cancelled') {
        const runId = event.payload.runId as string;
        useRunStore.getState().setRunState(RunState.CANCELLED);
        updateRunStatusInQueries(queryClient, runId, 'cancelled', {
          finishedAt: (event.payload.finishedAt as string | undefined) ?? event.sentAt,
        });
        queryClient.invalidateQueries({ queryKey: ['runs'] });
        queryClient.invalidateQueries({ queryKey: ['threads'] });
      } else if (event.type === 'run.agent.permission_requested' || event.type === 'approval.requested') {
        const runId = event.payload.runId as string | undefined;
        if (runId) updateRunStatusInQueries(queryClient, runId, 'waiting_approval');
      }

      dispatch({ type: 'EVENT_RECEIVED', event });
    });

    // QW-3: Poll WebSocket ping-pong latency every 2 s and push to connection store
    const prevLatencyRef = { current: null as number | null };
    const latencyTimer = setInterval(() => {
      if (!mountedRef.current) return;
      const lat = streamRef.current?.getLatency() ?? null;
      if (lat !== prevLatencyRef.current) {
        prevLatencyRef.current = lat;
        useConnectionStore.getState().setWsLatency(lat);
      }
    }, 2000);

    return () => {
      mountedRef.current = false;
      streamRef.current = null;
      clearInterval(latencyTimer);
      stream.close();
    };
  }, [online, selectedThreadId]);

  return { ...state, clearMessages, decidePermission };
}
