package agents

import (
	"sync"
	"time"
)

// Message represents an inter-agent communication message.
// It follows the pattern from Codex's InterAgentCommunication protocol.
type Message struct {
	ID          string    `json:"id"`
	FromAgentID string    `json:"fromAgentId"`
	ToAgentID   string    `json:"toAgentId"`           // empty = broadcast to all children
	Type        string    `json:"type"`                // "task", "result", "progress", "error", "shutdown"
	Payload     any       `json:"payload"`
	TaskID      string    `json:"taskId,omitempty"`    // associated task
	CorrelationID string  `json:"correlationId,omitempty"` // for request/response pairing
	TriggerTurn bool      `json:"triggerTurn"`         // wake the target agent's RunLoop on delivery
	Timestamp   time.Time `json:"timestamp"`
}

// Message types for inter-agent communication.
const (
	MsgTypeTask      = "task"      // orchestrator → sub-agent: new task assignment
	MsgTypeResult    = "result"    // sub-agent → orchestrator: task result
	MsgTypeProgress  = "progress"  // sub-agent → orchestrator: progress update
	MsgTypeError     = "error"     // sub-agent → orchestrator: error report
	MsgTypeShutdown  = "shutdown"  // orchestrator → sub-agent: terminate
	MsgTypeHeartbeat = "heartbeat" // bidirectional: keep-alive
)

// Queue provides per-agent message channels for asynchronous inter-agent
// communication. It is the transport layer between orchestrator and sub-agents,
// enabling the Supervisor pattern from 03-orchestration.md.
type Queue struct {
	mu     sync.RWMutex
	queues map[string]chan Message // per-agent receive channels
	wakes  map[string]chan struct{} // per-agent wake channels for trigger_turn
	closed map[string]bool
}

// NewQueue creates an empty inter-agent message queue.
func NewQueue() *Queue {
	return &Queue{
		queues: make(map[string]chan Message),
		wakes:  make(map[string]chan struct{}),
		closed: make(map[string]bool),
	}
}

// EnsureAgent creates a message channel and wake channel for the given agent
// if they don't already exist. Returns the receive channel.
func (q *Queue) EnsureAgent(agentID string, bufferSize int) <-chan Message {
	if bufferSize <= 0 {
		bufferSize = 64
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	if _, ok := q.queues[agentID]; !ok {
		q.queues[agentID] = make(chan Message, bufferSize)
		q.wakes[agentID] = make(chan struct{}, 1) // buffered so wake is non-blocking
		q.closed[agentID] = false
	}
	return q.queues[agentID]
}

// Send delivers a message to an agent's queue. Returns false if the agent has
// no queue or the queue is closed.
//
// When TriggerTurn is true, Send also delivers a non-blocking wake signal to
// the target agent's trigger channel so the agent's RunLoop can break out of
// an idle select and process the message immediately.
func (q *Queue) Send(msg Message) bool {
	q.mu.RLock()
	ch, ok := q.queues[msg.ToAgentID]
	closed := q.closed[msg.ToAgentID]
	wakeCh, hasWake := q.wakes[msg.ToAgentID]
	q.mu.RUnlock()
	if !ok || closed {
		return false
	}

	// When TriggerTurn is set, wake the target agent's RunLoop so it
	// processes the message without waiting for a poll interval.
	if msg.TriggerTurn && hasWake {
		select {
		case wakeCh <- struct{}{}:
		default:
			// wake channel full; a prior wake is already pending, no-op
		}
	}

	select {
	case ch <- msg:
		return true
	default:
		return false // queue full, message dropped
	}
}

// Broadcast delivers a message to all agents except the sender.
// Returns the number of agents that received the message.
func (q *Queue) Broadcast(msg Message, excludeAgentID string) int {
	q.mu.RLock()
	defer q.mu.RUnlock()
	count := 0
	for agentID, ch := range q.queues {
		if agentID == excludeAgentID {
			continue
		}
		if q.closed[agentID] {
			continue
		}
		select {
		case ch <- msg:
			count++
		default:
			// queue full, skip
		}
	}
	return count
}

// SendToChildren delivers a message to all agents whose ParentID matches the
// given parentID. The caller must provide the child list; this function is
// transport-only and does not know about agent ancestry.
func (q *Queue) SendToChildren(msg Message, childIDs []string) int {
	q.mu.RLock()
	defer q.mu.RUnlock()
	count := 0
	for _, childID := range childIDs {
		ch, ok := q.queues[childID]
		if !ok || q.closed[childID] {
			continue
		}
		select {
		case ch <- msg:
			count++
		default:
		}
	}
	return count
}

// Receive returns the receive channel for an agent. Returns nil if the agent
// has no queue.
func (q *Queue) Receive(agentID string) <-chan Message {
	q.mu.RLock()
	defer q.mu.RUnlock()
	return q.queues[agentID]
}

// Close removes and closes the queue and wake channel for an agent. All queued
// messages are discarded.
func (q *Queue) Close(agentID string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if ch, ok := q.queues[agentID]; ok {
		q.closed[agentID] = true
		close(ch)
		delete(q.queues, agentID)
		delete(q.closed, agentID)
	}
	if wc, ok := q.wakes[agentID]; ok {
		close(wc)
		delete(q.wakes, agentID)
	}
}

// CloseAll removes and closes all agent queues and wake channels.
func (q *Queue) CloseAll() {
	q.mu.Lock()
	defer q.mu.Unlock()
	for agentID, ch := range q.queues {
		if !q.closed[agentID] {
			close(ch)
		}
	}
	for _, wc := range q.wakes {
		close(wc)
	}
	q.queues = make(map[string]chan Message)
	q.wakes = make(map[string]chan struct{})
	q.closed = make(map[string]bool)
}

// Pending returns the number of messages waiting in an agent's queue.
func (q *Queue) Pending(agentID string) int {
	q.mu.RLock()
	defer q.mu.RUnlock()
	ch, ok := q.queues[agentID]
	if !ok || q.closed[agentID] {
		return 0
	}
	return len(ch)
}

// AgentCount returns the number of registered agent queues.
func (q *Queue) AgentCount() int {
	q.mu.RLock()
	defer q.mu.RUnlock()
	return len(q.queues)
}

// WakeChan returns the wake channel for the given agent. Consumers select on
// this channel in their RunLoop to receive trigger_turn signals. Returns nil
// if the agent has no queue (call EnsureAgent first).
func (q *Queue) WakeChan(agentID string) <-chan struct{} {
	q.mu.RLock()
	defer q.mu.RUnlock()
	return q.wakes[agentID]
}

// PostMessage is a convenience wrapper around Send that sets TriggerTurn to
// true on the message before delivery, ensuring the target agent's RunLoop is
// woken immediately. It is the canonical method for posting a message that
// should interrupt the target's idle wait.
func (q *Queue) PostMessage(msg Message) bool {
	msg.TriggerTurn = true
	return q.Send(msg)
}
