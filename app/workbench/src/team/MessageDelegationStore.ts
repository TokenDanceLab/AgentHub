// MessageDelegationStore — #1406 Phase 3
// Inline delegation state for the message timeline.
//
// Consumes EXISTING agent.* WS frames (agent.dispatch / agent.stream /
// agent.done / agent.failed / agent.cancel) — NO protocol change, no new
// REST. The agent.dispatch frame (HubAgentDispatchPayload) carries both
// task_id and trigger_message_id, which is the message→task association
// link the inline card needs.
//
// Indexes delegation entries by trigger_message_id so a card mounted below
// a user message can subscribe via messageId. Also indexes by taskId so
// terminal/stream frames can update an existing entry without the message
// id (agent.stream/agent.done/agent.failed carry task_id but not
// trigger_message_id).
//
// Churn control: agent.stream fires per token. We only transition into
// 'streaming' once (dispatching → streaming) and no-op on subsequent
// tokens, so the store does not notify per token.

import { HUB_EVENTS, type HubEventType } from '@shared/hubEvents';

// ── Types ──────────────────────────────────────────────────────────────────

export type DelegationStatus =
  | 'dispatching'
  | 'streaming'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface DelegationEntry {
  /** agent_task_id from agent.dispatch frame. */
  taskId: string;
  /** message_id that triggered the dispatch — links back to the user message. */
  triggerMessageId: string;
  /** session_id (conversation id) from the frame. */
  sessionId?: string;
  /** agent_instance_id from agent.dispatch. */
  agentInstanceId?: string;
  /** display_name from agent.dispatch; falls back to taskId short code. */
  displayName: string;
  /** Derived lifecycle status. */
  status: DelegationStatus;
  /** ISO timestamp of the last update. */
  updatedAt: string;
}

export interface MessageDelegationState {
  /** Entries grouped by trigger_message_id for per-message subscription. */
  byMessageId: Record<string, DelegationEntry[]>;
  /** Reverse index for status updates that only carry task_id. */
  byTaskId: Record<string, DelegationEntry>;
}

export type MessageDelegationListener = (state: MessageDelegationState) => void;

export interface MessageDelegationStore {
  /** Current state snapshot (mutated in-place; copy for immutability). */
  readonly state: MessageDelegationState;
  /**
   * Feed a raw Hub WS agent.* event into the store. Ignores non-agent events
   * and frames missing the required task_id / trigger_message_id. Consumes
   * the SAME frames the realtime hook already receives — no wire change.
   */
  handleEvent(eventType: HubEventType | string, payload: unknown): void;
  /** Direct upsert — used by tests and future non-WS feeds. */
  upsert(entry: DelegationEntry): void;
  /** Entries for a given message id, sorted by updatedAt asc. Empty if none. */
  getEntriesByMessage(messageId: string): DelegationEntry[];
  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: MessageDelegationListener): () => void;
  /** Remove all entries and notify listeners. For testing. */
  reset(): void;
}

// ── Store factory ──────────────────────────────────────────────────────────

export function createMessageDelegationStore(): MessageDelegationStore {
  const state: MessageDelegationState = { byMessageId: {}, byTaskId: {} };
  const listeners = new Set<MessageDelegationListener>();

  function notify(): void {
    for (const listener of listeners) {
      try {
        listener(state);
      } catch {
        // Isolate listener errors — never break the realtime path.
      }
    }
  }

  function upsert(entry: DelegationEntry): void {
    const existing = state.byTaskId[entry.taskId];
    // Preserve the trigger_message_id link if the new entry lacks one
    // (terminal/stream frames only carry task_id).
    const triggerMessageId = entry.triggerMessageId || existing?.triggerMessageId || '';
    if (!triggerMessageId) {
      // Without a message link we cannot attach the card — skip silently.
      return;
    }
    const sessionId = entry.sessionId ?? existing?.sessionId;
    const agentInstanceId = entry.agentInstanceId ?? existing?.agentInstanceId;
    const merged: DelegationEntry = {
      taskId: entry.taskId,
      triggerMessageId,
      ...(sessionId ? { sessionId } : {}),
      ...(agentInstanceId ? { agentInstanceId } : {}),
      displayName: entry.displayName || existing?.displayName || taskShortCode(entry.taskId),
      status: entry.status,
      updatedAt: entry.updatedAt,
    };
    state.byTaskId[entry.taskId] = merged;

    const list = state.byMessageId[triggerMessageId] ?? [];
    const filtered = list.filter((e) => e.taskId !== entry.taskId);
    filtered.push(merged);
    // Sort by updatedAt then taskId for stable ordering.
    filtered.sort((a, b) =>
      a.updatedAt.localeCompare(b.updatedAt) || a.taskId.localeCompare(b.taskId),
    );
    // Replace top-level index objects with NEW references so
    // useSyncExternalStore (which compares getSnapshot() via Object.is)
    // detects the change. Mutating in place would leave
    // `byMessageId === prevSnapshot` and React would skip the re-render,
    // breaking live status transitions (#1406 Phase 3 live-update fix).
    state.byTaskId = { ...state.byTaskId, [entry.taskId]: merged };
    state.byMessageId = { ...state.byMessageId, [triggerMessageId]: filtered };

    notify();
  }

  function handleEvent(eventType: HubEventType | string, payload: unknown): void {
    const data = payload as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object') return;

    const taskId = readStr(data, 'task_id', 'taskId');
    if (!taskId) return;

    switch (eventType) {
      case HUB_EVENTS.AGENT_DISPATCH: {
        const triggerMessageId = readStr(data, 'trigger_message_id', 'triggerMessageId');
        if (!triggerMessageId) return; // no message link → cannot inline
        const displayName = readStr(data, 'display_name', 'displayName', 'agent_name', 'agentName') ?? '';
        const sessionId = readStr(data, 'session_id', 'sessionId');
        const agentInstanceId = readStr(data, 'agent_instance_id', 'agentInstanceId');
        const createdAt = readStr(data, 'created_at', 'createdAt');
        upsert({
          taskId,
          triggerMessageId,
          ...(sessionId ? { sessionId } : {}),
          ...(agentInstanceId ? { agentInstanceId } : {}),
          displayName,
          status: 'dispatching',
          updatedAt: createdAt ?? new Date().toISOString(),
        });
        return;
      }
      case HUB_EVENTS.AGENT_STREAM: {
        const existing = state.byTaskId[taskId];
        if (!existing) return; // never saw a dispatch frame — nothing to attach to
        if (existing.status === 'streaming') return; // already streaming — no per-token churn
        const createdAt = readStr(data, 'created_at', 'createdAt');
        upsert({
          ...existing,
          status: 'streaming',
          updatedAt: createdAt ?? new Date().toISOString(),
        });
        return;
      }
      case HUB_EVENTS.AGENT_DONE: {
        const existing = state.byTaskId[taskId];
        if (!existing) return;
        const createdAt = readStr(data, 'created_at', 'createdAt');
        upsert({
          ...existing,
          status: 'done',
          updatedAt: createdAt ?? new Date().toISOString(),
        });
        return;
      }
      case HUB_EVENTS.AGENT_FAILED: {
        const existing = state.byTaskId[taskId];
        if (!existing) return;
        const createdAt = readStr(data, 'created_at', 'createdAt');
        upsert({
          ...existing,
          status: 'failed',
          updatedAt: createdAt ?? new Date().toISOString(),
        });
        return;
      }
      case HUB_EVENTS.AGENT_CANCEL: {
        const existing = state.byTaskId[taskId];
        if (!existing) return;
        const createdAt = readStr(data, 'created_at', 'createdAt');
        upsert({
          ...existing,
          status: 'cancelled',
          updatedAt: createdAt ?? new Date().toISOString(),
        });
        return;
      }
      default:
        return;
    }
  }

  function getEntriesByMessage(messageId: string): DelegationEntry[] {
    return state.byMessageId[messageId] ?? [];
  }

  function subscribe(listener: MessageDelegationListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function reset(): void {
    state.byMessageId = {};
    state.byTaskId = {};
    notify();
  }

  return { state, handleEvent, upsert, getEntriesByMessage, subscribe, reset };
}

// ── Singleton ──────────────────────────────────────────────────────────────

let _instance: MessageDelegationStore | undefined;

/**
 * Global singleton message-delegation store. Lazily created so the module
 * can be imported without side effects in environments that don't use it.
 */
export function getMessageDelegationStore(): MessageDelegationStore {
  if (!_instance) _instance = createMessageDelegationStore();
  return _instance;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function taskShortCode(taskId: string): string {
  const parts = taskId.split(/[-_]/);
  if (parts.length >= 2) {
    const suffix = parts[parts.length - 1]!;
    return suffix.length <= 8 ? `#${suffix}` : `#${suffix.slice(0, 6)}`;
  }
  return `#${taskId.slice(0, 6)}`;
}

function readStr(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}
