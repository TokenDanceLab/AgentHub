package agents

import (
	"sync"
	"testing"
	"time"
)

func TestNewQueue(t *testing.T) {
	q := NewQueue()
	if q == nil {
		t.Fatal("NewQueue should not return nil")
	}
	if q.AgentCount() != 0 {
		t.Fatal("new queue should have 0 agents")
	}
}

func TestQueue_EnsureAgent(t *testing.T) {
	q := NewQueue()

	ch := q.EnsureAgent("agent-1", 64)
	if ch == nil {
		t.Fatal("EnsureAgent should return non-nil channel")
	}
	if q.AgentCount() != 1 {
		t.Fatalf("AgentCount should be 1, got %d", q.AgentCount())
	}

	// Second call should return the same channel.
	ch2 := q.EnsureAgent("agent-1", 64)
	if ch != ch2 {
		t.Fatal("EnsureAgent should return the same channel for existing agent")
	}
}

func TestQueue_Send(t *testing.T) {
	q := NewQueue()
	ch := q.EnsureAgent("agent-1", 64)

	msg := Message{
		ID:          "msg-1",
		FromAgentID: "orch",
		ToAgentID:   "agent-1",
		Type:        MsgTypeTask,
		Payload:     map[string]string{"task": "build API"},
	}

	if !q.Send(msg) {
		t.Fatal("Send should return true")
	}

	// Read back.
	select {
	case received := <-ch:
		if received.ID != "msg-1" {
			t.Fatalf("received ID = %q, want msg-1", received.ID)
		}
		if received.FromAgentID != "orch" {
			t.Fatalf("received FromAgentID = %q, want orch", received.FromAgentID)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timed out receiving message")
	}
}

func TestQueue_SendToNonexistent(t *testing.T) {
	q := NewQueue()

	ok := q.Send(Message{
		ID:          "msg-1",
		FromAgentID: "orch",
		ToAgentID:   "nonexistent",
		Type:        MsgTypeTask,
	})
	if ok {
		t.Fatal("Send to nonexistent agent should return false")
	}
}

func TestQueue_SendToClosed(t *testing.T) {
	q := NewQueue()
	_ = q.EnsureAgent("agent-1", 64)
	q.Close("agent-1")

	ok := q.Send(Message{
		ID:          "msg-1",
		FromAgentID: "orch",
		ToAgentID:   "agent-1",
		Type:        MsgTypeTask,
	})
	if ok {
		t.Fatal("Send to closed agent should return false")
	}
}

func TestQueue_Broadcast(t *testing.T) {
	q := NewQueue()
	ch1 := q.EnsureAgent("agent-1", 64)
	ch2 := q.EnsureAgent("agent-2", 64)

	msg := Message{
		ID:          "msg-1",
		FromAgentID: "orch",
		ToAgentID:   "", // broadcast
		Type:        MsgTypeProgress,
	}

	count := q.Broadcast(msg, "")
	if count != 2 {
		t.Fatalf("Broadcast should deliver to 2 agents, got %d", count)
	}

	// Both should receive.
	select {
	case <-ch1:
	default:
		t.Fatal("agent-1 should receive broadcast")
	}
	select {
	case <-ch2:
	default:
		t.Fatal("agent-2 should receive broadcast")
	}
}

func TestQueue_BroadcastExclude(t *testing.T) {
	q := NewQueue()
	ch1 := q.EnsureAgent("agent-1", 64)
	_ = q.EnsureAgent("agent-2", 64)

	msg := Message{
		ID:          "msg-1",
		FromAgentID: "orch",
		Type:        MsgTypeProgress,
	}

	count := q.Broadcast(msg, "agent-1")
	if count != 1 {
		t.Fatalf("Broadcast with exclude should deliver to 1 agent, got %d", count)
	}

	// agent-1 was excluded, should be empty.
	select {
	case <-ch1:
		t.Fatal("agent-1 should NOT receive excluded broadcast")
	default:
	}
}

func TestQueue_SendToChildren(t *testing.T) {
	q := NewQueue()
	ch1 := q.EnsureAgent("child-1", 64)
	ch2 := q.EnsureAgent("child-2", 64)
	_ = q.EnsureAgent("other", 64)

	msg := Message{
		ID:          "msg-1",
		FromAgentID: "orch",
		Type:        MsgTypeTask,
	}

	count := q.SendToChildren(msg, []string{"child-1", "child-2"})
	if count != 2 {
		t.Fatalf("SendToChildren should deliver to 2 children, got %d", count)
	}

	select {
	case <-ch1:
	default:
		t.Fatal("child-1 should receive message")
	}
	select {
	case <-ch2:
	default:
		t.Fatal("child-2 should receive message")
	}
}

func TestQueue_Receive(t *testing.T) {
	q := NewQueue()
	ch := q.EnsureAgent("agent-1", 64)

	_ = q.Receive("agent-1")

	// Channel from Receive should be the same.
	ch2 := q.Receive("agent-1")
	if ch != ch2 {
		t.Fatal("Receive should return the same channel as EnsureAgent")
	}

	// Nonexistent returns nil.
	if ch3 := q.Receive("nonexistent"); ch3 != nil {
		t.Fatal("Receive for nonexistent should return nil")
	}
}

func TestQueue_Close(t *testing.T) {
	q := NewQueue()
	_ = q.EnsureAgent("agent-1", 64)

	q.Close("agent-1")

	if q.AgentCount() != 0 {
		t.Fatalf("AgentCount should be 0 after close, got %d", q.AgentCount())
	}

	// Sending to closed should fail.
	ok := q.Send(Message{ID: "m", FromAgentID: "o", ToAgentID: "agent-1", Type: MsgTypeTask})
	if ok {
		t.Fatal("Send to closed agent should return false")
	}
}

func TestQueue_CloseAll(t *testing.T) {
	q := NewQueue()
	_ = q.EnsureAgent("agent-1", 64)
	_ = q.EnsureAgent("agent-2", 64)

	q.CloseAll()

	if q.AgentCount() != 0 {
		t.Fatalf("AgentCount should be 0 after CloseAll, got %d", q.AgentCount())
	}
}

func TestQueue_Pending(t *testing.T) {
	q := NewQueue()
	_ = q.EnsureAgent("agent-1", 64)

	if n := q.Pending("agent-1"); n != 0 {
		t.Fatalf("Pending should be 0, got %d", n)
	}

	q.Send(Message{ID: "m1", FromAgentID: "o", ToAgentID: "agent-1", Type: MsgTypeTask})
	q.Send(Message{ID: "m2", FromAgentID: "o", ToAgentID: "agent-1", Type: MsgTypeTask})

	if n := q.Pending("agent-1"); n != 2 {
		t.Fatalf("Pending should be 2, got %d", n)
	}

	if n := q.Pending("nonexistent"); n != 0 {
		t.Fatalf("Pending for nonexistent should be 0, got %d", n)
	}
}

func TestQueue_ConcurrentSend(t *testing.T) {
	q := NewQueue()
	ch := q.EnsureAgent("agent-1", 256)
	var wg sync.WaitGroup
	n := 50

	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			q.Send(Message{
				ID:          "msg-" + string(rune('0'+idx%10)),
				FromAgentID: "orch",
				ToAgentID:   "agent-1",
				Type:        MsgTypeTask,
			})
		}(i)
	}
	wg.Wait()

	// Drain and count.
	count := 0
	drainLoop:
	for {
		select {
		case <-ch:
			count++
		case <-time.After(50 * time.Millisecond):
			break drainLoop
		}
	}
	if count != n {
		t.Fatalf("expected %d messages delivered, got %d", n, count)
	}
}

func TestQueue_ConcurrentSendReceive(t *testing.T) {
	q := NewQueue()
	_ = q.EnsureAgent("agent-1", 256)
	var wg sync.WaitGroup

	for i := 0; i < 30; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			if idx%2 == 0 {
				q.Send(Message{
					ID:          "msg",
					FromAgentID: "orch",
					ToAgentID:   "agent-1",
					Type:        MsgTypeTask,
				})
			} else {
				ch := q.Receive("agent-1")
				if ch != nil {
					select {
					case <-ch:
					default:
					}
				}
			}
		}(i)
	}
	wg.Wait()

	// Should not panic.
	_ = q.Pending("agent-1")
	_ = q.AgentCount()
}

func TestMessageTypeConstants(t *testing.T) {
	if MsgTypeTask != "task" {
		t.Fatal("MsgTypeTask should be 'task'")
	}
	if MsgTypeResult != "result" {
		t.Fatal("MsgTypeResult should be 'result'")
	}
	if MsgTypeProgress != "progress" {
		t.Fatal("MsgTypeProgress should be 'progress'")
	}
	if MsgTypeError != "error" {
		t.Fatal("MsgTypeError should be 'error'")
	}
	if MsgTypeShutdown != "shutdown" {
		t.Fatal("MsgTypeShutdown should be 'shutdown'")
	}
	if MsgTypeHeartbeat != "heartbeat" {
		t.Fatal("MsgTypeHeartbeat should be 'heartbeat'")
	}
}

func TestMessage_ZeroValue(t *testing.T) {
	msg := Message{}
	if msg.ID != "" {
		t.Fatal("zero-value Message.ID should be empty")
	}
	if msg.FromAgentID != "" {
		t.Fatal("zero-value Message.FromAgentID should be empty")
	}
	if msg.ToAgentID != "" {
		t.Fatal("zero-value Message.ToAgentID should be empty")
	}
	if msg.Type != "" {
		t.Fatal("zero-value Message.Type should be empty")
	}
	if msg.Payload != nil {
		t.Fatal("zero-value Message.Payload should be nil")
	}
	if !msg.Timestamp.IsZero() {
		t.Fatal("zero-value Message.Timestamp should be zero")
	}
}
