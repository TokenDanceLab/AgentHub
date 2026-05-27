// RunState state machine — formal state model for AgentHub run lifecycle.
// Reference: Roo-Code AgentLoopState, Kanna dual-Map pattern (already used in runStore.ts).
//
// States:  IDLE → RUNNING ↔ STREAMING → WAITING_FOR_INPUT / COMPLETED / FAILED / CANCELLED
//
// Only validated transitions are accepted. Invalid jumps are rejected and logged as
// warnings so Edge event ordering bugs can't corrupt local state.

export enum RunState {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  STREAMING = 'STREAMING',
  WAITING_FOR_INPUT = 'WAITING_FOR_INPUT',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/** Valid outbound transitions for each state. */
const TRANSITIONS: Record<RunState, readonly RunState[]> = {
  [RunState.IDLE]: [RunState.RUNNING],
  [RunState.RUNNING]: [
    RunState.STREAMING,
    RunState.WAITING_FOR_INPUT,
    RunState.COMPLETED,
    RunState.FAILED,
    RunState.CANCELLED,
  ],
  [RunState.STREAMING]: [
    RunState.RUNNING,
    RunState.WAITING_FOR_INPUT,
    RunState.COMPLETED,
    RunState.FAILED,
    RunState.CANCELLED,
  ],
  [RunState.WAITING_FOR_INPUT]: [
    RunState.RUNNING,
    RunState.COMPLETED,
    RunState.FAILED,
    RunState.CANCELLED,
  ],
  [RunState.COMPLETED]: [RunState.IDLE],
  [RunState.FAILED]: [RunState.IDLE],
  [RunState.CANCELLED]: [RunState.IDLE],
};

const TERMINAL_STATES = new Set<RunState>([
  RunState.COMPLETED,
  RunState.FAILED,
  RunState.CANCELLED,
]);

const ACTIVE_STATES = new Set<RunState>([
  RunState.RUNNING,
  RunState.STREAMING,
  RunState.WAITING_FOR_INPUT,
]);

/**
 * Map legacy string statuses (from Edge events or older API shapes) to a formal
 * RunState. Unknown strings map to IDLE to avoid poisoning the state machine.
 */
const LEGACY_MAP: Record<string, RunState> = {
  // Legacy lowercase strings (Edge events / older API shapes)
  running: RunState.RUNNING,
  streaming: RunState.STREAMING,
  waiting_for_input: RunState.WAITING_FOR_INPUT,
  finished: RunState.COMPLETED,
  completed: RunState.COMPLETED,
  failed: RunState.FAILED,
  cancelled: RunState.CANCELLED,
  canceled: RunState.CANCELLED,
  queued: RunState.IDLE,
  idle: RunState.IDLE,
  // RunState enum identity mappings (direct use)
  [RunState.RUNNING]: RunState.RUNNING,
  [RunState.STREAMING]: RunState.STREAMING,
  [RunState.WAITING_FOR_INPUT]: RunState.WAITING_FOR_INPUT,
  [RunState.COMPLETED]: RunState.COMPLETED,
  [RunState.FAILED]: RunState.FAILED,
  [RunState.CANCELLED]: RunState.CANCELLED,
  [RunState.IDLE]: RunState.IDLE,
};

export class RunStateMachine {
  private _state: RunState = RunState.IDLE;

  /** Attempt a transition. Returns true if the transition is valid. */
  transition(to: RunState): boolean {
    if (to === this._state) {
      return true;
    }
    const valid = TRANSITIONS[this._state];
    if (valid?.includes(to)) {
      this._state = to;
      return true;
    }
    console.warn(`[RunStateMachine] Invalid transition: ${this._state} → ${to}`);
    return false;
  }

  getState(): RunState {
    return this._state;
  }

  isTerminal(): boolean {
    return TERMINAL_STATES.has(this._state);
  }

  isActive(): boolean {
    return ACTIVE_STATES.has(this._state);
  }

  reset(): void {
    this._state = RunState.IDLE;
  }

  /** Map a legacy string status to a RunState. Unknown values → IDLE. */
  static fromLegacyStatus(status: string): RunState {
    return LEGACY_MAP[status] ?? RunState.IDLE;
  }
}

/** Public read-only transition map (for introspection / tests). */
export const RUN_STATE_TRANSITIONS: Readonly<typeof TRANSITIONS> = TRANSITIONS;
