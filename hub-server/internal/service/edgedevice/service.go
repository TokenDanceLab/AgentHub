// Package edgedevice delivers already-authorized tasks through the existing
// outbox to one paired Edge. Product sessions cannot claim this channel.
package edgedevice

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/dispatch"
	"github.com/agenthub/hub-server/internal/service/edgeenrollment"
	"github.com/agenthub/hub-server/internal/uuidv7"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const deliveryLease = 30 * time.Second
const controlLease = 5 * time.Second
const batchSize = 8

type Service struct {
	db         *gorm.DB
	enrollment *edgeenrollment.Service
}

func New(db *gorm.DB, enrollment *edgeenrollment.Service) *Service {
	return &Service{db: db, enrollment: enrollment}
}

type Delivery struct {
	DeliveryID string                  `json:"delivery_id"`
	TaskID     string                  `json:"task_id"`
	RunRequest dispatch.EdgeRunRequest `json:"run_request"`
}

type Control struct {
	ControlID string `json:"control_id"`
	TaskID    string `json:"task_id"`
	RunID     string `json:"run_id"`
	Kind      string `json:"kind"`
}

type PollResult struct {
	Deliveries []Delivery `json:"deliveries"`
	Controls   []Control  `json:"controls"`
}

type ControlAck struct {
	TaskID string `json:"task_id"`
	RunID  string `json:"run_id"`
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

// outboxRow is a projection of the existing delivery_outbox, never a second
// queue. The normal callback service still owns delivered acknowledgement.
type outboxRow struct {
	ID                   string `gorm:"primaryKey"`
	TaskID               string
	DeliveryID           string
	Payload              string
	Status               string
	AttemptCount         int
	MaxAttempts          int
	NextRetryAt          *time.Time
	LastError            string
	EdgeDeviceID         string
	Transport            string
	PairedCredentialHash string `json:"-"`
	CreatedAt            time.Time
	UpdatedAt            time.Time
	DeliveredAt          *time.Time
}

func (outboxRow) TableName() string { return "delivery_outbox" }

// Enqueue must be called in the same transaction that creates task. IDs and
// the immutable payload survive HTTP loss and Hub restarts unchanged.
func enqueue(tx *gorm.DB, p *edgeenrollment.Principal, task *model.PendingAgentTask, payload dispatch.Payload) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	deliveryID, err := uuidv7.New()
	if err != nil {
		return err
	}
	payload.TaskID, payload.DeliveryID = task.ID, deliveryID
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	return tx.Create(&outboxRow{ID: id, TaskID: task.ID, DeliveryID: deliveryID,
		Payload: string(encoded), Status: "pending", EdgeDeviceID: task.EdgeDeviceID,
		Transport: "edge_poll", PairedCredentialHash: p.CredentialHash,
		MaxAttempts: 3, CreatedAt: now, UpdatedAt: now}).Error
}

// CreateTask locks the current identity/device grant before task admission.
// An outbox insert failure rolls back the task as well; a concurrent Account
// logout or re-pairing cannot authorize a task under a stale grant.
func (s *Service) CreateTask(ctx context.Context, task *model.PendingAgentTask, payload dispatch.Payload) (*model.PendingAgentTask, error) {
	var created *model.PendingAgentTask
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var target model.ExecutionTarget
		if err := tx.Where("id = ? AND owner_id = ?", task.TargetID, task.TriggeredByUserID).Take(&target).Error; err != nil {
			return err
		}
		p, err := resolveTargetPrincipal(tx, &target)
		if err != nil {
			return err
		}
		if err := s.enrollment.ValidatePrincipalTx(tx, p); err != nil {
			return err
		}
		var evidence model.ExecutionTargetEvidence
		if err := tx.Where("target_id = ?", target.ID).Take(&evidence).Error; err != nil {
			return err
		}
		if err := dispatch.ValidateTargetHealth(Health(&target, &evidence, time.Now())); err != nil {
			return err
		}
		if task.EdgeDeviceID != p.DeviceID || task.TriggeredByUserID != p.UserID || payload.TargetID != p.TargetID || payload.EdgeDeviceID != p.DeviceID || payload.TriggerUserID != p.UserID {
			return errcode.AuthDeviceMismatch
		}
		if err := ValidateModelParams(task.ModelParams, p.WorkspaceRoot); err != nil {
			return err
		}
		if _, err := BuildRunRequest(p, payload); err != nil {
			return err
		}
		created, err = repository.CreatePendingTaskUnlessActive(tx, task)
		if err != nil {
			return err
		}
		return enqueue(tx, p, created, payload)
	})
	return created, err
}

func (s *Service) validate(ctx context.Context, p *edgeenrollment.Principal) error {
	if s == nil || s.db == nil || s.enrollment == nil || p == nil {
		return errcode.AuthInvalidToken
	}
	return s.enrollment.ValidatePrincipal(ctx, p)
}

// AuthorizeTask tightens the legacy callback owner check: paired credentials
// may never claim an unbound task or a task assigned to another target.
func (s *Service) AuthorizeTask(ctx context.Context, p *edgeenrollment.Principal, taskID string) error {
	if err := s.validate(ctx, p); err != nil {
		return err
	}
	var task model.PendingAgentTask
	if err := ownedTasks(s.db.WithContext(ctx), p).Where("pending_agent_tasks.id = ?", taskID).Take(&task).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentTaskNotFound
		}
		return err
	}
	return nil
}

func ownedTasks(db *gorm.DB, p *edgeenrollment.Principal) *gorm.DB {
	return db.Model(&model.PendingAgentTask{}).
		Where("pending_agent_tasks.edge_device_id = ? AND pending_agent_tasks.target_id = ? AND pending_agent_tasks.triggered_by_user_id = ?", p.DeviceID, p.TargetID, p.UserID).
		Where("EXISTS (SELECT 1 FROM agent_instances ai WHERE ai.id = pending_agent_tasks.agent_instance_id AND ai.inviter_user_id = ?)", p.UserID).
		Where("EXISTS (SELECT 1 FROM delivery_outbox o WHERE o.task_id = pending_agent_tasks.id AND o.transport = 'edge_poll' AND o.paired_credential_hash = ?)", p.CredentialHash)
}

// Poll is one bounded attempt. The HTTP layer owns long polling. Leases are
// persisted so different Hub instances cannot offer one delivery concurrently.
func (s *Service) Poll(ctx context.Context, p *edgeenrollment.Principal) (*PollResult, error) {
	if err := s.validate(ctx, p); err != nil {
		return nil, err
	}
	result := &PollResult{Deliveries: []Delivery{}, Controls: []Control{}}
	now := time.Now().UTC()
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.enrollment.ValidatePrincipalTx(tx, p); err != nil {
			return err
		}
		var tasks []model.PendingAgentTask
		if err := ownedTasks(tx, p).
			Where("pending_agent_tasks.cancel_requested_at IS NOT NULL AND pending_agent_tasks.cancel_applied_at IS NULL").
			Where("pending_agent_tasks.status IN ?", []string{"queued", "dispatched", "running", "failed", "timeout"}).
			Where("EXISTS (SELECT 1 FROM delivery_outbox o WHERE o.task_id = pending_agent_tasks.id AND o.transport = 'edge_poll' AND o.edge_device_id = ? AND (o.next_retry_at IS NULL OR o.next_retry_at <= ?))", p.DeviceID, now).
			Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).Order("pending_agent_tasks.created_at ASC").Limit(batchSize).Find(&tasks).Error; err != nil {
			return err
		}
		for _, task := range tasks {
			if err := tx.Model(&outboxRow{}).Where("task_id = ? AND edge_device_id = ? AND transport = 'edge_poll'", task.ID, p.DeviceID).
				Updates(map[string]any{"next_retry_at": now.Add(controlLease), "updated_at": now}).Error; err != nil {
				return err
			}
			result.Controls = append(result.Controls, Control{ControlID: task.ID, TaskID: task.ID, RunID: task.EdgeRunID, Kind: "cancel"})
		}
		tasks = nil
		if err := ownedTasks(tx, p).
			Where("pending_agent_tasks.cancel_requested_at IS NULL AND pending_agent_tasks.status IN ? AND pending_agent_tasks.expire_at > ?", []string{"queued", "dispatched"}, now).
			Where("EXISTS (SELECT 1 FROM delivery_outbox o WHERE o.task_id = pending_agent_tasks.id AND o.transport = 'edge_poll' AND o.edge_device_id = ? AND o.status IN ? AND (o.next_retry_at IS NULL OR o.next_retry_at <= ?))", p.DeviceID, []string{"pending", "sent", "retrying"}, now).
			Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).Order("pending_agent_tasks.created_at ASC").Limit(batchSize).Find(&tasks).Error; err != nil {
			return err
		}
		for _, task := range tasks {
			var row outboxRow
			if err := tx.Where("task_id = ? AND edge_device_id = ? AND transport = 'edge_poll' AND paired_credential_hash = ? AND status IN ?", task.ID, p.DeviceID, p.CredentialHash, []string{"pending", "sent", "retrying"}).Order("created_at ASC").Take(&row).Error; err != nil {
				return err
			}
			var payload dispatch.Payload
			if err := json.Unmarshal([]byte(row.Payload), &payload); err != nil {
				return errcode.ErrBadRequest.WithMessage("invalid paired delivery payload")
			}
			if payload.TaskID != task.ID || payload.TargetID != p.TargetID || payload.EdgeDeviceID != p.DeviceID || payload.TriggerUserID != p.UserID || payload.DeliveryID != row.DeliveryID {
				return errcode.AuthDeviceMismatch
			}
			req, err := BuildRunRequest(p, payload)
			if err != nil {
				return err
			}
			if err := tx.Model(&outboxRow{}).Where("id = ?", row.ID).Updates(map[string]any{"status": "sent", "next_retry_at": now.Add(deliveryLease), "updated_at": now}).Error; err != nil {
				return err
			}
			if task.Status == model.TaskStatusQueued {
				if err := tx.Model(&model.PendingAgentTask{}).Where("id = ?", task.ID).Updates(map[string]any{"status": model.TaskStatusDispatched, "dispatched_at": now}).Error; err != nil {
					return err
				}
			}
			result.Deliveries = append(result.Deliveries, Delivery{DeliveryID: row.DeliveryID, TaskID: task.ID, RunRequest: req})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	// A revoke committed while selecting leaves the lease intact, but no task
	// payload escapes to the now-invalid credential.
	if err := s.validate(ctx, p); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Service) AckControl(ctx context.Context, p *edgeenrollment.Principal, controlID string, ack ControlAck) error {
	if err := s.validate(ctx, p); err != nil {
		return err
	}
	if ack.TaskID != controlID || controlID == "" || (ack.Status != "applied" && ack.Status != "failed") || len(ack.Error) > 1024 || len(ack.RunID) > 128 {
		return errcode.ErrBadRequest
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.enrollment.ValidatePrincipalTx(tx, p); err != nil {
			return err
		}
		var task model.PendingAgentTask
		if err := ownedTasks(tx, p).Where("pending_agent_tasks.id = ?", controlID).Clauses(clause.Locking{Strength: "UPDATE"}).Take(&task).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errcode.AgentTaskNotFound
			}
			return err
		}
		if task.CancelRequestedAt == nil || task.EdgeRunID != ack.RunID {
			return errcode.ErrBadRequest
		}
		if task.CancelAppliedAt != nil {
			return nil
		}
		now := time.Now().UTC()
		if ack.Status == "failed" {
			// Do not put raw executor errors in a public task response.
			return tx.Model(&task).Update("cancel_error", "executor could not apply cancellation").Error
		}
		updates := map[string]any{"cancel_applied_at": now, "cancel_error": ""}
		// A completed result wins a cancellation race. A fail callback caused
		// by context cancellation may arrive before this applied receipt.
		if task.Status == "queued" || task.Status == "dispatched" || task.Status == "running" || task.Status == "failed" || task.Status == "timeout" {
			updates["status"], updates["finished_at"], updates["error_message"] = model.TaskStatusCancelled, now, ""
		}
		if err := tx.Model(&task).Updates(updates).Error; err != nil {
			return err
		}
		return tx.Model(&outboxRow{}).Where("task_id = ? AND transport = 'edge_poll' AND status IN ?", task.ID, []string{"pending", "sent", "retrying"}).Updates(map[string]any{"status": "delivered", "delivered_at": now, "updated_at": now, "next_retry_at": nil}).Error
	})
}

// RequestCancel persists intent even for an offline/revoked device. It never
// claims that a process stopped just because the Hub accepted this request.
func (s *Service) RequestCancel(ctx context.Context, userID, taskID string) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var task model.PendingAgentTask
		if err := tx.Where("id = ? AND triggered_by_user_id = ?", taskID, userID).Clauses(clause.Locking{Strength: "UPDATE"}).Take(&task).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errcode.AgentTaskNotFound
			}
			return err
		}
		var count int64
		if err := tx.Model(&outboxRow{}).Where("task_id = ? AND edge_device_id = ? AND transport = 'edge_poll'", task.ID, task.EdgeDeviceID).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			return errcode.AgentTaskNotFound
		}
		if task.CancelRequestedAt != nil {
			return nil
		}
		if err := dispatch.CancelTaskTerminalError(task.Status); err != nil {
			return err
		}
		now := time.Now().UTC()
		if err := tx.Model(&task).Updates(map[string]any{"cancel_requested_at": now, "cancel_error": ""}).Error; err != nil {
			return err
		}
		// A delivery may already be leased. Make cancellation visible to the
		// next poll immediately while the task lock serializes claim/cancel.
		return tx.Model(&outboxRow{}).Where("task_id = ? AND transport = 'edge_poll'", task.ID).Update("next_retry_at", nil).Error
	})
}
