package audit

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/pkg/safego"
)

// auditFileSink handles writing audit chain entries to a JSONL file with
// OS-level append-only semantics.
type auditFileSink struct {
	mu   sync.Mutex
	file *os.File
}

// newAuditFileSink opens or creates the JSONL audit file.
// Returns nil if filePath is empty (file sink disabled).
func newAuditFileSink(filePath string) (*auditFileSink, error) {
	if filePath == "" {
		return nil, nil
	}
	// #nosec G304 -- path comes from operator config (AuditLogFile), not request input
	f, err := os.OpenFile(filePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	return &auditFileSink{file: f}, nil
}

// write appends a JSONL entry to the audit file.
func (s *auditFileSink) write(entry model.AuditChainEntry) error {
	if s == nil {
		return nil
	}
	b, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err = s.file.Write(append(b, '\n'))
	return err
}

// close flushes and closes the file sink.
func (s *auditFileSink) close() error {
	if s == nil {
		return nil
	}
	return s.file.Close()
}

// Service provides audit event recording and querying.
type Service struct {
	db       *gorm.DB
	fileSink *auditFileSink

	// Retry queue for transient DB failures.
	retryCh      chan *model.AuditEvent
	retryBufSize int
	wg           sync.WaitGroup
	done         chan struct{}

	// lifecycle is the process-lifetime context for the retry loop; retry
	// backoff and persistence abort when it is cancelled. Defaults to
	// context.Background when Config.LifecycleContext is nil.
	lifecycle context.Context
	// shutdownCtx is set by Shutdown (before close(done)) so the retry loop's
	// bounded drain aborts at the shutdown deadline. atomic.Value because the
	// retry loop reads it concurrently; the happens-before edge through
	// close(done) covers writes, but Load is race-free regardless.
	shutdownCtx  atomic.Value // context.Context; nil until Shutdown
	shutdownOnce sync.Once
}

// Config holds optional configuration for the Service.
type Config struct {
	// AuditLogFile is the path to the JSONL audit log file.
	// When empty, file-based logging is disabled.
	AuditLogFile string
	// RetryBufferSize is the channel buffer size for the retry queue (default 1024).
	RetryBufferSize int
	// LifecycleContext is the process-lifetime context that governs the
	// async retry loop. When nil, context.Background is used. Cancel it to
	// abort retries and persistence on process shutdown.
	LifecycleContext context.Context
}

// NewService creates a new Service.
func NewService(db *gorm.DB, cfg *Config) *Service {
	if cfg == nil {
		cfg = &Config{}
	}

	bufSize := 1024
	if cfg != nil && cfg.RetryBufferSize > 0 {
		bufSize = cfg.RetryBufferSize
	}

	lifecycle := context.Background()
	if cfg != nil && cfg.LifecycleContext != nil {
		lifecycle = cfg.LifecycleContext
	}

	fileSink, err := newAuditFileSink(cfg.AuditLogFile)
	if err != nil {
		slog.Error("audit: failed to open audit log file, file sink disabled", "path", cfg.AuditLogFile, "error", err)
	}

	svc := &Service{
		db:           db,
		fileSink:     fileSink,
		retryCh:      make(chan *model.AuditEvent, bufSize),
		retryBufSize: bufSize,
		done:         make(chan struct{}),
		lifecycle:    lifecycle,
	}

	if bufSize > 0 {
		svc.wg.Add(1)
		safego.SafeGo("audit.retry_loop", svc.retryLoop)
	}

	return svc
}

// retryLoop processes the retry queue with exponential backoff.
// On Shutdown it drains remaining events until the shutdown deadline
// (bounded), then abandons the rest (counted via AuditQueueDepth).
func (s *Service) retryLoop() {
	defer s.wg.Done()
	for {
		select {
		case <-s.done:
			s.drain()
			return
		case event := <-s.retryCh:
			metrics.AuditQueueDepth.Set(float64(len(s.retryCh)))
			s.persistWithRetry(s.persistCtx(), event)
		}
	}
}

// persistCtx returns the context governing persistence: the shutdown
// deadline once Shutdown has been called, otherwise the lifecycle context.
func (s *Service) persistCtx() context.Context {
	if v := s.shutdownCtx.Load(); v != nil {
		if ctx, ok := v.(context.Context); ok && ctx != nil {
			return ctx
		}
	}
	return s.lifecycle
}

// drain processes queued events until the queue is empty or the shutdown
// deadline expires (whichever comes first).
func (s *Service) drain() {
	shutdownCtx := s.persistCtx()
	for {
		select {
		case event := <-s.retryCh:
			s.persistWithRetry(shutdownCtx, event)
		case <-shutdownCtx.Done():
			metrics.AuditQueueDepth.Set(float64(len(s.retryCh)))
			slog.Warn("audit: shutdown deadline reached, abandoning queued events", "remaining", len(s.retryCh), "queue_capacity", s.retryBufSize)
			return
		default:
			metrics.AuditQueueDepth.Set(0)
			return
		}
	}
}

// persistWithRetry attempts to persist an event with up to 3 retries
// using exponential backoff (100ms, 200ms, 400ms). The backoff sleep is
// cancellable via ctx, so a shutdown or lifecycle cancellation aborts the
// retry early instead of sleeping on a dead process.
func (s *Service) persistWithRetry(ctx context.Context, event *model.AuditEvent) {
	const maxRetries = 3
	backoff := 100 * time.Millisecond

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if ctx.Err() != nil {
			metrics.AuditFinalFailures.Inc()
			slog.Warn("audit: persist aborted by shutdown/lifecycle cancellation", "event_type", event.EventType, "error", ctx.Err())
			return
		}
		opCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		err := repository.CreateAuditEvent(s.db.WithContext(opCtx), event)
		cancel()
		if err == nil {
			// Write to JSONL file sink.
			if writeErr := s.fileSink.write(event.HashChainEntry()); writeErr != nil {
				metrics.AuditFileSinkFailures.Inc()
				slog.Error("audit: failed to write file sink", "error", writeErr)
			}
			return
		}
		if attempt < maxRetries {
			metrics.AuditRetries.Inc()
			slog.Warn("audit: persist failed, retrying", "attempt", attempt+1, "error", err)
			timer := time.NewTimer(backoff)
			select {
			case <-timer.C:
			case <-ctx.Done():
				timer.Stop()
				metrics.AuditFinalFailures.Inc()
				slog.Warn("audit: persist backoff aborted by shutdown/lifecycle cancellation", "event_type", event.EventType)
				return
			}
			backoff *= 2
		} else {
			metrics.AuditFinalFailures.Inc()
			slog.Error("audit: failed to persist event after retries, event dropped", "event_type", event.EventType, "error", err)
		}
	}
}

// Shutdown gracefully stops the retry loop and closes the file sink.
// It is idempotent (subsequent calls no-op). The retry loop drains the
// queue but aborts at ctx's deadline, so shutdown is bounded even when the
// queue is full and persistence is slow.
func (s *Service) Shutdown(ctx context.Context) {
	s.shutdownOnce.Do(func() {
		s.shutdownCtx.Store(ctx)
		close(s.done)
		// Bounded wait: the retry loop exits by itself once the drain hits
		// the deadline (persistWithRetry aborts on ctx cancellation).
		done := make(chan struct{})
		safego.SafeGo("audit.shutdown_waiter", func() { s.wg.Wait(); close(done) })
		select {
		case <-done:
		case <-ctx.Done():
			metrics.AuditQueueDepth.Set(float64(len(s.retryCh)))
			slog.Warn("audit: shutdown deadline reached before retry loop exited", "remaining", len(s.retryCh), "queue_capacity", s.retryBufSize)
		}
		if s.fileSink != nil {
			if err := s.fileSink.close(); err != nil {
				metrics.AuditFileSinkFailures.Inc()
				slog.Error("audit: failed to close file sink", "error", err)
			}
		}
	})
}

// ListResult holds a page of audit event results.
type ListResult struct {
	Items   []model.AuditEvent `json:"items"`
	HasMore bool               `json:"has_more"`
	Cursor  string             `json:"next_cursor,omitempty"`
}

// Record writes an audit event (asynchronous, best-effort). Events are
// enqueued to a buffered channel and persisted asynchronously with a retry
// mechanism, so audit logging never blocks the caller's request. Transient
// DB failures are retried with backoff. If the queue is full the event is
// DROPPED and counted in audit_queue_drops_total — callers for whom event
// loss is unacceptable (security-critical decisions) must use RecordSync
// instead. Reliability levels: Record = at-most-once, RecordSync = at-least-
// once (waits for persistence).
func (s *Service) Record(ctx context.Context, userID, eventType, severity, summary string, details map[string]interface{}, profileID, targetID *string, clientIP string) {
	detailsJSON := "{}"
	if details != nil {
		if b, err := json.Marshal(details); err == nil {
			detailsJSON = string(b)
		}
	}

	event := &model.AuditEvent{
		UserID:    userID,
		EventType: eventType,
		Severity:  severity,
		Summary:   summary,
		Details:   detailsJSON,
		ProfileID: profileID,
		TargetID:  targetID,
		ClientIP:  clientIP,
	}

	// Non-blocking send to retry channel; drop if channel is full.
	select {
	case s.retryCh <- event:
		metrics.AuditQueueDepth.Set(float64(len(s.retryCh)))
	default:
		metrics.AuditQueueDrops.Inc()
		slog.Error("audit: retry queue full, dropping event", "event_type", eventType, "queue_capacity", s.retryBufSize)
	}
}

// RecordSync records an audit event synchronously and waits for persistence.
// Use this for security-critical events where event loss is unacceptable.
func (s *Service) RecordSync(ctx context.Context, userID, eventType, severity, summary string, details map[string]interface{}, profileID, targetID *string, clientIP string) error {
	detailsJSON := "{}"
	if details != nil {
		if b, err := json.Marshal(details); err == nil {
			detailsJSON = string(b)
		}
	}

	event := &model.AuditEvent{
		UserID:    userID,
		EventType: eventType,
		Severity:  severity,
		Summary:   summary,
		Details:   detailsJSON,
		ProfileID: profileID,
		TargetID:  targetID,
		ClientIP:  clientIP,
	}

	if err := repository.CreateAuditEvent(s.db.WithContext(ctx), event); err != nil {
		return err
	}

	// Write to JSONL file sink.
	if s.fileSink != nil {
		if err := s.fileSink.write(event.HashChainEntry()); err != nil {
			metrics.AuditFileSinkFailures.Inc()
			slog.Error("audit: failed to write file sink (sync)", "error", err)
		}
	}

	return nil
}

// Query returns paginated audit events. If callerUserID is non-empty and
// isAdmin is false, only events belonging to callerUserID are returned.
func (s *Service) Query(ctx context.Context, callerUserID string, isAdmin bool, eventType, severity string, since, until *time.Time, cursor string, pageSize int) (*ListResult, error) {
	filterUserID := ""
	if !isAdmin {
		filterUserID = callerUserID
	}

	events, hasMore, err := repository.ListAuditEvents(s.db, filterUserID, eventType, severity, since, until, cursor, pageSize)
	if err != nil {
		return nil, err
	}

	var nextCursor string
	if hasMore && len(events) > 0 {
		nextCursor = events[len(events)-1].ID
	}

	return &ListResult{Items: events, HasMore: hasMore, Cursor: nextCursor}, nil
}

// VerifyChain verifies the hash-chain integrity of the most recent audit events.
// Returns the index of the first invalid link, or -1 if the chain is valid.
func (s *Service) VerifyChain(limit int) (int, error) {
	return repository.VerifyAuditChain(s.db, limit)
}

// RecordPermissionDecision is a callback compatible with
// middleware.AuditPermissionFn. It records a permission decision (allow/deny)
// as a security-critical audit event using synchronous persistence to ensure
// the event is never lost.
func (s *Service) RecordPermissionDecision(ctx context.Context, userID string, decision string, allowed bool, details map[string]interface{}, clientIP string) {
	severity := "info"
	summary := "permission_granted"
	if !allowed {
		severity = "warn"
		summary = "permission_denied"
	}
	if details == nil {
		details = make(map[string]interface{})
	}
	details["decision"] = decision
	details["allowed"] = allowed

	// Use synchronous recording for security-critical events.
	if err := s.RecordSync(ctx, userID, "permission", severity, summary, details, nil, nil, clientIP); err != nil {
		slog.Error("audit: failed to record permission decision synchronously", "error", err)
	}
}
