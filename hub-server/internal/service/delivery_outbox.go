package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/ws"
	"github.com/agenthub/hub-server/pkg/uuidv7"
)

// ── Outbox status constants ─────────────────────────────────────────────────

const (
	DeliveryStatusPending   = "pending"
	DeliveryStatusSent      = "sent"
	DeliveryStatusDelivered = "delivered"
	DeliveryStatusRetrying  = "retrying"
	DeliveryStatusDead      = "dead"
)

// ── Delivery outbox TTL constants ───────────────────────────────────────────

const (
	// DefaultMaxDeliveryAttempts is the default retry budget before dead-letter.
	DefaultMaxDeliveryAttempts = 3

	// DeliveryRetryBaseInterval is the base backoff interval (multiplied by 2^attempt).
	DeliveryRetryBaseInterval = 2 * time.Second

	// DeliveryRetryMaxInterval caps the exponential backoff ceiling.
	DeliveryRetryMaxInterval = 30 * time.Second

	// DeliveryRetryScanInterval controls how often retryable deliveries are scanned.
	DeliveryRetryScanInterval = 15 * time.Second

	// DeliveryPendingTimeout is the time after which a pending (never sent) delivery
	// is eligible for retry.
	DeliveryPendingTimeout = 30 * time.Second

	// DeliverySentTimeout is the time after which a sent (unacked) delivery
	// is eligible for retry.
	DeliverySentTimeout = 60 * time.Second

	// DeliveryOutboxMaxBatch caps the number of deliveries scanned per retry cycle.
	DeliveryOutboxMaxBatch = 100
)

// ── Model ──────────────────────────────────────────────────────────────────

// deliveryOutboxRecord models a single row in the delivery_outbox table.
// It is defined in the service package to keep the outbox self-contained
// within the allowed modification boundaries (service/ + migrations/).
type deliveryOutboxRecord struct {
	ID           string     `gorm:"primaryKey;type:uuid"`
	TaskID       string     `gorm:"type:uuid;not null;index:idx_delivery_outbox_task_id"`
	DeliveryID   string     `gorm:"type:varchar(128);not null;uniqueIndex:idx_delivery_outbox_delivery_id"`
	Payload      string     `gorm:"type:text;not null"`
	Status       string     `gorm:"type:varchar(16);not null;default:pending;index:idx_delivery_outbox_status_nr,priority:1"`
	AttemptCount int        `gorm:"type:smallint;not null;default:0"`
	MaxAttempts  int        `gorm:"type:smallint;not null;default:3"`
	NextRetryAt  *time.Time `gorm:"type:timestamptz;index:idx_delivery_outbox_status_nr,priority:2"`
	LastError    string     `gorm:"type:text;default:''"`
	EdgeDeviceID string     `gorm:"type:uuid;default:null"`
	CreatedAt    time.Time  `gorm:"autoCreateTime"`
	UpdatedAt    time.Time  `gorm:"autoUpdateTime:false"`
	DeliveredAt  *time.Time `gorm:"type:timestamptz"`
}

func (r *deliveryOutboxRecord) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	r.ID = id
	return nil
}

func (r *deliveryOutboxRecord) BeforeUpdate(tx *gorm.DB) error {
	r.UpdatedAt = time.Now()
	return nil
}

// TableName overrides the default pluralized table name for GORM.
func (deliveryOutboxRecord) TableName() string {
	return "delivery_outbox"
}

// ── Outbox operations on AgentService ──────────────────────────────────────

// RecordDelivery inserts a delivery_outbox entry in status=pending before
// the Hub dispatches a task to the Edge. Returns the generated delivery_id.
func (s *AgentService) RecordDelivery(ctx context.Context, taskID, payload, edgeDeviceID string) (string, error) {
	deliveryID, err := uuidv7.New()
	if err != nil {
		return "", fmt.Errorf("generate delivery id: %w", err)
	}

	rec := &deliveryOutboxRecord{
		DeliveryID:   deliveryID,
		TaskID:       taskID,
		Payload:      payload,
		Status:       DeliveryStatusPending,
		MaxAttempts:  DefaultMaxDeliveryAttempts,
		EdgeDeviceID: edgeDeviceID,
	}

	if err := s.db.WithContext(ctx).Create(rec).Error; err != nil {
		return "", fmt.Errorf("record delivery outbox: %w", err)
	}

	slog.Debug("delivery outbox recorded",
		"delivery_id", deliveryID,
		"task_id", taskID,
		"status", DeliveryStatusPending,
	)
	return deliveryID, nil
}

// MarkDeliverySent transitions an outbox record from pending to sent after
// the Hub has dispatched the task to the Edge.
func (s *AgentService) MarkDeliverySent(ctx context.Context, deliveryID string) error {
	result := s.db.WithContext(ctx).
		Model(&deliveryOutboxRecord{}).
		Where("delivery_id = ? AND status = ?", deliveryID, DeliveryStatusPending).
		Updates(map[string]interface{}{
			"status": DeliveryStatusSent,
		})
	if result.Error != nil {
		return fmt.Errorf("mark delivery sent: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		// Already sent or already acked — idempotent.
		return nil
	}
	slog.Debug("delivery marked sent", "delivery_id", deliveryID)
	return nil
}

// AckDelivery marks an outbox record as delivered when the Edge acknowledges
// the dispatch with the matching delivery_id.
func (s *AgentService) AckDelivery(ctx context.Context, deliveryID string) error {
	now := time.Now()
	result := s.db.WithContext(ctx).
		Model(&deliveryOutboxRecord{}).
		Where("delivery_id = ? AND status IN ?", deliveryID, []string{DeliveryStatusPending, DeliveryStatusSent, DeliveryStatusRetrying}).
		Updates(map[string]interface{}{
			"status":       DeliveryStatusDelivered,
			"delivered_at": &now,
		})
	if result.Error != nil {
		return fmt.Errorf("ack delivery: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		// Check if already delivered (idempotent ack).
		var existing deliveryOutboxRecord
		if err := s.db.WithContext(ctx).
			Where("delivery_id = ? AND status = ?", deliveryID, DeliveryStatusDelivered).
			First(&existing).Error; err == nil {
			return nil
		}
		return errcode.ErrBadRequest.WithMessage("delivery not found or already terminal")
	}
	slog.Debug("delivery acked", "delivery_id", deliveryID)
	return nil
}

// ScanRetryableDeliveries returns deliveries eligible for retry: pending records
// past their pending timeout, and sent records past their sent timeout.
func (s *AgentService) ScanRetryableDeliveries(ctx context.Context) ([]deliveryOutboxRecord, error) {
	now := time.Now()
	var records []deliveryOutboxRecord

	// Pending deliveries past their initial timeout → retryable.
	err := s.db.WithContext(ctx).
		Where("status = ? AND created_at <= ?", DeliveryStatusPending, now.Add(-DeliveryPendingTimeout)).
		Limit(DeliveryOutboxMaxBatch).
		Find(&records).Error
	if err != nil {
		return nil, fmt.Errorf("scan pending deliveries: %w", err)
	}

	// Sent deliveries past their ack timeout → retryable.
	var sentRecords []deliveryOutboxRecord
	err = s.db.WithContext(ctx).
		Where("status = ? AND updated_at <= ?", DeliveryStatusSent, now.Add(-DeliverySentTimeout)).
		Limit(DeliveryOutboxMaxBatch).
		Find(&sentRecords).Error
	if err != nil {
		return nil, fmt.Errorf("scan sent deliveries: %w", err)
	}

	// Retrying deliveries past their next_retry_at → retryable.
	var retryingRecords []deliveryOutboxRecord
	err = s.db.WithContext(ctx).
		Where("status = ? AND next_retry_at IS NOT NULL AND next_retry_at <= ?", DeliveryStatusRetrying, now).
		Limit(DeliveryOutboxMaxBatch).
		Find(&retryingRecords).Error
	if err != nil {
		return nil, fmt.Errorf("scan retrying deliveries: %w", err)
	}

	records = append(records, sentRecords...)
	records = append(records, retryingRecords...)
	return records, nil
}

// computeNextRetryAt calculates the next retry time using exponential backoff.
// Formula: baseInterval * 2^attempt, capped at maxInterval.
func computeNextRetryAt(attempt int) time.Time {
	delay := DeliveryRetryBaseInterval * time.Duration(int64(math.Pow(2, float64(attempt))))
	if delay > DeliveryRetryMaxInterval {
		delay = DeliveryRetryMaxInterval
	}
	return time.Now().Add(delay)
}

// MarkDeliveryRetrying transitions a delivery to retrying status and increments
// the attempt counter. Returns true if the retry should proceed, false if max
// attempts have been exceeded (caller should move to dead-letter).
func (s *AgentService) MarkDeliveryRetrying(ctx context.Context, deliveryID string, lastError string) (shouldRetry bool, err error) {
	var rec deliveryOutboxRecord
	err = s.db.WithContext(ctx).Where("delivery_id = ?", deliveryID).First(&rec).Error
	if err != nil {
		return false, fmt.Errorf("find delivery for retry: %w", err)
	}

	newAttempt := rec.AttemptCount + 1
	if newAttempt >= rec.MaxAttempts {
		// Move to dead-letter.
		updateErr := s.db.WithContext(ctx).
			Model(&deliveryOutboxRecord{}).
			Where("delivery_id = ? AND status IN ?", deliveryID, []string{DeliveryStatusPending, DeliveryStatusSent, DeliveryStatusRetrying}).
			Updates(map[string]interface{}{
				"status":        DeliveryStatusDead,
				"attempt_count": newAttempt,
				"last_error":    truncateString(lastError, 1024),
				"next_retry_at": nil,
			}).Error
		if updateErr != nil {
			return false, fmt.Errorf("move to dead-letter: %w", updateErr)
		}
		slog.Warn("delivery moved to dead-letter",
			"delivery_id", deliveryID,
			"task_id", rec.TaskID,
			"attempts", newAttempt,
			"max_attempts", rec.MaxAttempts,
			"last_error", lastError,
		)
		return false, nil
	}

	nextRetry := computeNextRetryAt(newAttempt)
	result := s.db.WithContext(ctx).
		Model(&deliveryOutboxRecord{}).
		Where("delivery_id = ? AND status IN ?", deliveryID, []string{DeliveryStatusPending, DeliveryStatusSent, DeliveryStatusRetrying}).
		Updates(map[string]interface{}{
			"status":        DeliveryStatusRetrying,
			"attempt_count": newAttempt,
			"last_error":    truncateString(lastError, 1024),
			"next_retry_at": &nextRetry,
		})
	if result.Error != nil {
		return false, fmt.Errorf("mark delivery retrying: %w", result.Error)
	}

	slog.Info("delivery scheduled for retry",
		"delivery_id", deliveryID,
		"task_id", rec.TaskID,
		"attempt", newAttempt,
		"max_attempts", rec.MaxAttempts,
		"next_retry_at", nextRetry.Format(time.RFC3339),
	)
	return true, nil
}

// MoveDeliveryToDeadLetter explicitly moves a delivery to dead-letter status.
// This is used when a retry attempt encounters a non-retryable error.
func (s *AgentService) MoveDeliveryToDeadLetter(ctx context.Context, deliveryID string, lastError string) error {
	result := s.db.WithContext(ctx).
		Model(&deliveryOutboxRecord{}).
		Where("delivery_id = ? AND status IN ?", deliveryID, []string{DeliveryStatusPending, DeliveryStatusSent, DeliveryStatusRetrying}).
		Updates(map[string]interface{}{
			"status":     DeliveryStatusDead,
			"last_error": truncateString(lastError, 1024),
		})
	if result.Error != nil {
		return fmt.Errorf("move to dead-letter: %w", result.Error)
	}
	slog.Warn("delivery moved to dead-letter (explicit)",
		"delivery_id", deliveryID,
		"last_error", lastError,
	)
	return nil
}

// GetDeliveryStatus returns the current status of a delivery record.
func (s *AgentService) GetDeliveryStatus(ctx context.Context, deliveryID string) (string, error) {
	var rec deliveryOutboxRecord
	err := s.db.WithContext(ctx).Where("delivery_id = ?", deliveryID).First(&rec).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", errcode.ErrBadRequest.WithMessage("delivery not found")
		}
		return "", err
	}
	return rec.Status, nil
}

// StartDeliveryRetryLoop starts a background goroutine that periodically scans
// for retryable deliveries and re-dispatches them.
func (s *AgentService) StartDeliveryRetryLoop(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(DeliveryRetryScanInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.retryDeliveries(ctx)
			}
		}
	}()
}

// retryDeliveries scans for retryable deliveries and re-dispatches them.
func (s *AgentService) retryDeliveries(ctx context.Context) {
	records, err := s.ScanRetryableDeliveries(ctx)
	if err != nil {
		slog.Warn("failed to scan retryable deliveries", "error", err)
		return
	}

	for _, rec := range records {
		shouldRetry, err := s.MarkDeliveryRetrying(ctx, rec.DeliveryID, rec.LastError)
		if err != nil {
			slog.Warn("failed to mark delivery retrying", "delivery_id", rec.DeliveryID, "error", err)
			continue
		}
		if !shouldRetry {
			// Moved to dead-letter by MarkDeliveryRetrying.
			continue
		}

		// Re-dispatch the task payload through the dispatch pipeline.
		s.redispatchDelivery(ctx, &rec)
	}
}

// redispatchDelivery re-dispatches a delivery by parsing the stored payload
// and routing it to the target Edge device.
func (s *AgentService) redispatchDelivery(ctx context.Context, rec *deliveryOutboxRecord) {
	// Parse the payload to get dispatch info.
	var dp dispatchPayload
	if err := json.Unmarshal([]byte(rec.Payload), &dp); err != nil {
		slog.Error("failed to unmarshal delivery payload for redispatch",
			"delivery_id", rec.DeliveryID,
			"task_id", rec.TaskID,
			"error", err,
		)
		_ = s.MoveDeliveryToDeadLetter(ctx, rec.DeliveryID, fmt.Sprintf("payload unmarshal: %v", err))
		return
	}

	// Update the delivery_id in the payload so the Edge can ack the new attempt.
	dp.DeliveryID = rec.DeliveryID

	newPayload, err := json.Marshal(dp)
	if err != nil {
		slog.Error("failed to marshal redispatch payload",
			"delivery_id", rec.DeliveryID,
			"task_id", rec.TaskID,
			"error", err,
		)
		_ = s.MoveDeliveryToDeadLetter(ctx, rec.DeliveryID, fmt.Sprintf("payload marshal: %v", err))
		return
	}

	// Look up the task for dispatch routing.
	task, err := s.getPendingTaskForRedelivery(ctx, rec.TaskID)
	if err != nil {
		slog.Warn("redispatch: task lookup failed, marking dead-letter",
			"delivery_id", rec.DeliveryID,
			"task_id", rec.TaskID,
			"error", err,
		)
		_ = s.MoveDeliveryToDeadLetter(ctx, rec.DeliveryID, fmt.Sprintf("task lookup: %v", err))
		return
	}

	// Only retry if task is still in a retryable state.
	if task.Status != "queued" && task.Status != "dispatched" && task.Status != "running" {
		slog.Info("redispatch: task in terminal state, moving delivery to dead-letter",
			"delivery_id", rec.DeliveryID,
			"task_id", rec.TaskID,
			"task_status", task.Status,
		)
		_ = s.MoveDeliveryToDeadLetter(ctx, rec.DeliveryID, fmt.Sprintf("task status is %s", task.Status))
		return
	}

	// Re-dispatch via HTTP (if local Edge) or WebSocket.
	s.retryDispatchToTarget(ctx, task, dp, newPayload, rec)
}

// getPendingTaskForRedelivery looks up a task for redelivery purposes.
func (s *AgentService) getPendingTaskForRedelivery(ctx context.Context, taskID string) (*pendingTaskSnapshot, error) {
	var task struct {
		ID                string
		AgentInstanceID   string
		TriggeredByUserID string
		Status            string
		EdgeDeviceID      string
		EdgeRunID         string
		TargetID          string
	}
	err := s.db.WithContext(ctx).
		Table("pending_agent_tasks").
		Select("id, agent_instance_id, triggered_by_user_id, status, edge_device_id, edge_run_id, target_id").
		Where("id = ?", taskID).
		First(&task).Error
	if err != nil {
		return nil, err
	}
	return &pendingTaskSnapshot{
		ID:                task.ID,
		AgentInstanceID:   task.AgentInstanceID,
		TriggeredByUserID: task.TriggeredByUserID,
		Status:            task.Status,
		EdgeDeviceID:      task.EdgeDeviceID,
		EdgeRunID:         task.EdgeRunID,
		TargetID:          task.TargetID,
	}, nil
}

type pendingTaskSnapshot struct {
	ID                string
	AgentInstanceID   string
	TriggeredByUserID string
	Status            string
	EdgeDeviceID      string
	EdgeRunID         string
	TargetID          string
}

// retryDispatchToTarget re-dispatches a delivery to the target Edge device.
func (s *AgentService) retryDispatchToTarget(ctx context.Context, task *pendingTaskSnapshot, dp dispatchPayload, newPayload []byte, rec *deliveryOutboxRecord) {
	// Build a minimal PendingAgentTask for dispatchToEdgeHTTP which needs task.ID.
	minimalTask := &model.PendingAgentTask{
		ID:           task.ID,
		TargetID:     task.TargetID,
		EdgeDeviceID: task.EdgeDeviceID,
	}

	// Try HTTP dispatch first for unbound tasks.
	if task.TargetID == "" && task.EdgeDeviceID == "" {
		if edgeRunID := s.dispatchToEdgeHTTP(ctx, minimalTask, &dp); edgeRunID != "" {
			slog.Info("redispatch: HTTP dispatch succeeded",
				"delivery_id", rec.DeliveryID,
				"task_id", rec.TaskID,
				"edge_run_id", edgeRunID,
			)
			return
		}
	}

	// Route by device: push to WebSocket or offline queue.
	cacheClient := resolveAgentCache(s.cacheClient)
	if task.EdgeDeviceID != "" {
		connID, err := cacheClient.GetRouteForDevice(ctx, task.TriggeredByUserID, "desktop", task.EdgeDeviceID)
		if err == nil && connID != "" && s.mgr != nil {
			conn := s.mgr.FindByConnID(connID)
			if conn != nil && conn.UserID == task.TriggeredByUserID {
				frame := ws.NewFrame(ws.TypeAgentDispatch, json.RawMessage(newPayload))
				result := s.mgr.PushToConn(connID, frame)
				if result.Queued {
					slog.Info("redispatch: WS dispatch succeeded",
						"delivery_id", rec.DeliveryID,
						"task_id", rec.TaskID,
						"device_id", task.EdgeDeviceID,
					)
					return
				}
				slog.Warn("redispatch: WS push not queued",
					"delivery_id", rec.DeliveryID,
					"task_id", rec.TaskID,
					"delivery_status", result.Status,
					"error", result.Err,
				)
			}
		}
		// Offline: push to Redis queue.
		if err := cacheClient.PushPendingTask(ctx, task.TriggeredByUserID, string(newPayload)); err != nil {
			slog.Error("redispatch: failed to push to offline queue",
				"delivery_id", rec.DeliveryID,
				"task_id", rec.TaskID,
				"error", err,
			)
		} else {
			slog.Info("redispatch: queued to offline queue",
				"delivery_id", rec.DeliveryID,
				"task_id", rec.TaskID,
				"user_id", task.TriggeredByUserID,
			)
		}
		return
	}

	// Fallback: push to inviter's desktop queue.
	connID, err := cacheClient.GetRoute(ctx, task.TriggeredByUserID, "desktop")
	if err == nil && connID != "" && s.mgr != nil {
		conn := s.mgr.FindByConnID(connID)
		if conn != nil {
			frame := ws.NewFrame(ws.TypeAgentDispatch, json.RawMessage(newPayload))
			result := s.mgr.PushToConn(connID, frame)
			if result.Queued {
				slog.Info("redispatch: WS fallback dispatch succeeded",
					"delivery_id", rec.DeliveryID,
					"task_id", rec.TaskID,
				)
				return
			}
		}
	}

	if err := cacheClient.PushPendingTask(ctx, task.TriggeredByUserID, string(newPayload)); err != nil {
		slog.Error("redispatch: failed to push to fallback queue",
			"delivery_id", rec.DeliveryID,
			"task_id", rec.TaskID,
			"error", err,
		)
	} else {
		slog.Info("redispatch: queued to fallback queue",
			"delivery_id", rec.DeliveryID,
			"task_id", rec.TaskID,
		)
	}
}

// truncateString truncates s to maxLen characters, appending "..." if truncated.
func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-3] + "..."
}

// ── Outbox maintenance ─────────────────────────────────────────────────────

// CleanupOldDeliveries removes delivered and dead-letter records older than
// the given duration. This should be called periodically to prevent unbounded
// outbox growth.
func (s *AgentService) CleanupOldDeliveries(ctx context.Context, olderThan time.Duration) (int64, error) {
	cutoff := time.Now().Add(-olderThan)
	result := s.db.WithContext(ctx).
		Where("status IN ? AND updated_at <= ?", []string{DeliveryStatusDelivered, DeliveryStatusDead}, cutoff).
		Delete(&deliveryOutboxRecord{})
	if result.Error != nil {
		return 0, fmt.Errorf("cleanup old deliveries: %w", result.Error)
	}
	if result.RowsAffected > 0 {
		slog.Info("cleaned up old delivery outbox records",
			"count", result.RowsAffected,
			"cutoff", cutoff.Format(time.RFC3339),
		)
	}
	return result.RowsAffected, nil
}

// GetDeliveryStats returns aggregate stats for the delivery outbox.
func (s *AgentService) GetDeliveryStats(ctx context.Context) (map[string]int64, error) {
	type statusCount struct {
		Status string
		Count  int64
	}
	var rows []statusCount
	err := s.db.WithContext(ctx).
		Model(&deliveryOutboxRecord{}).
		Select("status, COUNT(*) as count").
		Group("status").
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("get delivery stats: %w", err)
	}
	stats := make(map[string]int64, len(rows))
	for _, r := range rows {
		stats[r.Status] = r.Count
	}
	return stats, nil
}
