package handler

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/service/audit"
)

// AuditService is the subset of *audit.Service used by AuditHandler.
type AuditService interface {
	Query(ctx context.Context, callerUserID string, isAdmin bool, eventType, severity string, since, until *time.Time, cursor string, pageSize int) (*audit.ListResult, error)
}

// AuditHandler handles HTTP endpoints for audit event queries.
type AuditHandler struct {
	service AuditService
}

// NewAuditHandler creates a new AuditHandler.
func NewAuditHandler(service AuditService) *AuditHandler {
	return &AuditHandler{service: service}
}

// ListAuditEvents handles GET requests for audit event listing.
//
// Query parameters:
//   - event_type  — filter by event type
//   - severity    — filter by severity level
//   - since       — RFC3339 timestamp (inclusive)
//   - until       — RFC3339 timestamp (inclusive)
//   - pageSize    — page size (default 50)
//   - pageCursor  — cursor for the next page
//
// Admin users can see all events; regular users see only their own.
func (h *AuditHandler) ListAuditEvents(c *gin.Context) {
	callerUserID := c.GetString("user_id")
	// Future: check a role/permission field on the user.
	isAdmin := false

	var since, until *time.Time
	if s := c.Query("since"); s != "" {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			since = &t
		}
	}
	if u := c.Query("until"); u != "" {
		if t, err := time.Parse(time.RFC3339, u); err == nil {
			until = &t
		}
	}

	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", strconv.Itoa(config.DefaultPaginationLimit)))
	// Default is DefaultPaginationLimit (50); ceiling is MaxListPageSize (200),
	// the maximum declared by the shared openapi PageSize parameter. Clamping
	// here enforces that contract at the handler: <=0 yields 50 and >200
	// yields 200.
	pageSize = config.ClampPageSize(pageSize, config.MaxListPageSize, config.DefaultPaginationLimit)

	result, err := h.service.Query(c.Request.Context(), callerUserID, isAdmin,
		c.Query("event_type"), c.Query("severity"),
		since, until, c.Query("pageCursor"), pageSize)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}

	OK(c, gin.H{
		"items": result.Items,
		"page":  gin.H{"nextCursor": result.Cursor, "hasMore": result.HasMore},
	})
}
