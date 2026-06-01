package service

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"sync"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
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
	f, err := os.OpenFile(filePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
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

// AuditService provides audit event recording and querying.
type AuditService struct {
	db       *gorm.DB
	fileSink *auditFileSink

	// Retry queue for transient DB failures.
	retryCh chan *model.AuditEvent
	wg      sync.WaitGroup
	done    chan struct{}
}

// AuditServiceConfig holds optional configuration for the AuditService.
type AuditServiceConfig struct {
	// AuditLogFile is the path to the JSONL audit log file.
	// When empty, file-based logging is disabled.
	AuditLogFile string
	// RetryBufferSize is the channel buffer size for the retry queue (default 1024).
	RetryBufferSize int
}

// NewAuditService creates a new AuditService.
func NewAuditService(db *gorm.DB, cfg *AuditServiceConfig) *AuditService {
	bufSize := 1024
	if cfg != nil && cfg.RetryBufferSize > 0 {
		bufSize = cfg.RetryBufferSize
	}

	fileSink, err := newAuditFileSink(cfg.AuditLogFile)
	if err != nil {
		slog.Error("audit: failed to open audit log file, file sink disabled", "path", cfg.AuditLogFile, "error", err)
	}

	svc := &AuditService{
		db:       db,
		fileSink: fileSink,
		retryCh:  make(chan *model.AuditEvent, bufSize),
		done:     make(chan struct{}),
	}

	if bufSize > 0 {
		svc.wg.Add(1)
		go svc.retryLoop()
	}

	return svc
}

// retryLoop processes the retry queue with exponential backoff.
// It drains the channel on shutdown before exiting.
func (s *AuditService) retryLoop() {
	defer s.wg.Done()
	for {
		select {
		case <-s.done:
			// Drain remaining events before shutting down.
			for {
				select {
				case event := <-s.retryCh:
					s.persistWithRetry(event)
				default:
					return
				}
			}
		case event := <-s.retryCh:
			s.persistWithRetry(event)
		}
	}
}

// persistWithRetry attempts to persist an event with up to 3 retries
// using exponential backoff (100ms, 200ms, 400ms).
func (s *AuditService) persistWithRetry(event *model.AuditEvent) {
	const maxRetries = 3
	backoff := 100 * time.Millisecond

	for attempt := 0; attempt <= maxRetries; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		err := repository.CreateAuditEvent(s.db.WithContext(ctx), event)
		cancel()
		if err == nil {
			// Write to JSONL file sink.
			if writeErr := s.fileSink.write(event.HashChainEntry()); writeErr != nil {
				slog.Error("audit: failed to write file sink", "error", writeErr)
			}
			return
		}
		if attempt < maxRetries {
			slog.Warn("audit: persist failed, retrying", "attempt", attempt+1, "error", err)
			time.Sleep(backoff)
			backoff *= 2
		} else {
			slog.Error("audit: failed to persist event after retries, event dropped", "event_type", event.EventType, "error", err)
		}
	}
}

// Shutdown gracefully stops the retry loop and closes the file sink.
func (s *AuditService) Shutdown() {
	close(s.done)
	s.wg.Wait()
	if s.fileSink != nil {
		if err := s.fileSink.close(); err != nil {
			slog.Error("audit: failed to close file sink", "error", err)
		}
	}
}

// AuditListResult holds a page of audit event results.
type AuditListResult struct {
	Items   []model.AuditEvent `json:"items"`
	HasMore bool               `json:"has_more"`
	Cursor  string             `json:"next_cursor,omitempty"`
}

// Record writes an audit event. Events are enqueued to a buffered channel and
// persisted asynchronously with a retry mechanism, so audit logging never blocks
// the caller's request. Transient DB failures are retried with backoff.
func (s *AuditService) Record(ctx context.Context, userID, eventType, severity, summary string, details map[string]interface{}, profileID, targetID *string, clientIP string) {
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
	default:
		slog.Error("audit: retry queue full, dropping event", "event_type", eventType)
	}
}

// RecordSync records an audit event synchronously and waits for persistence.
// Use this for security-critical events where event loss is unacceptable.
func (s *AuditService) RecordSync(ctx context.Context, userID, eventType, severity, summary string, details map[string]interface{}, profileID, targetID *string, clientIP string) error {
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
			slog.Error("audit: failed to write file sink (sync)", "error", err)
		}
	}

	return nil
}

// Query returns paginated audit events. If callerUserID is non-empty and
// isAdmin is false, only events belonging to callerUserID are returned.
func (s *AuditService) Query(ctx context.Context, callerUserID string, isAdmin bool, eventType, severity string, since, until *time.Time, cursor string, pageSize int) (*AuditListResult, error) {
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

	return &AuditListResult{Items: events, HasMore: hasMore, Cursor: nextCursor}, nil
}

// VerifyChain verifies the hash-chain integrity of the most recent audit events.
// Returns the index of the first invalid link, or -1 if the chain is valid.
func (s *AuditService) VerifyChain(limit int) (int, error) {
	return repository.VerifyAuditChain(s.db, limit)
}

// RecordPermissionDecision is a callback compatible with
// middleware.AuditPermissionFn. It records a permission decision (allow/deny)
// as a security-critical audit event using synchronous persistence to ensure
// the event is never lost.
func (s *AuditService) RecordPermissionDecision(ctx context.Context, userID string, decision string, allowed bool, details map[string]interface{}, clientIP string) {
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
