package lifecycle

import (
	"strings"
	"sync"
	"testing"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/store"
)

type stubTranscriptWriter struct {
	mu    sync.Mutex
	items []store.Item
	err   error
}

func (w *stubTranscriptWriter) CreateProject(id, name, ownerID string) (store.Project, error) {
	return store.Project{}, nil
}
func (w *stubTranscriptWriter) CreateThread(id, projectID, title, kind, avatarColor, avatarLabel string) (store.Thread, error) {
	return store.Thread{}, nil
}
func (w *stubTranscriptWriter) UpdateThread(id string, title *string, status *string) (store.Thread, bool) {
	return store.Thread{}, false
}
func (w *stubTranscriptWriter) DeleteThread(id string) bool { return false }
func (w *stubTranscriptWriter) CreateRun(id, projectID, threadID string) (store.Run, error) {
	return store.Run{}, nil
}
func (w *stubTranscriptWriter) SetRunStatus(id, status string) (store.Run, bool) {
	return store.Run{}, false
}
func (w *stubTranscriptWriter) SetRunStatusIf(id, status string, allowedCurrent ...string) (store.Run, bool) {
	return store.Run{}, false
}
func (w *stubTranscriptWriter) CreateItem(item store.Item) (store.Item, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.err != nil {
		return store.Item{}, w.err
	}
	w.items = append(w.items, item)
	return item, nil
}
func (w *stubTranscriptWriter) CreateThreadMessage(itemID, threadID, role, content string) (store.Item, error) {
	return store.Item{}, nil
}
func (w *stubTranscriptWriter) PinThreadItem(threadID, itemID, pinnedBy string) (store.ThreadPin, error) {
	return store.ThreadPin{}, nil
}
func (w *stubTranscriptWriter) DeleteThreadPin(threadID, itemID string) bool { return false }
func (w *stubTranscriptWriter) UpsertRunDiffFile(file store.RunDiffFile) (store.RunDiffFile, error) {
	return store.RunDiffFile{}, nil
}
func (w *stubTranscriptWriter) UpsertArtifact(artifact store.Artifact) (store.Artifact, error) {
	return store.Artifact{}, nil
}
func (w *stubTranscriptWriter) UpsertPreview(preview store.Preview) (store.Preview, error) {
	return store.Preview{}, nil
}
func (w *stubTranscriptWriter) CreateUserProfile(profile store.UserProfile) (store.UserProfile, error) {
	return store.UserProfile{}, nil
}
func (w *stubTranscriptWriter) CreateAgentProfile(profile store.AgentProfile) (store.AgentProfile, error) {
	return store.AgentProfile{}, nil
}
func (w *stubTranscriptWriter) UpdateAgentProfile(id string, patch map[string]any) (store.AgentProfile, error) {
	return store.AgentProfile{}, nil
}
func (w *stubTranscriptWriter) DeleteAgentProfile(id string) error { return nil }
func (w *stubTranscriptWriter) UpsertSettings(patch map[string]string) (store.UserSettings, error) {
	return store.UserSettings{}, nil
}
func (w *stubTranscriptWriter) SetRunEvidenceGate(id, result string) (store.Run, bool) {
	return store.Run{}, false
}
func (w *stubTranscriptWriter) SetRunRetryCount(id string, count int) (store.Run, bool) {
	return store.Run{}, false
}
func (w *stubTranscriptWriter) SetRunWorkDir(id, workDir string) (store.Run, bool) {
	return store.Run{}, false
}
func (w *stubTranscriptWriter) SetRunHubTaskID(id, hubTaskID string) (store.Run, bool) {
	return store.Run{}, false
}
func (w *stubTranscriptWriter) UpsertRunCheckpoint(cp store.RunCheckpoint) (store.RunCheckpoint, error) {
	return store.RunCheckpoint{}, store.ErrNotFound
}

// stubLifecycleStore embeds Writer so newThreadTranscriptEmitter can cast it.
type stubLifecycleStore struct {
	store.Writer
}

func (s *stubLifecycleStore) GetRun(id string) (store.Run, bool) { return store.Run{}, false }
func (s *stubLifecycleStore) SetRunStatus(id, status string) (store.Run, bool) {
	return store.Run{}, false
}
func (s *stubLifecycleStore) SetRunStatusIf(id, status string, allowedCurrent ...string) (store.Run, bool) {
	return store.Run{}, false
}
func (s *stubLifecycleStore) SetRunEvidenceGate(id, result string) (store.Run, bool) {
	return store.Run{}, false
}
func (s *stubLifecycleStore) SetRunRetryCount(id string, count int) (store.Run, bool) {
	return store.Run{}, false
}

type recordingEmitter struct {
	mu     sync.Mutex
	events []struct {
		eventType string
		payload   any
	}
}

func (e *recordingEmitter) Emit(eventType string, scope map[string]any, payload any) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.events = append(e.events, struct {
		eventType string
		payload   any
	}{eventType: eventType, payload: payload})
}

func TestTranscriptItemID(t *testing.T) {
	t.Parallel()

	id := transcriptItemID("run_abc")
	if !strings.HasPrefix(id, "item_abc_agent_") {
		t.Fatalf("transcriptItemID() = %q, want prefix item_abc_agent_", id)
	}
	// Without run_ prefix, full id is used after trim (no-op).
	id2 := transcriptItemID("xyz")
	if !strings.HasPrefix(id2, "item_xyz_agent_") {
		t.Fatalf("transcriptItemID() = %q, want prefix item_xyz_agent_", id2)
	}
}

func TestNewThreadTranscriptEmitter_NilWhenNoWriterOrInner(t *testing.T) {
	t.Parallel()

	run := store.Run{ID: "run_1", ProjectID: "p", ThreadID: "t"}
	if got := newThreadTranscriptEmitter(&nonWriterLifecycle{}, run, &recordingEmitter{}); got != nil {
		t.Fatalf("expected nil without Writer, got %#v", got)
	}
	writer := &stubTranscriptWriter{}
	repo := &stubLifecycleStore{Writer: writer}
	if got := newThreadTranscriptEmitter(repo, run, nil); got != nil {
		t.Fatalf("expected nil without inner emitter, got %#v", got)
	}
}

type nonWriterLifecycle struct{}

func (n *nonWriterLifecycle) GetRun(id string) (store.Run, bool) { return store.Run{}, false }
func (n *nonWriterLifecycle) SetRunStatus(id, status string) (store.Run, bool) {
	return store.Run{}, false
}
func (n *nonWriterLifecycle) SetRunStatusIf(id, status string, allowedCurrent ...string) (store.Run, bool) {
	return store.Run{}, false
}
func (n *nonWriterLifecycle) SetRunEvidenceGate(id, result string) (store.Run, bool) {
	return store.Run{}, false
}
func (n *nonWriterLifecycle) SetRunRetryCount(id string, count int) (store.Run, bool) {
	return store.Run{}, false
}
func (n *nonWriterLifecycle) SetRunWorkDir(id, workDir string) (store.Run, bool) {
	return store.Run{}, false
}
func (n *nonWriterLifecycle) SetRunHubTaskID(id, hubTaskID string) (store.Run, bool) {
	return store.Run{}, false
}
func (n *nonWriterLifecycle) UpsertRunCheckpoint(cp store.RunCheckpoint) (store.RunCheckpoint, error) {
	return store.RunCheckpoint{}, store.ErrNotFound
}

func TestThreadTranscriptEmitter_CollectAndFlush(t *testing.T) {
	t.Parallel()

	writer := &stubTranscriptWriter{}
	repo := &stubLifecycleStore{Writer: writer}
	inner := &recordingEmitter{}
	run := store.Run{ID: "run_42", ProjectID: "proj", ThreadID: "thread"}

	em := newThreadTranscriptEmitter(repo, run, inner)
	if em == nil {
		t.Fatal("expected non-nil emitter")
	}

	em.Emit(adapters.BusEventTextDelta, nil, map[string]any{"content": "Hello "})
	em.Emit(adapters.BusEventTextBlock, nil, map[string]any{"text": "world"})
	em.Emit(adapters.BusEventResult, nil, map[string]any{"result": "fallback-ignored"})
	em.Emit("run.agent.other", nil, map[string]any{"content": "ignored"})

	if len(inner.events) != 4 {
		t.Fatalf("inner events = %d, want 4 (all forwarded)", len(inner.events))
	}

	em.Flush()
	writer.mu.Lock()
	if len(writer.items) != 1 {
		writer.mu.Unlock()
		t.Fatalf("CreateItem calls = %d, want 1", len(writer.items))
	}
	item := writer.items[0]
	writer.mu.Unlock()

	if item.Type != "agent_message" || item.Role != "agent" || item.Status != "created" {
		t.Fatalf("item metadata = %+v", item)
	}
	if item.Content != "Hello world" {
		t.Fatalf("item.Content = %q, want %q", item.Content, "Hello world")
	}
	if item.RunID != run.ID || item.ProjectID != run.ProjectID || item.ThreadID != run.ThreadID {
		t.Fatalf("item scope = %+v", item)
	}
	if !strings.HasPrefix(item.ID, "item_42_agent_") {
		t.Fatalf("item.ID = %q", item.ID)
	}

	// Second flush is a no-op.
	em.Flush()
	writer.mu.Lock()
	defer writer.mu.Unlock()
	if len(writer.items) != 1 {
		t.Fatalf("after second Flush, CreateItem calls = %d, want 1", len(writer.items))
	}
}

func TestThreadTranscriptEmitter_FlushEmptySkipped(t *testing.T) {
	t.Parallel()

	writer := &stubTranscriptWriter{}
	repo := &stubLifecycleStore{Writer: writer}
	em := newThreadTranscriptEmitter(repo, store.Run{ID: "run_x"}, &recordingEmitter{})
	em.Flush()
	if len(writer.items) != 0 {
		t.Fatalf("empty flush should not CreateItem, got %d", len(writer.items))
	}
}

func TestThreadTranscriptEmitter_ResultFallback(t *testing.T) {
	t.Parallel()

	writer := &stubTranscriptWriter{}
	repo := &stubLifecycleStore{Writer: writer}
	em := newThreadTranscriptEmitter(repo, store.Run{ID: "run_f", ProjectID: "p", ThreadID: "t"}, &recordingEmitter{})
	em.Emit(adapters.BusEventResult, nil, map[string]any{"result": " only-result "})
	em.Flush()
	if len(writer.items) != 1 {
		t.Fatalf("CreateItem calls = %d, want 1", len(writer.items))
	}
	if writer.items[0].Content != "only-result" {
		t.Fatalf("Content = %q, want only-result", writer.items[0].Content)
	}
}

func TestThreadTranscriptEmitterPersistsAssistantMessage(t *testing.T) {
	s := store.New()
	run := newExecutorTestRun(t, s)
	inner := &recordingLifecycleEmitter{}
	emitter := newThreadTranscriptEmitter(s, run, inner)
	if emitter == nil {
		t.Fatal("newThreadTranscriptEmitter returned nil")
	}

	emitter.Emit(adapters.BusEventTextDelta, nil, map[string]any{"content": "OK"})
	emitter.Emit(adapters.BusEventTextBlock, nil, map[string]any{"content": "-OUTPUT"})
	emitter.Flush()
	emitter.Flush()

	items := s.ListThreadItems(run.ThreadID)
	var assistantItems []store.Item
	for _, item := range items {
		if item.Type == "agent_message" {
			assistantItems = append(assistantItems, item)
		}
	}
	if len(assistantItems) != 1 {
		t.Fatalf("assistant items = %#v, want exactly one persisted assistant message", assistantItems)
	}
	if assistantItems[0].Role != "agent" || assistantItems[0].RunID != run.ID || assistantItems[0].Content != "OK-OUTPUT" {
		t.Fatalf("assistant item = %#v, want persisted agent transcript", assistantItems[0])
	}
	if len(inner.events) != 2 {
		t.Fatalf("inner events = %#v, want passthrough events", inner.events)
	}
}
