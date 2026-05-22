// Package process provides a concurrency-safe state machine for runner process states.
package process

import (
	"fmt"
	"sync"
)

// State represents a runner process state.
type State string

const (
	StateIdle     State = "idle"
	StateRunning  State = "running"
	StateFinished State = "finished"
	StateStopping State = "stopping"
	StateStopped  State = "stopped"
)

// validTransitions defines the allowed state transitions.
//
//	idle     -> running
//	running  -> finished, stopping
//	stopping -> stopped
var validTransitions = map[State][]State{
	StateIdle:     {StateRunning},
	StateRunning:  {StateFinished, StateStopping},
	StateStopping: {StateStopped},
	StateFinished: {},
	StateStopped:  {},
}

// StateMachine manages state transitions with concurrency safety.
type StateMachine struct {
	mu      sync.Mutex
	current State
}

// NewStateMachine creates a new StateMachine in the idle state.
func NewStateMachine() *StateMachine {
	return &StateMachine{current: StateIdle}
}

// Current returns the current state.
func (sm *StateMachine) Current() State {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	return sm.current
}

// Transition attempts to transition to the given state.
// Returns an error if the transition is not allowed.
func (sm *StateMachine) Transition(to State) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	allowed, ok := validTransitions[sm.current]
	if !ok {
		return fmt.Errorf("unknown current state: %s", sm.current)
	}

	for _, s := range allowed {
		if s == to {
			sm.current = to
			return nil
		}
	}

	return fmt.Errorf("invalid state transition: %s -> %s", sm.current, to)
}
