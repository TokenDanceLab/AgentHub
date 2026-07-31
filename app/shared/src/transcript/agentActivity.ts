// Agent activity tracker for the streaming status bar.
// Tracks agent dispatch/stream/done/failed/cancel events and exposes
// a reactive store that consumers (Web / Desktop workbench models) can
// subscribe to for "N agents thinking" UI state.

import { HUB_EVENTS, type HubEventType } from '../hubEvents';

// ── Public types ──────────────────────────────────────────────────────────

export type AgentActivityStatus = 'dispatching' | 'thinking' | 'streaming' | 'done' | 'failed';

export interface AgentActivityEntry {
  agentId: string;
  agentName: string;
  status: AgentActivityStatus;
  startedAt: number;
  toolCalls: number;
}

export interface AgentActivityState {
  activeAgents: Map<string, AgentActivityEntry>;
}

export interface AgentActivitySnapshot {
  activeAgents: Array<{
    id: string;
    name: string;
    status: AgentActivityStatus;
    /** Total tool calls observed for this agent while tracked. */
    toolCalls: number;
  }>;
}

// ── Auto-remove delays ───────────────────────────────────────────────────

const DONE_REMOVE_MS = 3_000;
const FAILED_REMOVE_MS = 5_000;

// ── Store ─────────────────────────────────────────────────────────────────

export type AgentActivityListener = (state: AgentActivityState) => void;

export interface AgentActivityStore {
  /** Current state snapshot (mutated in-place, copy if you need immutability). */
  readonly state: AgentActivityState;
  /** Feed a raw Hub WS event into the store. Ignores non-agent events. */
  handleEvent(eventType: HubEventType | string, payload: unknown): void;
  /**
   * Directly push an agent status update into the store.
   * Used by Edge SSE event consumers that don't go through Hub WS events.
   * `toolCalls` is a delta: the value is accumulated into the tracked entry
   * (Edge emits one `run.agent.tool_call` event per call with `toolCalls = 1`).
   */
  pushAgentStatus(agentId: string, agentName: string, status: AgentActivityStatus, toolCalls?: number): void;
  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: AgentActivityListener): () => void;
  /** Convenience: get a serialisable snapshot (no Map). */
  getSnapshot(): AgentActivitySnapshot;
  /** Remove all entries and notify listeners. */
  reset(): void;
}

export function createAgentActivityStore(): AgentActivityStore {
  const state: AgentActivityState = { activeAgents: new Map() };
  const listeners = new Set<AgentActivityListener>();
  const removalTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let cachedSnapshot: AgentActivitySnapshot = { activeAgents: [] };

  function invalidateSnapshot(): void {
    cachedSnapshot = { activeAgents: [] };
  }

  function notify(): void {
    invalidateSnapshot();
    for (const listener of listeners) {
      listener(state);
    }
  }

  function scheduleRemoval(key: string, delayMs: number): void {
    // Clear any existing removal timer for this key.
    const existing = removalTimers.get(key);
    if (existing !== undefined) clearTimeout(existing);

    removalTimers.set(key, setTimeout(() => {
      state.activeAgents.delete(key);
      removalTimers.delete(key);
      notify();
    }, delayMs));
  }

  function pushAgentStatus(
    agentId: string,
    agentName: string,
    status: AgentActivityStatus,
    toolCalls?: number,
  ): void {
    // Clear any pending removal timer.
    const existing = removalTimers.get(agentId);
    if (existing !== undefined) {
      clearTimeout(existing);
      removalTimers.delete(agentId);
    }

    const current = state.activeAgents.get(agentId);
    state.activeAgents.set(agentId, {
      agentId,
      agentName: current?.agentName ?? agentName,
      status,
      startedAt: current?.startedAt ?? Date.now(),
      // `toolCalls` is a per-event delta (Edge pushes 1 per `run.agent.tool_call`);
      // accumulate so the count reflects the real number of tool calls.
      toolCalls: (current?.toolCalls ?? 0) + (toolCalls ?? 0),
    });
    notify();

    if (status === 'done') {
      scheduleRemoval(agentId, DONE_REMOVE_MS);
    } else if (status === 'failed') {
      scheduleRemoval(agentId, FAILED_REMOVE_MS);
    }
  }

  function handleEvent(eventType: HubEventType | string, payload: unknown): void {
    const data = payload as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object') return;

    const agentId = readStr(data, 'agent_id', 'agentId', 'task_id', 'taskId');
    if (!agentId) return;

    const agentName = readStr(data, 'agent_name', 'agentName', 'agent_label', 'agentLabel') ?? 'Agent';
    const toolCalls = readNum(data, 'tool_calls', 'toolCalls') ?? 0;

    switch (eventType) {
      case HUB_EVENTS.AGENT_DISPATCH: {
        // Clear any pending removal timer.
        const existing = removalTimers.get(agentId);
        if (existing !== undefined) {
          clearTimeout(existing);
          removalTimers.delete(agentId);
        }
        state.activeAgents.set(agentId, {
          agentId,
          agentName,
          status: 'dispatching',
          startedAt: Date.now(),
          toolCalls,
        });
        notify();
        break;
      }

      case HUB_EVENTS.AGENT_STREAM: {
        const current = state.activeAgents.get(agentId);
        // Clear any pending removal timer (agent might have been "done" and is now streaming again).
        const existing = removalTimers.get(agentId);
        if (existing !== undefined) {
          clearTimeout(existing);
          removalTimers.delete(agentId);
        }
        state.activeAgents.set(agentId, {
          agentId,
          agentName: current?.agentName ?? agentName,
          status: 'streaming',
          startedAt: current?.startedAt ?? Date.now(),
          toolCalls: Math.max(current?.toolCalls ?? 0, toolCalls),
        });
        notify();
        break;
      }

      case HUB_EVENTS.AGENT_DONE: {
        const current = state.activeAgents.get(agentId);
        if (current) {
          current.status = 'done';
          notify();
        }
        scheduleRemoval(agentId, DONE_REMOVE_MS);
        break;
      }

      case HUB_EVENTS.AGENT_FAILED: {
        const current = state.activeAgents.get(agentId);
        if (current) {
          current.status = 'failed';
          notify();
        }
        scheduleRemoval(agentId, FAILED_REMOVE_MS);
        break;
      }

      case HUB_EVENTS.AGENT_CANCEL: {
        // Immediate removal.
        const existing = removalTimers.get(agentId);
        if (existing !== undefined) {
          clearTimeout(existing);
          removalTimers.delete(agentId);
        }
        state.activeAgents.delete(agentId);
        notify();
        break;
      }

      default:
        // Not an agent lifecycle event — ignore.
        break;
    }
  }

  function subscribe(listener: AgentActivityListener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  function getSnapshot(): AgentActivitySnapshot {
    if (cachedSnapshot.activeAgents.length > 0 || state.activeAgents.size === 0) {
      return cachedSnapshot;
    }
    const activeAgents: AgentActivitySnapshot['activeAgents'] = [];
    for (const entry of state.activeAgents.values()) {
      activeAgents.push({
        id: entry.agentId,
        name: entry.agentName,
        status: entry.status,
        toolCalls: entry.toolCalls,
      });
    }
    cachedSnapshot = { activeAgents };
    return cachedSnapshot;
  }

  function reset(): void {
    for (const timer of removalTimers.values()) clearTimeout(timer);
    removalTimers.clear();
    state.activeAgents.clear();
    notify();
  }

  return { state, handleEvent, pushAgentStatus, subscribe, getSnapshot, reset };
}

// ── Singleton ─────────────────────────────────────────────────────────────

let _instance: AgentActivityStore | undefined;

/**
 * Global singleton agent activity store.
 * Lazily created so the module can be imported without side effects
 * in environments that don't use it.
 */
export function getAgentActivityStore(): AgentActivityStore {
  if (!_instance) _instance = createAgentActivityStore();
  return _instance;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function readStr(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function readNum(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}
