package hub

import (
	"sync"
	"sync/atomic"
	"time"
)

// DeliveryJournal records Edge→Hub callback attempts for reconciliation.
// Minimal in-memory implementation for AH-SR-049; not durable across restarts.
type DeliveryJournal struct {
	mu      sync.RWMutex
	seq     atomic.Uint64
	entries []DeliveryJournalEntry
	max     int
}

// DeliveryJournalEntry is one callback attempt.
type DeliveryJournalEntry struct {
	Seq        uint64    `json:"seq"`
	TaskID     string    `json:"task_id"`
	RunID      string    `json:"run_id,omitempty"`
	Action     string    `json:"action"` // ack|stream|done|fail
	OK         bool      `json:"ok"`
	Error      string    `json:"error,omitempty"`
	Attempts   int       `json:"attempts"`
	RecordedAt time.Time `json:"recorded_at"`
}

// NewDeliveryJournal creates a bounded in-memory journal (default 1000 entries).
func NewDeliveryJournal(max int) *DeliveryJournal {
	if max <= 0 {
		max = 1000
	}
	return &DeliveryJournal{max: max}
}

// Record appends an entry and returns its sequence number.
func (j *DeliveryJournal) Record(taskID, runID, action string, ok bool, errMsg string, attempts int) uint64 {
	if j == nil {
		return 0
	}
	seq := j.seq.Add(1)
	entry := DeliveryJournalEntry{
		Seq:        seq,
		TaskID:     taskID,
		RunID:      runID,
		Action:     action,
		OK:         ok,
		Error:      errMsg,
		Attempts:   attempts,
		RecordedAt: time.Now().UTC(),
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	j.entries = append(j.entries, entry)
	if len(j.entries) > j.max {
		j.entries = j.entries[len(j.entries)-j.max:]
	}
	return seq
}

// Snapshot returns a copy of journal entries with seq > afterSeq (0 = all).
func (j *DeliveryJournal) Snapshot(afterSeq uint64) []DeliveryJournalEntry {
	if j == nil {
		return nil
	}
	j.mu.RLock()
	defer j.mu.RUnlock()
	out := make([]DeliveryJournalEntry, 0, len(j.entries))
	for _, e := range j.entries {
		if e.Seq > afterSeq {
			out = append(out, e)
		}
	}
	return out
}

// Len returns current entry count.
func (j *DeliveryJournal) Len() int {
	if j == nil {
		return 0
	}
	j.mu.RLock()
	defer j.mu.RUnlock()
	return len(j.entries)
}

// redeliveryKey uniquely identifies a delivery attempt group for candidate selection.
