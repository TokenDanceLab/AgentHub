// Builds ChatMessage objects from WebSocket agent events.

import { useReducer, useEffect, useRef, useCallback } from 'react';
import { createEventStream } from '@/api/eventClient';
import type { StreamHandle } from '@/api/eventClient';
import type { EventEnvelope } from '@shared/events';
import type { ChatMessage, MessageBlock, ToolResultBlock } from '@/components/ChatView.types';

const MAX_MESSAGES = 500;
const MAX_OUTPUT_TEXT = 20000;

interface RunState {
  runId: string;
  status: string;
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
}

export interface PermissionRequestItem {
  requestId: string;
  runId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  decision?: 'allow' | 'deny';
  reason?: string;
  timestamp: string;
}

interface State {
  messages: ChatMessage[];
  isConnected: boolean;
  isStreaming: boolean;
  currentRun: RunState | null;
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
  /** Submit a user decision for a pending permission request. */
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

function newAgentMessage(id: string, timestamp: string, agentName?: string): ChatMessage {
  return { id, role: 'agent', timestamp, blocks: [], agentName };
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

function processEvent(state: State, event: EventEnvelope): State {
  const ts = event.sentAt;
  let { messages } = state;
  let { currentRun } = state;
  let { isStreaming } = state;
  let { agentName } = state;

  switch (event.type) {
    case 'run.queued': {
      const rid = event.payload.runId as string;
      messages = [
        ...messages,
        {
          id: `run-${rid}`,
          role: 'system',
          timestamp: ts,
          blocks: [{ kind: 'text', content: 'Run queued...' } as MessageBlock],
        },
      ];
      break;
    }

    case 'run.started': {
      const rid = event.payload.runId as string;
      currentRun = {
        runId: rid,
        status: 'running',
        outputText: '',
        toolCalls: [],
        changedFiles: [],
        tasks: [],
      };
      messages = [
        ...messages,
        {
          id: `run-${rid}`,
          role: 'system',
          timestamp: ts,
          blocks: [],
        },
      ];
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
      const block: MessageBlock = {
        kind: 'text',
        content,
      };
      const last = messages[messages.length - 1];
      if (last && last.role === 'agent') {
        messages = [...messages.slice(0, -1), { ...last, blocks: mergeBlock(last.blocks, block) }];
      } else {
        const msg = newAgentMessage(event.id, ts, agentName);
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
      const block: MessageBlock = {
        kind: (event.payload.contentType as MessageBlock['kind']) === 'code' ? 'code' : 'text',
        content: event.payload.content as string,
        language: event.payload.language as string | undefined,
      };
      const last = messages[messages.length - 1];
      if (last && last.role === 'agent') {
        messages = [...messages.slice(0, -1), { ...last, blocks: [...last.blocks, block] }];
      } else {
        const msg = newAgentMessage(event.id, ts, agentName);
        msg.blocks = [block];
        messages = [...messages, msg];
      }
      break;
    }

    case 'run.agent.thinking': {
      const block: MessageBlock = {
        kind: 'thinking',
        content: event.payload.content as string,
      };
      const last = messages[messages.length - 1];
      if (last && last.role === 'agent') {
        messages = [...messages.slice(0, -1), { ...last, blocks: mergeBlock(last.blocks, block) }];
      } else {
        const msg = newAgentMessage(event.id, ts, agentName);
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
      const block: MessageBlock = {
        kind: 'tool_use',
        callId,
        toolName,
        input,
        status,
        children: [],
      };
      const runId = event.payload.runId as string;
      if (runId && currentRun && currentRun.runId === runId) {
        currentRun = {
          ...currentRun,
          toolCalls: [...currentRun.toolCalls, { callId, toolName, status, timestamp: ts }],
        };
      }
      const last = messages[messages.length - 1];
      if (last && last.role === 'agent') {
        messages = [...messages.slice(0, -1), { ...last, blocks: [...last.blocks, block] }];
      } else {
        const msg = newAgentMessage(event.id, ts, agentName);
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
        currentRun = {
          ...currentRun,
          toolCalls: currentRun.toolCalls.map((tc) =>
            tc.callId === callId ? { ...tc, status: 'completed', output: outputStr } : tc,
          ),
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
      };
      const runId = event.payload.runId as string;
      if (runId && currentRun && currentRun.runId === runId) {
        currentRun = {
          ...currentRun,
          changedFiles: [...currentRun.changedFiles, { path: filePath, action, timestamp: ts }],
        };
      }
      const last = messages[messages.length - 1];
      if (last && last.role === 'agent') {
        messages = [...messages.slice(0, -1), { ...last, blocks: [...last.blocks, block] }];
      } else {
        const msg = newAgentMessage(event.id, ts, agentName);
        msg.blocks = [block];
        messages = [...messages, msg];
      }
      break;
    }

    case 'run.agent.result': {
      const rawTokenUsage =
        event.payload.tokenUsage ??
        mapUsageToTokenUsage(event.payload.usage as Record<string, unknown> | undefined);
      const block: MessageBlock = {
        kind: 'result',
        success: event.payload.success as boolean,
        error: event.payload.error as string | undefined,
        tokenUsage: rawTokenUsage as { input: number; output: number } | undefined,
      };
      const last = messages[messages.length - 1];
      if (last && last.role === 'agent') {
        messages = [...messages.slice(0, -1), { ...last, blocks: [...last.blocks, block] }];
      } else {
        const msg = newAgentMessage(event.id, ts, agentName);
        msg.blocks = [block];
        messages = [...messages, msg];
      }
      break;
    }

    case 'run.agent.task_started': {
      const tid = event.payload.taskId as string;
      if (currentRun) {
        currentRun = {
          ...currentRun,
          tasks: [
            ...currentRun.tasks,
            {
              taskId: tid,
              description: (event.payload.description as string) || '',
              status: 'running',
            },
          ],
        };
      }
      break;
    }

    case 'run.agent.task_progress': {
      const tid = event.payload.taskId as string;
      if (currentRun) {
        currentRun = {
          ...currentRun,
          tasks: currentRun.tasks.map((t) =>
            t.taskId === tid
              ? {
                  ...t,
                  description: (event.payload.description as string) || t.description,
                  status: 'running',
                }
              : t,
          ),
        };
      }
      break;
    }

    case 'run.agent.task_notification': {
      const tid = event.payload.taskId as string;
      if (currentRun) {
        currentRun = {
          ...currentRun,
          tasks: currentRun.tasks.map((t) =>
            t.taskId === tid
              ? {
                  ...t,
                  status: (event.payload.status as string) || 'completed',
                  summary: (event.payload.summary as string) || '',
                }
              : t,
          ),
        };
      }
      break;
    }

    case 'run.finished': {
      isStreaming = false;
      const rid = event.payload.runId as string;
      if (currentRun && currentRun.runId === rid) {
        currentRun = { ...currentRun, status: 'finished' };
      }
      break;
    }

    case 'run.failed': {
      isStreaming = false;
      const rid = event.payload.runId as string;
      if (currentRun && currentRun.runId === rid) {
        currentRun = { ...currentRun, status: 'failed' };
      }
      break;
    }

    case 'run.cancelled': {
      isStreaming = false;
      const rid = event.payload.runId as string;
      if (currentRun && currentRun.runId === rid) {
        currentRun = { ...currentRun, status: 'cancelled' };
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
      const existingIdx = state.permissionRequests.findIndex((r) => r.requestId === reqId);
      const item: PermissionRequestItem = {
        requestId: reqId,
        runId,
        toolName,
        toolInput,
        timestamp: ts,
      };
      let reqs: PermissionRequestItem[];
      if (existingIdx >= 0) {
        reqs = [...state.permissionRequests];
        reqs[existingIdx] = item;
      } else {
        reqs = [...state.permissionRequests, item];
      }
      return { ...state, permissionRequests: reqs.slice(-50) };
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

export function useChatMessages(online: boolean): ChatState {
  const [state, dispatch] = useReducer(reducer, initialState);
  const mountedRef = useRef(true);
  const streamRef = useRef<StreamHandle | null>(null);

  const clearMessages = useCallback(() => {
    dispatch({ type: 'CLEAR_MESSAGES' });
  }, []);

  const decidePermission = useCallback(
    (requestId: string, decision: 'allow' | 'deny', reason?: string) => {
      // Send decision to Edge via WebSocket
      const stream = streamRef.current;
      if (stream) {
        stream.send({
          type: 'run.agent.permission_decide',
          payload: { requestId, decision, reason },
        });
      }
      // Update local state
      dispatch({ type: 'RESOLVE_PERMISSION', requestId, decision, reason });
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    if (!online) {
      dispatch({ type: 'SET_CONNECTED', connected: false });
      return;
    }

    const stream = createEventStream();
    streamRef.current = stream;

    stream.onStatusChange((connected) => {
      if (!mountedRef.current) return;
      dispatch({ type: 'SET_CONNECTED', connected });
    });

    stream.subscribe((event: EventEnvelope) => {
      if (!mountedRef.current) return;
      dispatch({ type: 'EVENT_RECEIVED', event });
    });

    return () => {
      mountedRef.current = false;
      streamRef.current = null;
      stream.close();
    };
  }, [online]);

  return { ...state, clearMessages, decidePermission };
}
