package process

import (
	"sync"
	"testing"
)

func TestValidTransitions(t *testing.T) {
	tests := []struct {
		name  string
		setup []State // valid transitions to reach the starting state
		to    State
		want  bool
	}{
		// Valid transitions
		{name: "idle to running", setup: nil, to: StateRunning, want: true},
		{name: "running to finished", setup: []State{StateRunning}, to: StateFinished, want: true},
		{name: "running to stopping", setup: []State{StateRunning}, to: StateStopping, want: true},
		{name: "stopping to stopped", setup: []State{StateRunning, StateStopping}, to: StateStopped, want: true},

		// Invalid transitions
		{name: "idle to stopping", setup: nil, to: StateStopping, want: false},
		{name: "idle to stopped", setup: nil, to: StateStopped, want: false},
		{name: "idle to finished", setup: nil, to: StateFinished, want: false},
		{name: "finished to running", setup: []State{StateRunning, StateFinished}, to: StateRunning, want: false},
		{name: "finished to stopping", setup: []State{StateRunning, StateFinished}, to: StateStopping, want: false},
		{name: "stopped to running", setup: []State{StateRunning, StateStopping, StateStopped}, to: StateRunning, want: false},
		{name: "stopped to stopping", setup: []State{StateRunning, StateStopping, StateStopped}, to: StateStopping, want: false},
		{name: "running to idle", setup: []State{StateRunning}, to: StateIdle, want: false},
		{name: "stopping to running", setup: []State{StateRunning, StateStopping}, to: StateRunning, want: false},
		{name: "stopping to finished", setup: []State{StateRunning, StateStopping}, to: StateFinished, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sm := NewStateMachine()
			for _, s := range tt.setup {
				if err := sm.Transition(s); err != nil {
					t.Fatalf("setup transition %s -> %s failed: %v", sm.Current(), s, err)
				}
			}

			err := sm.Transition(tt.to)
			if tt.want && err != nil {
				t.Errorf("expected transition to %s to succeed, got error: %v", tt.to, err)
			}
			if !tt.want && err == nil {
				t.Errorf("expected transition to %s to fail, got nil error", tt.to)
			}

			if tt.want && sm.Current() != tt.to {
				t.Errorf("expected current state %s, got %s", tt.to, sm.Current())
			}
		})
	}
}

func TestNewStateMachineStartsIdle(t *testing.T) {
	sm := NewStateMachine()
	if sm.Current() != StateIdle {
		t.Errorf("expected new state machine to be idle, got %s", sm.Current())
	}
}

func TestConcurrentReadAccess(t *testing.T) {
	sm := NewStateMachine()
	if err := sm.Transition(StateRunning); err != nil {
		t.Fatalf("setup failed: %v", err)
	}

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = sm.Current()
		}()
	}
	wg.Wait()

	if sm.Current() != StateRunning {
		t.Errorf("expected state running after concurrent reads, got %s", sm.Current())
	}
}

func TestConcurrentTransitionSafety(t *testing.T) {
	sm := NewStateMachine()
	if err := sm.Transition(StateRunning); err != nil {
		t.Fatalf("setup failed: %v", err)
	}

	var wg sync.WaitGroup
	results := make(chan error, 100)

	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- sm.Transition(StateFinished)
		}()
	}
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- sm.Transition(StateStopping)
		}()
	}
	wg.Wait()
	close(results)

	successCount := 0
	for err := range results {
		if err == nil {
			successCount++
		}
	}

	if successCount != 1 {
		t.Errorf("expected exactly 1 successful concurrent transition, got %d", successCount)
	}

	final := sm.Current()
	if final != StateFinished && final != StateStopping {
		t.Errorf("expected final state to be finished or stopping, got %s", final)
	}
}

func TestErrorContainsTransitionInfo(t *testing.T) {
	sm := NewStateMachine()
	err := sm.Transition(StateStopped)
	if err == nil {
		t.Fatal("expected error for invalid transition")
	}

	expected := "invalid state transition: idle -> stopped"
	if err.Error() != expected {
		t.Errorf("expected error %q, got %q", expected, err.Error())
	}
}
