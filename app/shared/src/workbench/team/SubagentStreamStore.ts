// Team subagent live-stream store (#1478 Phase C).
// Aggregates team.subagent.stream WS frames by agent_task_id with
// event_seq idempotent UPSERT semantics — the same as agent.stream
// but enriched with team-run context (team_run_id, assignment_id, etc.)
// for the team-run view.
//
// Phase C: state collection only, no rendering. Consumers subscribe
// to the store and render the event sequences when ready.
//
// Idempotency key: (agent_task_id, event_seq). Duplicate delivery of the
// same (agent_task_id, event_seq) is a no-op. New seq values append.
// Arrays are kept sorted by event_seq.

// ── Types ──────────────────────────────────────────────────────────────────

export interface TeamSubagentStreamEvent {
  team_run_id: string;
  team_id: string;
  session_id: string;
  assignment_id?: string;
  team_task_id?: string;
  member_id?: string;
  agent_task_id: string;
  agent_instance_id: string;
  edge_run_id?: string;
  event_seq: number;
  event_type: string;
  payload: unknown;
  created_at: string;
}

export interface SubagentStreamState {
  /** Events aggregated by agent_task_id, ordered by event_seq. */
  byTaskId: Record<string, TeamSubagentStreamEvent[]>;
}

export type SubagentStreamListener = (state: SubagentStreamState) => void;

export interface SubagentStreamStore {
  /** Current state snapshot (mutated in-place; copy for immutability). */
  readonly state: SubagentStreamState;
  /**
   * Feed a raw team.subagent.stream WS frame payload into the store.
   * UPSERT by (agent_task_id, event_seq): duplicate event_seq is a no-op,
   * new event_seq appends. Logs a warning on missing required fields.
   */
  push(payload: unknown): void;
  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: SubagentStreamListener): () => void;
  /** Clear all state (for testing). */
  reset(): void;
}

// ── Store factory ──────────────────────────────────────────────────────────

export function createSubagentStreamStore(): SubagentStreamStore {
  const state: SubagentStreamState = { byTaskId: {} };
  const listeners = new Set<SubagentStreamListener>();

  function notify(): void {
    for (const listener of listeners) {
      try {
        listener(state);
      } catch {
        // Isolate listener errors.
      }
    }
  }

  function push(payload: unknown): void {
    const data = payload as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object') return;

    const agentTaskId = (data.agent_task_id ?? data.agentTaskId) as string | undefined;
    if (typeof agentTaskId !== 'string' || !agentTaskId) {
      console.warn('[SubagentStreamStore] push: missing agent_task_id', payload);
      return;
    }

    const eventSeq =
      typeof data.event_seq === 'number'
        ? data.event_seq
        : typeof data.eventSeq === 'number'
          ? data.eventSeq
          : undefined;
    if (eventSeq == null) {
      console.warn('[SubagentStreamStore] push: missing event_seq', payload);
      return;
    }

    const event: TeamSubagentStreamEvent = {
      team_run_id: String(data.team_run_id ?? data.teamRunId ?? ''),
      team_id: String(data.team_id ?? data.teamId ?? ''),
      session_id: String(data.session_id ?? data.sessionId ?? ''),
      ...((data.assignment_id ?? data.assignmentId) !== undefined
        ? { assignment_id: String(data.assignment_id ?? data.assignmentId) }
        : {}),
      ...((data.team_task_id ?? data.teamTaskId) !== undefined
        ? { team_task_id: String(data.team_task_id ?? data.teamTaskId) }
        : {}),
      ...((data.member_id ?? data.memberId) !== undefined
        ? { member_id: String(data.member_id ?? data.memberId) }
        : {}),
      agent_task_id: agentTaskId,
      agent_instance_id: String(data.agent_instance_id ?? data.agentInstanceId ?? ''),
      ...((data.edge_run_id ?? data.edgeRunId) !== undefined
        ? { edge_run_id: String(data.edge_run_id ?? data.edgeRunId) }
        : {}),
      event_seq: eventSeq,
      event_type: String(data.event_type ?? data.eventType ?? ''),
      payload: data.payload,
      created_at: String(data.created_at ?? data.createdAt ?? ''),
    };

    let events = state.byTaskId[agentTaskId];
    if (!events) {
      events = [];
      state.byTaskId[agentTaskId] = events;
    }

    // UPSERT by event_seq: skip if already present.
    if (events.some((e) => e.event_seq === eventSeq)) return;

    events.push(event);
    // Keep sorted by event_seq (server sends in order, but be defensive).
    events.sort((a, b) => a.event_seq - b.event_seq);

    notify();
  }

  function subscribe(listener: SubagentStreamListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function reset(): void {
    state.byTaskId = {};
    notify();
  }

  return { state, push, subscribe, reset };
}

// ── Singleton ──────────────────────────────────────────────────────────────

let _instance: SubagentStreamStore | undefined;

/**
 * Global singleton subagent stream store.
 * Lazily created so the module can be imported without side effects
 * in environments that don't use it.
 */
export function getSubagentStreamStore(): SubagentStreamStore {
  if (!_instance) _instance = createSubagentStreamStore();
  return _instance;
}
