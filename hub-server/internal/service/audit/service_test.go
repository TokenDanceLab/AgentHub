package audit

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/model"
)

func TestNewServiceAllowsNilConfig(t *testing.T) {
	// retryLoop/drain touch metrics.AuditQueueDepth directly; without
	// Register the gauge is nil. Register is idempotent (sync.Once).
	metrics.Register()

	svc := NewService(nil, nil)
	if svc == nil {
		t.Fatal("NewService returned nil")
	}
	svc.Shutdown(context.Background())
}

func testAuditChainEntry() model.AuditChainEntry {
	return model.AuditChainEntry{
		ID:        "event-1",
		PrevHash:  "prev-hash",
		Hash:      "computed-hash",
		UserID:    "user-1",
		EventType: "test",
		Severity:  "info",
		Summary:   "a test event",
	}
}

// --- auditFileSink ---

func TestNewAuditFileSinkEmptyPath(t *testing.T) {
	sink, err := newAuditFileSink("")
	if err != nil {
		t.Fatalf("newAuditFileSink(\"\") error = %v, want nil", err)
	}
	if sink != nil {
		t.Fatalf("newAuditFileSink(\"\") sink = %v, want nil (file sink disabled)", sink)
	}
}

func TestNewAuditFileSinkCreatesFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit.jsonl")
	sink, err := newAuditFileSink(path)
	if err != nil {
		t.Fatalf("newAuditFileSink(%q) error = %v, want nil", path, err)
	}
	if sink == nil {
		t.Fatalf("newAuditFileSink(%q) sink = nil for a valid path", path)
	}
	defer sink.close()

	// O_CREATE semantics: file must exist on disk after open.
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("audit file not created: %v", err)
	}
	if info.IsDir() {
		t.Fatal("audit file path is a directory")
	}
}

func TestNewAuditFileSinkBadDir(t *testing.T) {
	// Path inside a nonexistent directory: open must fail, sink must be nil.
	path := filepath.Join(t.TempDir(), "no-such-dir", "audit.jsonl")
	sink, err := newAuditFileSink(path)
	if err == nil {
		t.Fatal("newAuditFileSink(nonexistent dir) error = nil, want error")
	}
	if sink != nil {
		t.Fatalf("newAuditFileSink(nonexistent dir) sink = %v, want nil", sink)
	}
}

func TestAuditFileSinkWriteAppendsJSONL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit.jsonl")
	sink, err := newAuditFileSink(path)
	if err != nil {
		t.Fatal(err)
	}
	defer sink.close()

	entry := testAuditChainEntry()
	if err := sink.write(entry); err != nil {
		t.Fatalf("sink.write error = %v, want nil", err)
	}

	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(b) == 0 || b[len(b)-1] != '\n' {
		t.Fatalf("file content %q: want exactly one JSON line with trailing newline", b)
	}
	var got model.AuditChainEntry
	if err := json.Unmarshal(b[:len(b)-1], &got); err != nil {
		t.Fatalf("line is not valid JSON: %v; content %q", err, b)
	}
	if got != entry {
		t.Fatalf("read back entry %+v, want %+v", got, entry)
	}

	// Append semantics: a second write must produce a second line.
	if err := sink.write(entry); err != nil {
		t.Fatal(err)
	}
	b, err = os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if lines := bytes.Count(b, []byte{'\n'}); lines != 2 {
		t.Fatalf("lines after two writes = %d, want 2 (O_APPEND broken?)", lines)
	}
}

func TestAuditFileSinkWriteConcurrent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit.jsonl")
	sink, err := newAuditFileSink(path)
	if err != nil {
		t.Fatal(err)
	}
	defer sink.close()

	const n = 100
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			e := testAuditChainEntry()
			e.ID = fmt.Sprintf("event-%d", i)
			if err := sink.write(e); err != nil {
				// t.Errorf is safe from spawned goroutines; t.Fatalf is not.
				t.Errorf("concurrent sink.write error: %v", err)
			}
		}(i)
	}
	wg.Wait()

	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if lines := bytes.Count(b, []byte{'\n'}); lines != n {
		t.Fatalf("lines after %d concurrent writes = %d, want %d (lost/interleaved writes)", n, lines, n)
	}
}

func TestAuditFileSinkNilReceiverWrite(t *testing.T) {
	var s *auditFileSink
	if err := s.write(testAuditChainEntry()); err != nil {
		t.Fatalf("(*auditFileSink)(nil).write error = %v, want nil (nil receiver guard)", err)
	}
}

func TestAuditFileSinkNilReceiverClose(t *testing.T) {
	var s *auditFileSink
	if err := s.close(); err != nil {
		t.Fatalf("(*auditFileSink)(nil).close error = %v, want nil (nil receiver guard)", err)
	}
}

func TestAuditFileSinkClose(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit.jsonl")
	sink, err := newAuditFileSink(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := sink.close(); err != nil {
		t.Fatalf("first close error = %v, want nil", err)
	}
	if err := sink.close(); err == nil {
		t.Fatal("second close error = nil, want error on already-closed file")
	}
	// Write after close must fail (underlying *os.File is closed).
	if err := sink.write(testAuditChainEntry()); err == nil {
		t.Fatal("write after close error = nil, want error (file closed)")
	}
}

// --- Config / NewService ---

func TestNewServiceDefaultConfig(t *testing.T) {
	metrics.Register()
	svc := NewService(nil, nil)
	defer svc.Shutdown(context.Background())
	if got := cap(svc.retryCh); got != 1024 {
		t.Fatalf("default retryCh cap = %d, want 1024", got)
	}
	if svc.fileSink != nil {
		t.Fatalf("default fileSink = %v, want nil (no AuditLogFile)", svc.fileSink)
	}
}

func TestNewServiceCustomRetryBuffer(t *testing.T) {
	metrics.Register()
	svc := NewService(nil, &Config{RetryBufferSize: 5})
	defer svc.Shutdown(context.Background())
	if got := cap(svc.retryCh); got != 5 {
		t.Fatalf("retryCh cap = %d, want 5", got)
	}
}

func TestNewServiceWithAuditLogFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit.jsonl")
	metrics.Register()
	svc := NewService(nil, &Config{AuditLogFile: path})
	defer svc.Shutdown(context.Background())
	if svc.fileSink == nil {
		t.Fatal("fileSink = nil, want non-nil when AuditLogFile is set")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("audit file not created: %v", err)
	}
}

func TestNewServiceBadAuditLogFile(t *testing.T) {
	// newAuditFileSink error must only disable the file sink (logged), not
	// fail service construction.
	path := filepath.Join(t.TempDir(), "no-such-dir", "audit.jsonl")
	metrics.Register()
	svc := NewService(nil, &Config{AuditLogFile: path})
	defer svc.Shutdown(context.Background())
	if svc == nil {
		t.Fatal("service must still be created when the file sink fails")
	}
	if svc.fileSink != nil {
		t.Fatalf("fileSink = %v, want nil when newAuditFileSink fails", svc.fileSink)
	}
}

// --- Record (queue-full drop) ---

func TestAuditRecordQueueFullDrops(t *testing.T) {
	// Construct directly with no retryLoop: NewService would start
	// retryLoop which drains the channel and calls persistWithRetry (needs a
	// real *gorm.DB — would panic on nil). Keeping the queue unowned lets us
	// observe the drop-on-full behavior in isolation; Record itself only
	// does a non-blocking channel send.
	svc := &Service{retryCh: make(chan *model.AuditEvent, 1)}

	svc.Record(context.Background(), "user-1", "test", "info", "first", nil, nil, nil, "127.0.0.1")
	if got := len(svc.retryCh); got != 1 {
		t.Fatalf("retryCh len after first Record = %d, want 1", got)
	}

	svc.Record(context.Background(), "user-1", "test", "info", "second", nil, nil, nil, "127.0.0.1")
	if got := len(svc.retryCh); got != 1 {
		t.Fatalf("retryCh len after second Record = %d, want 1 (second event dropped: queue full)", got)
	}
}

// --- Shutdown ---

func TestAuditShutdownNoHang(t *testing.T) {
	metrics.Register()
	svc := NewService(nil, nil)
	done := make(chan struct{})
	go func() {
		svc.Shutdown(context.Background())
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Shutdown hung: retryLoop drain did not exit on empty queue")
	}
}

func TestAuditRecordAfterShutdown(t *testing.T) {
	metrics.Register()
	svc := NewService(nil, nil)
	svc.Shutdown(context.Background())

	// Shutdown only closes s.done; retryCh stays open, so Record still
	// enqueues without panicking or blocking. The event is never persisted
	// (retryLoop has exited) — documented behavior; recording after shutdown
	// is a caller bug, not a crash.
	done := make(chan struct{})
	go func() {
		svc.Record(context.Background(), "user-1", "test", "info", "late event", nil, nil, nil, "127.0.0.1")
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Record after Shutdown blocked")
	}
}
