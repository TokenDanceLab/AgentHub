// Builds ChatMessage objects from WebSocket agent events.

import { useReducer, useEffect, useRef, useCallback } from 'react';
import { createEventStream } from '@/api/eventClient';
import type { EventEnvelope } from '@shared/events';
import type { ChatMessage, MessageBlock, ToolResultBlock } from '@/components/ChatView.types';

const MAX_MESSAGES = 500;
const MAX_OUTPUT_TEXT = 20000;

interface RunState {
  runId: string;
  status: string;
  outputText: string;
  toolCalls: Array<{ callId: string; toolName: string; status: string; timestamp: string }>;
  changedFiles: Array<{ path: string; action: string; timestamp: string }>;
}

interface State {
  messages: ChatMessage[];
  isConnected: boolean;
  isStreaming: boolean;
  currentRun: RunState | null;
}

type Action =
  | { type: 'EVENT_RECEIVED'; event: EventEnvelope }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'SET_CONNECTED'; connected: boolean };

export interface ChatState extends State {
  clearMessages: () => void;
}

function mergeBlock(blocks: MessageBlock[], block: MessageBlock): MessageBlock[] {
  // For streaming text: merge into the last text block if it exists
  if (block.kind === 'text') {
    const last = blocks[blocks.length - 1];
    if (last && last.kind === 'text') {
      return [
        ...blocks.slice(0, -1),
        { kind: 'text', content: last.content + block.content },
      ];
    }
  }
  // For thinking: merge into the last thinking block
  if (block.kind === 'thinking') {
    const last = blocks[blocks.length - 1];
    if (last && last.kind === 'thinking') {
      return [
        ...blocks.slice(0, -1),
        { kind: 'thinking', content: last.content + block.content },
      ];
    }
  }
  return [...blocks, block];
}

function newAgentMessage(id: string, timestamp: string): ChatMessage {
  return { id, role: 'agent', timestamp, blocks: [] };
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

function processEvent(state: State, event: EventEnvelope): State {
  const ts = event.sentAt;
  let { messages } = state;
  let { currentRun } = state;
  let { isStreaming } = state;

  switch (event.type) {
    case 'run.started': {
      const rid = event.payload.runId as string;
      currentRun = { runId: rid, status: 'running', outputText: '', toolCalls: [], changedFiles: [] };
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
      break;
    }

    case 'run.agent.text_delta': {
      const block: MessageBlock = {
        kind: 'text',
        content: event.payload.content as string,
      };
      const last = messages[messages.length - 1];
      if (last && last.role === 'agent') {
        messages = [...messages.slice(0, -1), { ...last, blocks: mergeBlock(last.blocks, block) }];
      } else {
        const msg = newAgentMessage(event.id, ts);
        msg.blocks = [block];
        messages = [...messages, msg];
      }
      break;
    }

    case 'run.agent.text_block': {
      const block: MessageBlock = {
        kind: (event.payload.contentType as MessageBlock['kind']) === 'code'
          ? 'code'
          : 'text',
        content: event.payload.content as string,
        language: event.payload.language as string | undefined,
      };
      const last = messages[messages.length - 1];
      if (last && last.role === 'agent') {
        messages = [...messages.slice(0, -1), { ...last, blocks: [...last.blocks, block] }];
      } else {
        const msg = newAgentMessage(event.id, ts);
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
        const msg = newAgentMessage(event.id, ts);
        msg.blocks = [block];
        messages = [...messages, msg];
      }
      break;
    }

    case 'run.agent.tool_call': {
      const callId = event.payload.callId as string;
      const toolName = event.payload.toolName as string;
      const input = event.payload.input as Record<string, unknown>;
      const status = (event.payload.status ?? 'running') as 'pending' | 'running' | 'completed' | 'failed';
      const block: MessageBlock = { kind: 'tool_use', callId, toolName, input, status, children: [] };
      const runId = event.payload.runId as string;
      if (runId && currentRun && currentRun.runId === runId) {
        currentRun = {
          ...currentRun,
          toolCalls: [
            ...currentRun.toolCalls,
            { callId, toolName, status, timestamp: ts },
          ],
        };
      }
      const last = messages[messages.length - 1];
      if (last && last.role === 'agent') {
        messages = [...messages.slice(0, -1), { ...last, blocks: [...last.blocks, block] }];
      } else {
        const msg = newAgentMessage(event.id, ts);
        msg.blocks = [block];
        messages = [...messages, msg];
      }
      break;
    }

    case 'run.agent.tool_result': {
      const callId = event.payload.callId as string;
      const resultBlock: ToolResultBlock = {
        kind: 'generic_result',
        output: typeof event.payload.output === 'string'
          ? event.payload.output
          : JSON.stringify(event.payload.output),
      };
      if (currentRun) {
        currentRun = {
          ...currentRun,
          toolCalls: currentRun.toolCalls.map((tc) =>
            tc.callId === callId ? { ...tc, status: 'completed' } : tc,
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
      const block: MessageBlock = {
        kind: 'file_change',
        path: event.payload.path as string,
        action: event.payload.action as 'created' | 'modified' | 'deleted',
        diff: event.payload.diff as string | undefined,
      };
      const runId = event.payload.runId as string;
      if (runId && currentRun && currentRun.runId === runId) {
        currentRun = {
          ...currentRun,
          changedFiles: [...currentRun.changedFiles, { path: block.path, action: block.action, timestamp: ts }],
        };
      }
      const last = messages[messages.length - 1];
      if (last && last.role === 'agent') {
        messages = [...messages.slice(0, -1), { ...last, blocks: [...last.blocks, block] }];
      } else {
        const msg = newAgentMessage(event.id, ts);
        msg.blocks = [block];
        messages = [...messages, msg];
      }
      break;
    }

    case 'run.agent.result': {
      const block: MessageBlock = {
        kind: 'result',
        success: event.payload.success as boolean,
        error: event.payload.error as string | undefined,
        tokenUsage: event.payload.tokenUsage as { input: number; output: number } | undefined,
      };
      const last = messages[messages.length - 1];
      if (last && last.role === 'agent') {
        messages = [...messages.slice(0, -1), { ...last, blocks: [...last.blocks, block] }];
      } else {
        const msg = newAgentMessage(event.id, ts);
        msg.blocks = [block];
        messages = [...messages, msg];
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

    default:
      break;
  }

  messages = capMessages(messages);

  return { ...state, messages, isStreaming, currentRun };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'EVENT_RECEIVED':
      return processEvent(state, action.event);
    case 'CLEAR_MESSAGES':
      return { messages: [], isConnected: state.isConnected, isStreaming: false, currentRun: null };
    case 'SET_CONNECTED':
      return { ...state, isConnected: action.connected };
    default:
      return state;
  }
}

const initialState: State = {
  messages: [],
  isConnected: false,
  isStreaming: false,
  currentRun: null,
};

export function useChatMessages(online: boolean): ChatState {
  const [state, dispatch] = useReducer(reducer, initialState);
  const mountedRef = useRef(true);

  const clearMessages = useCallback(() => {
    dispatch({ type: 'CLEAR_MESSAGES' });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!online) {
      dispatch({ type: 'SET_CONNECTED', connected: false });
      return;
    }

    const stream = createEventStream();

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
      stream.close();
    };
  }, [online]);

  return { ...state, clearMessages };
}
