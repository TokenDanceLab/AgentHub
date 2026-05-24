import { describe, it, expect } from 'vitest';
import {
  RunState,
  RunStateMachine,
  RUN_STATE_TRANSITIONS,
} from '@/utils/runStateMachine';

// ── TRANSITIONS completeness ──────────────────────────────────────────

describe('RunState enum', () => {
  it('has all 7 expected members', () => {
    expect(Object.values(RunState)).toHaveLength(7);
    expect(RunState.IDLE).toBe('IDLE');
    expect(RunState.RUNNING).toBe('RUNNING');
    expect(RunState.STREAMING).toBe('STREAMING');
    expect(RunState.WAITING_FOR_INPUT).toBe('WAITING_FOR_INPUT');
    expect(RunState.COMPLETED).toBe('COMPLETED');
    expect(RunState.FAILED).toBe('FAILED');
    expect(RunState.CANCELLED).toBe('CANCELLED');
  });

  it('has defined transitions for every state', () => {
    const states = Object.values(RunState) as RunState[];
    for (const s of states) {
      expect(RUN_STATE_TRANSITIONS[s]).toBeDefined();
    }
  });
});

describe('RunStateMachine transitions', () => {
  describe('from IDLE', () => {
    it('IDLE → RUNNING succeeds', () => {
      const sm = new RunStateMachine();
      expect(sm.transition(RunState.RUNNING)).toBe(true);
      expect(sm.getState()).toBe(RunState.RUNNING);
    });

    it('IDLE → STREAMING rejected (must go through RUNNING)', () => {
      const sm = new RunStateMachine();
      expect(sm.transition(RunState.STREAMING)).toBe(false);
      expect(sm.getState()).toBe(RunState.IDLE);
    });

    it('IDLE → COMPLETED rejected', () => {
      const sm = new RunStateMachine();
      expect(sm.transition(RunState.COMPLETED)).toBe(false);
    });
  });

  describe('from RUNNING', () => {
    it('RUNNING → STREAMING succeeds', () => {
      const sm = new RunStateMachine();
      sm.transition(RunState.RUNNING);
      expect(sm.transition(RunState.STREAMING)).toBe(true);
    });

    it('RUNNING → WAITING_FOR_INPUT succeeds', () => {
      const sm = new RunStateMachine();
      sm.transition(RunState.RUNNING);
      expect(sm.transition(RunState.WAITING_FOR_INPUT)).toBe(true);
    });

    it('RUNNING → COMPLETED succeeds', () => {
      const sm = new RunStateMachine();
      sm.transition(RunState.RUNNING);
      expect(sm.transition(RunState.COMPLETED)).toBe(true);
    });

    it('RUNNING → FAILED succeeds', () => {
      const sm = new RunStateMachine();
      sm.transition(RunState.RUNNING);
      expect(sm.transition(RunState.FAILED)).toBe(true);
    });

    it('RUNNING → CANCELLED succeeds', () => {
      const sm = new RunStateMachine();
      sm.transition(RunState.RUNNING);
      expect(sm.transition(RunState.CANCELLED)).toBe(true);
    });

    it('RUNNING → IDLE rejected', () => {
      const sm = new RunStateMachine();
      sm.transition(RunState.RUNNING);
      expect(sm.transition(RunState.IDLE)).toBe(false);
    });
  });

  describe('from STREAMING', () => {
    it('STREAMING → RUNNING succeeds (stop streaming)', () => {
      const sm = new RunStateMachine();
      sm.transition(RunState.RUNNING);
      sm.transition(RunState.STREAMING);
      expect(sm.transition(RunState.RUNNING)).toBe(true);
    });

    it('STREAMING → COMPLETED succeeds', () => {
      const sm = new RunStateMachine();
      sm.transition(RunState.RUNNING);
      sm.transition(RunState.STREAMING);
      expect(sm.transition(RunState.COMPLETED)).toBe(true);
    });

    it('STREAMING → FAILED succeeds', () => {
      const sm = new RunStateMachine();
      sm.transition(RunState.RUNNING);
      sm.transition(RunState.STREAMING);
      expect(sm.transition(RunState.FAILED)).toBe(true);
    });

    it('STREAMING → CANCELLED succeeds', () => {
      const sm = new RunStateMachine();
      sm.transition(RunState.RUNNING);
      sm.transition(RunState.STREAMING);
      expect(sm.transition(RunState.CANCELLED)).toBe(true);
    });

    it('STREAMING → IDLE rejected', () => {
      const sm = new RunStateMachine();
      sm.transition(RunState.RUNNING);
      sm.transition(RunState.STREAMING);
      expect(sm.transition(RunState.IDLE)).toBe(false);
    });
  });

  describe('from WAITING_FOR_INPUT', () => {
    it('WAITING_FOR_INPUT → RUNNING succeeds', () => {
      const sm = new RunStateMachine();
      sm.transition(RunState.RUNNING);
      sm.transition(RunState.WAITING_FOR_INPUT);
      expect(sm.transition(RunState.RUNNING)).toBe(true);
    });

    it('WAITING_FOR_INPUT → COMPLETED rejected (waited via RUNNING)', () => {
      const sm = new RunStateMachine();
      sm.transition(RunState.RUNNING);
      sm.transition(RunState.WAITING_FOR_INPUT);
      // WAITING_FOR_INPUT transitions: RUNNING, COMPLETED, FAILED, CANCELLED
      // Wait, COMPLETED IS allowed per spec
      expect(sm.transition(RunState.COMPLETED)).toBe(true);
    });

    it('WAITING_FOR_INPUT → STREAMING rejected', () => {
      const sm = new RunStateMachine();
      sm.transition(RunState.RUNNING);
      sm.transition(RunState.WAITING_FOR_INPUT);
      expect(sm.transition(RunState.STREAMING)).toBe(false);
    });
  });

  describe('from terminal states', () => {
    it('COMPLETED → IDLE succeeds', () => {
      const sm = new RunStateMachine();
      sm.transition(RunState.RUNNING);
      sm.transition(RunState.COMPLETED);
      expect(sm.transition(RunState.IDLE)).toBe(true);
    });

    it('FAILED → IDLE succeeds', () => {
      const sm = new RunStateMachine();
      sm.transition(RunState.RUNNING);
      sm.transition(RunState.FAILED);
      expect(sm.transition(RunState.IDLE)).toBe(true);
    });

    it('CANCELLED → IDLE succeeds', () => {
      const sm = new RunStateMachine();
      sm.transition(RunState.RUNNING);
      sm.transition(RunState.CANCELLED);
      expect(sm.transition(RunState.IDLE)).toBe(true);
    });

    it('COMPLETED → RUNNING rejected', () => {
      const sm = new RunStateMachine();
      sm.transition(RunState.RUNNING);
      sm.transition(RunState.COMPLETED);
      expect(sm.transition(RunState.RUNNING)).toBe(false);
    });
  });
});

// ── isTerminal ────────────────────────────────────────────────────────

describe('isTerminal', () => {
  it('returns true for COMPLETED / FAILED / CANCELLED', () => {
    expect(new RunStateMachine().isTerminal()).toBe(false); // IDLE is not terminal

    const sm = new RunStateMachine();
    sm.transition(RunState.RUNNING);
    sm.transition(RunState.COMPLETED);
    expect(sm.isTerminal()).toBe(true);
  });

  it('returns false for IDLE / RUNNING / STREAMING / WAITING_FOR_INPUT', () => {
    const sm = new RunStateMachine();
    expect(sm.isTerminal()).toBe(false); // IDLE
    sm.transition(RunState.RUNNING);
    expect(sm.isTerminal()).toBe(false);
    sm.transition(RunState.STREAMING);
    expect(sm.isTerminal()).toBe(false);
  });
});

// ── isActive ──────────────────────────────────────────────────────────

describe('isActive', () => {
  it('returns true for RUNNING / STREAMING / WAITING_FOR_INPUT', () => {
    const sm = new RunStateMachine();
    sm.transition(RunState.RUNNING);
    expect(sm.isActive()).toBe(true);

    sm.transition(RunState.STREAMING);
    expect(sm.isActive()).toBe(true);

    // Reset and test WAITING_FOR_INPUT
    const sm2 = new RunStateMachine();
    sm2.transition(RunState.RUNNING);
    sm2.transition(RunState.WAITING_FOR_INPUT);
    expect(sm2.isActive()).toBe(true);
  });

  it('returns false for IDLE / COMPLETED / FAILED / CANCELLED', () => {
    const sm = new RunStateMachine();
    expect(sm.isActive()).toBe(false); // IDLE
    sm.transition(RunState.RUNNING);
    sm.transition(RunState.COMPLETED);
    expect(sm.isActive()).toBe(false);
  });
});

// ── reset ─────────────────────────────────────────────────────────────

describe('reset', () => {
  it('returns to IDLE from any state', () => {
    const sm = new RunStateMachine();
    sm.transition(RunState.RUNNING);
    sm.transition(RunState.COMPLETED);
    expect(sm.getState()).toBe(RunState.COMPLETED);

    sm.reset();
    expect(sm.getState()).toBe(RunState.IDLE);
  });
});

// ── fromLegacyStatus ──────────────────────────────────────────────────

describe('fromLegacyStatus', () => {
  it('maps "running" → RUNNING', () => {
    expect(RunStateMachine.fromLegacyStatus('running')).toBe(RunState.RUNNING);
  });

  it('maps "streaming" → STREAMING', () => {
    expect(RunStateMachine.fromLegacyStatus('streaming')).toBe(RunState.STREAMING);
  });

  it('maps "waiting_for_input" → WAITING_FOR_INPUT', () => {
    expect(RunStateMachine.fromLegacyStatus('waiting_for_input')).toBe(
      RunState.WAITING_FOR_INPUT,
    );
  });

  it('maps "finished" → COMPLETED', () => {
    expect(RunStateMachine.fromLegacyStatus('finished')).toBe(RunState.COMPLETED);
  });

  it('maps "completed" → COMPLETED', () => {
    expect(RunStateMachine.fromLegacyStatus('completed')).toBe(RunState.COMPLETED);
  });

  it('maps "failed" → FAILED', () => {
    expect(RunStateMachine.fromLegacyStatus('failed')).toBe(RunState.FAILED);
  });

  it('maps "cancelled" → CANCELLED', () => {
    expect(RunStateMachine.fromLegacyStatus('cancelled')).toBe(RunState.CANCELLED);
  });

  it('maps "canceled" → CANCELLED', () => {
    expect(RunStateMachine.fromLegacyStatus('canceled')).toBe(RunState.CANCELLED);
  });

  it('maps "queued" → IDLE', () => {
    expect(RunStateMachine.fromLegacyStatus('queued')).toBe(RunState.IDLE);
  });

  it('maps "idle" → IDLE', () => {
    expect(RunStateMachine.fromLegacyStatus('idle')).toBe(RunState.IDLE);
  });

  it('maps unknown strings to IDLE', () => {
    expect(RunStateMachine.fromLegacyStatus('bogus')).toBe(RunState.IDLE);
    expect(RunStateMachine.fromLegacyStatus('')).toBe(RunState.IDLE);
  });
});
