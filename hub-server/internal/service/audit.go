package service

import (
	"context"
	"encoding/json"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// AuditService provides audit event recording and querying.
type AuditService struct {
	db *gorm.DB
}

// NewAuditService creates a new AuditService.
func NewAuditService(db *gorm.DB) *AuditService {
	return &AuditService{db: db}
}

// AuditListResult holds a page of audit event results.
type AuditListResult struct {
	Items   []model.AuditEvent `json:"items"`
	HasMore bool               `json:"has_more"`
	Cursor  string             `json:"next_cursor,omitempty"`
}

// Record writes an audit event. It is fire-and-forget: errors are silently
// discarded so that audit logging never blocks or fails the caller's request.
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

	// Fire-and-forget — don't block the caller on audit write failures
	go func() {
		if err := repository.CreateAuditEvent(s.db, event); err != nil {
			// Log the error but don't fail the request
			_ = err
		}
	}()
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

// Cleanup deletes events older than the given time. Returns the number of
// deleted rows.
func (s *AuditService) Cleanup(ctx context.Context, before time.Time) (int64, error) {
	return repository.DeleteAuditEventsBefore(s.db, before)
}
