package repository

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
)

var ErrRunEventLimitExceeded = errors.New("run event limit exceeded for task")

// ErrTurnInProgressActive signals that a CreatePendingTaskUnlessActive call
// found an existing non-terminal task for the same agent instance. The service
// maps it to errcode.TurnInProgress (HTTP 409) so the frontend can recover
// (keep draft / optimistic message) instead of showing a hard error (#1430).
var ErrTurnInProgressActive = errors.New("active task already exists for agent instance")

// maxAgentEventsPerQuery caps the number of agent run events returned per query
// to prevent unbounded memory consumption on tasks with many events.
const maxAgentEventsPerQuery = 2000

func CreateAgentInstance(db *gorm.DB, ai *model.AgentInstance) error {
	return db.Create(ai).Error
}

func GetAgentInstanceByID(db *gorm.DB, id string) (*model.AgentInstance, error) {
	var ai model.AgentInstance
	err := db.Where("id = ?", id).First(&ai).Error
	return &ai, err
}

func ListAgentInstancesBySession(db *gorm.DB, sessionID string) ([]model.AgentInstance, error) {
	var agents []model.AgentInstance
	err := db.Where("session_id = ?", sessionID).Limit(200).Find(&agents).Error
	return agents, err
}

func ListAgentInstancesByInviter(db *gorm.DB, sessionID, inviterID string) ([]model.AgentInstance, error) {
	var agents []model.AgentInstance
	err := db.Where("session_id = ? AND inviter_user_id = ?", sessionID, inviterID).Find(&agents).Error
	return agents, err
}

// ListAgentInstancesByInviterPage is the paginated variant of ListAgentInstancesByInviter.
// It returns up to `limit` rows starting at `offset`. Used by cleanup loops that must
// process all agents even when a single inviter added more than the default page size.
func ListAgentInstancesByInviterPage(db *gorm.DB, sessionID, inviterID string, limit, offset int) ([]model.AgentInstance, error) {
	var agents []model.AgentInstance
	err := db.Where("session_id = ? AND inviter_user_id = ?", sessionID, inviterID).
		Limit(limit).Offset(offset).Find(&agents).Error
	return agents, err
}

func DeleteAgentInstance(db *gorm.DB, agentID string) error {
	return db.Where("id = ?", agentID).Delete(&model.AgentInstance{}).Error
}

func CreateCustomAgent(db *gorm.DB, ca *model.CustomAgent) error {
	return db.Create(ca).Error
}

func GetCustomAgentByID(db *gorm.DB, id string) (*model.CustomAgent, error) {
	var ca model.CustomAgent
	err := db.Where("id = ? AND deleted_at IS NULL", id).First(&ca).Error
	return &ca, err
}

func ListCustomAgentsByOwner(db *gorm.DB, ownerID string) ([]model.CustomAgent, error) {
	var agents []model.CustomAgent
	err := db.Where("owner_user_id = ? AND deleted_at IS NULL", ownerID).
		Order("created_at DESC").
		Limit(config.MaxPageLimit). // #2136 P0: was unbounded
		Find(&agents).Error
	return agents, err
}

// UpdateCustomAgent persists the columns that PUT /web/custom-agents/:id can
// actually change, and only those.
//
// There is deliberately no whole-row update for custom agents, for the same
// reason UpdateSessionColumns exists for sessions (#2233). handler.Update builds
// its model.CustomAgent from updateCustomAgentReq, which carries neither
// output_schema nor deleted_at, so the previous `db.Save(ca)` wrote NULL over
// both on every rename — and Save writes ALL columns, which this repo already
// documents on UpdateAgentProfile's `Select("*") + Updates(p)`.
//
//   - output_schema is live: service/dispatch/payload.go copies it into the edge
//     dispatch payload as structured_output_schema, so editing an agent's name
//     silently switched structured output off for that agent (#2253). HTTP 200,
//     no signal anywhere.
//   - deleted_at has an independent narrow writer, SoftDeleteCustomAgent below.
//     model.CustomAgent.DeletedAt is *time.Time, not gorm.DeletedAt, so there is
//     no soft-delete scope to catch it: a delete landing between the service's
//     GetCustomAgentByID read and this write was undone and the row came back.
//     Save also falls back to Create-with-OnConflict when its UPDATE matches
//     zero rows, so updating a nonexistent id used to insert a fresh agent.
//
// The column list is exactly updateCustomAgentReq's field set — name,
// avatar_url, agent_type, system_prompt, capability_tags, tool_whitelist,
// model_params — i.e. every field the request can change and nothing it cannot.
// Columns deliberately NOT written: id (the key), owner_user_id (the service
// verifies ownership, it never reassigns it), created_at (immutable), and
// output_schema / deleted_at (above). updated_at is not listed either: GORM
// appends autoUpdateTime fields to the SET clause even when they are absent from
// Select (callbacks.ConvertToAssignments), pinned by
// TestUpdateCustomAgent_RefreshesUpdatedAtAndMatchesUnchangedRows.
//
// The not-deleted check is part of the statement, not a separate read, so a row
// soft-deleted after the caller's read matches zero rows. RowsAffected counts
// matched rows on both PostgreSQL and SQLite, so 0 can only mean "no such live
// row" and is reported as gorm.ErrRecordNotFound — the service maps that to
// errcode.AgentNotFound (HTTP 404) exactly like the read path does.
//
// db.Model(ca) rather than db.Model(&model.CustomAgent{}) so that
// Statement.Model == Statement.Dest: GORM then runs model.CustomAgent's
// BeforeSave hook against the caller's struct and ConvertToAssignments reads the
// hook's normalized jsonb values, preserving the compaction and validation that
// `db.Save(ca)` used to perform. An empty model instance would run the hook
// against zero values instead.
func UpdateCustomAgent(db *gorm.DB, ca *model.CustomAgent) error {
	result := db.Model(ca).
		Where("id = ? AND deleted_at IS NULL", ca.ID).
		Select(
			"name",
			"avatar_url",
			"agent_type",
			"system_prompt",
			"capability_tags",
			"tool_whitelist",
			"model_params",
		).
		Updates(ca)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func SoftDeleteCustomAgent(db *gorm.DB, id string) error {
	now := time.Now()
	return db.Model(&model.CustomAgent{}).Where("id = ?", id).Update("deleted_at", now).Error
}

// PendingAgentTask

func CreatePendingTask(db *gorm.DB, task *model.PendingAgentTask) error {
	return db.Create(task).Error
}

func GetPendingTaskByID(db *gorm.DB, id string) (*model.PendingAgentTask, error) {
	var task model.PendingAgentTask
	err := db.Where("id = ?", id).First(&task).Error
	return &task, err
}

func ListPendingTasksByIDs(db *gorm.DB, ids []string) ([]model.PendingAgentTask, error) {
	var tasks []model.PendingAgentTask
	if len(ids) == 0 {
		return tasks, nil
	}
	err := db.Where("id IN ?", ids).Find(&tasks).Error
	return tasks, err
}

func UpdatePendingTaskStatus(db *gorm.DB, id, status, errMsg string) error {
	return UpdatePendingTaskStatusWithEdgeRunID(db, id, status, errMsg, "")
}

func UpdatePendingTaskDispatched(db *gorm.DB, id, edgeDeviceID string) error {
	now := time.Now()
	updates := map[string]interface{}{
		"status":        model.TaskStatusDispatched,
		"dispatched_at": &now,
	}
	if edgeDeviceID != "" {
		updates["edge_device_id"] = edgeDeviceID
	}
	result := db.Model(&model.PendingAgentTask{}).
		Where("id = ? AND status IN ?", id, []string{model.TaskStatusQueued, model.TaskStatusDispatched}).
		Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func UpdatePendingTaskStatusWithEdgeRunID(db *gorm.DB, id, status, errMsg, edgeRunID string) error {
	updates := map[string]interface{}{"status": status}
	if status == model.TaskStatusDispatched {
		now := time.Now()
		updates["dispatched_at"] = &now
	}
	if status == model.TaskStatusDone || status == model.TaskStatusFailed || status == model.TaskStatusCancelled || status == model.TaskStatusTimeout {
		now := time.Now()
		updates["finished_at"] = &now
	}
	if errMsg != "" {
		updates["error_message"] = errMsg
	}
	if edgeRunID != "" {
		updates["edge_run_id"] = edgeRunID
	}
	return db.Model(&model.PendingAgentTask{}).Where("id = ?", id).Updates(updates).Error
}

// UpdatePendingTaskStatusAtomic updates a task's status only when the current
// status matches oldStatus (atomic compare-and-swap). Returns the number of
// rows affected (0 means a concurrent write won).
func UpdatePendingTaskStatusAtomic(db *gorm.DB, id, oldStatus, newStatus, errMsg string) (int64, error) {
	updates := map[string]interface{}{"status": newStatus}
	if newStatus == model.TaskStatusDispatched {
		now := time.Now()
		updates["dispatched_at"] = &now
	}
	if newStatus == model.TaskStatusDone || newStatus == model.TaskStatusFailed ||
		newStatus == model.TaskStatusCancelled || newStatus == model.TaskStatusTimeout {
		now := time.Now()
		updates["finished_at"] = &now
	}
	if errMsg != "" {
		updates["error_message"] = errMsg
	}
	result := db.Model(&model.PendingAgentTask{}).
		Where("id = ? AND status = ?", id, oldStatus).
		Updates(updates)
	return result.RowsAffected, result.Error
}

// UpdatePendingTaskStatusAtomicWithEdgeRunID is the atomic variant that also
// sets edge_run_id.
func UpdatePendingTaskStatusAtomicWithEdgeRunID(db *gorm.DB, id, oldStatus, newStatus, errMsg, edgeRunID string) (int64, error) {
	updates := map[string]interface{}{"status": newStatus}
	if newStatus == model.TaskStatusDispatched {
		now := time.Now()
		updates["dispatched_at"] = &now
	}
	if newStatus == model.TaskStatusDone || newStatus == model.TaskStatusFailed ||
		newStatus == model.TaskStatusCancelled || newStatus == model.TaskStatusTimeout {
		now := time.Now()
		updates["finished_at"] = &now
	}
	if errMsg != "" {
		updates["error_message"] = errMsg
	}
	if edgeRunID != "" {
		updates["edge_run_id"] = edgeRunID
	}
	result := db.Model(&model.PendingAgentTask{}).
		Where("id = ? AND status = ?", id, oldStatus).
		Updates(updates)
	return result.RowsAffected, result.Error
}

// UpdatePendingTaskEdgeRunID sets the edge_run_id on a running task that has an
// empty edge_run_id. RowsAffected is 0 when a concurrent callback won the race.
func UpdatePendingTaskEdgeRunID(db *gorm.DB, id, edgeRunID string) (int64, error) {
	result := db.Model(&model.PendingAgentTask{}).
		Where("id = ? AND status = ? AND edge_run_id = ?", id, model.TaskStatusRunning, "").
		Update("edge_run_id", edgeRunID)
	return result.RowsAffected, result.Error
}

func ScanExpiredTasks(db *gorm.DB) ([]model.PendingAgentTask, error) {
	var tasks []model.PendingAgentTask
	err := db.Where("expire_at < ? AND status IN ?", time.Now(), []string{model.TaskStatusQueued, model.TaskStatusDispatched, model.TaskStatusRunning}).Limit(1000).Find(&tasks).Error
	return tasks, err
}

func CancelTasksByAgentInstance(db *gorm.DB, agentInstanceID string) error {
	now := time.Now()
	return db.Model(&model.PendingAgentTask{}).
		Where("agent_instance_id = ? AND status IN ?", agentInstanceID, []string{model.TaskStatusQueued, model.TaskStatusDispatched, model.TaskStatusRunning}).
		Updates(map[string]interface{}{"status": model.TaskStatusCancelled, "finished_at": &now}).Error
}

// FindActivePendingTaskByAgentInstance returns the most recent non-terminal
// (queued/dispatched/running) pending task for the given agent instance, or
// gorm.ErrRecordNotFound when none is active. Used by the TurnInProgress gate
// in TriggerAgentTask (#1430).
func FindActivePendingTaskByAgentInstance(db *gorm.DB, agentInstanceID string) (*model.PendingAgentTask, error) {
	var task model.PendingAgentTask
	err := db.Where("agent_instance_id = ? AND status IN ?", agentInstanceID,
		[]string{model.TaskStatusQueued, model.TaskStatusDispatched, model.TaskStatusRunning},
	).Order("created_at DESC").First(&task).Error
	return &task, err
}

// LockAgentInstanceForUpdate serializes concurrent TriggerAgentTask calls for
// one agent instance (per-agent_instance mutex, #1430). PostgreSQL uses a
// row-level FOR UPDATE lock; the SQLite fallback performs a no-op write so
// integration tests exercise a real write lock. Mirrors LockTeamRunForUpdate (#1383).
func LockAgentInstanceForUpdate(db *gorm.DB, agentInstanceID string) error {
	if db.Name() == "postgres" {
		var id string
		if err := db.Raw("SELECT id FROM agent_instances WHERE id = ? FOR UPDATE", agentInstanceID).Scan(&id).Error; err != nil {
			return err
		}
		if id == "" {
			return gorm.ErrRecordNotFound
		}
		return nil
	}
	result := db.Model(&model.AgentInstance{}).
		Where("id = ?", agentInstanceID).
		UpdateColumn("display_name", gorm.Expr("display_name"))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// CreatePendingTaskUnlessActive atomically creates a pending task unless the
// agent instance already has a non-terminal (queued/dispatched/running) task.
// It locks the agent_instance row, checks for an active task, and creates the
// new task inside one transaction to close the check-then-create TOCTOU window
// (#1430). On conflict it returns the existing active task and
// ErrTurnInProgressActive so the service can surface a 409 without rolling back
// the already-persisted trigger message. Granularity is per agent_instance.
func CreatePendingTaskUnlessActive(db *gorm.DB, task *model.PendingAgentTask) (*model.PendingAgentTask, error) {
	var existing model.PendingAgentTask
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := LockAgentInstanceForUpdate(tx, task.AgentInstanceID); err != nil {
			return err
		}
		active, err := FindActivePendingTaskByAgentInstance(tx, task.AgentInstanceID)
		if err == nil {
			existing = *active
			return ErrTurnInProgressActive
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		return tx.Create(task).Error
	})
	if err != nil {
		return &existing, err
	}
	return task, nil
}

// BumpRunningTaskExpireAt refreshes the expire_at deadline of a running task,
// keeping it alive while activity (stream callbacks) continues.
// #132: running tasks that stop receiving activity will be expired by the scheduler.
//
// #2154 P2-9: the write short-circuits *in SQL* instead of in Go. The callback
// fires once per streamed chunk (per token, in practice), and every one of
// those used to issue an UPDATE that rewrote expire_at to a value within a few
// hundred milliseconds of the one already stored — a guaranteed-no-op write
// that still burned a row lock and produced a dead tuple per chunk. The
// predicate now only lets the UPDATE reach the row when the stored deadline
// differs meaningfully from the one being written.
//
// Skip window and why it cannot change the liveness verdict:
//
//		skip  ⟺  newExpire - ttl/4 <= expire_at <= newExpire
//		write ⟺  expire_at < newExpire - ttl/4  OR  expire_at > newExpire
//
//	  - The upper branch (expire_at > newExpire) is load-bearing, not defensive:
//	    a task is created with expire_at = now + config.PendingTaskTTL (24h,
//	    dispatchsvc/agent_dispatch.go) and nothing narrows it until the first
//	    stream callback. A one-sided "only write when extending" predicate would
//	    therefore skip that first bump forever and silently disable the #132
//	    inactivity timeout for every running task.
//	  - The lower bound means a skipped write leaves expire_at at most ttl/4
//	    *earlier* than an unconditional bump would have, never later. So the
//	    scheduler (ScanExpiredTasks: expire_at < now) can only expire a task
//	    sooner-or-equal, never later, than before: the inactivity timeout is
//	    preserved (effective window ttl - ttl/4 .. ttl) and no task is kept alive
//	    longer than the old code kept it.
//	  - Consequence: at most one UPDATE per ttl/4 per task (2.5 min at the
//	    default RunningTaskHeartbeatTTL of 10 min) instead of one per chunk.
//
// A 0-row result is not an error — it is the intended short-circuit (and also
// what a non-running or unknown task produced before). No Go-side per-task
// timestamp map is kept, so this adds no memory-growth surface to the Hub.
func BumpRunningTaskExpireAt(db *gorm.DB, id string, ttl time.Duration) error {
	newExpire := time.Now().Add(ttl)
	skipFloor := newExpire.Add(-ttl / 4)
	return db.Model(&model.PendingAgentTask{}).
		Where("id = ? AND status = ? AND (expire_at < ? OR expire_at > ?)",
			id, model.TaskStatusRunning, skipFloor, newExpire).
		Update("expire_at", newExpire).Error
}

func CreateAgentRunEventWithNextSeq(db *gorm.DB, event *model.AgentRunEvent) error {
	return CreateAgentRunEventWithNextSeqLimited(db, event, 0)
}

func CreateAgentRunEventWithNextSeqLimited(db *gorm.DB, event *model.AgentRunEvent, maxEvents int64) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if maxEvents > 0 {
			var task model.PendingAgentTask
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Select("id").
				Where("id = ?", event.TaskID).
				First(&task).Error; err != nil {
				return err
			}
		}
		var maxSeq int64
		if err := tx.Model(&model.AgentRunEvent{}).
			Where("task_id = ?", event.TaskID).
			Select("COALESCE(MAX(event_seq), 0)").
			Scan(&maxSeq).Error; err != nil {
			return err
		}
		if maxEvents > 0 && maxSeq >= maxEvents {
			return ErrRunEventLimitExceeded
		}
		event.EventSeq = maxSeq + 1
		err := tx.Create(event).Error
		if err == nil {
			return nil
		}
		// 23500 unique-violation (concurrent insert won the race on the
		// (task_id, event_seq) unique index): requery once. If the row now
		// exists with the same task_id + event_seq, the create was idempotent
		// (a parallel writer already persisted this seq) and we return nil so
		// the caller does not surface a spurious error on a retry. This
		// mirrors the service_send.go / message-builders duplicate-key
		// idempotent handling. We only treat it as idempotent when the
		// conflicting row matches our intended (task_id, event_seq); a
		// different conflict is surfaced as a real error.
		// Single source of truth for the classification (#2244 slice 1); the
		// copy that used to live in this file is gone.
		if isUniqueViolation(err) {
			var existing model.AgentRunEvent
			if qerr := tx.Where("task_id = ? AND event_seq = ?", event.TaskID, event.EventSeq).First(&existing).Error; qerr == nil {
				// The row already exists with the same identity — idempotent
				// success. Re-populate the caller's event struct so downstream
				// logic sees the persisted values (ID, timestamps).
				*event = existing
				return nil
			}
		}
		return err
	})
}

func ListAgentRunEventsByTaskID(db *gorm.DB, taskID string) ([]model.AgentRunEvent, error) {
	return ListAgentRunEventsByTaskIDFiltered(db, taskID, model.AgentRunEventFilter{})
}

func ListAgentRunEventsByTaskIDFiltered(db *gorm.DB, taskID string, filter model.AgentRunEventFilter) ([]model.AgentRunEvent, error) {
	var events []model.AgentRunEvent
	query := db.Where("task_id = ?", taskID)
	if filter.EventType != "" {
		query = query.Where("event_type = ?", filter.EventType)
	}
	if filter.AfterSeq > 0 {
		query = query.Where("event_seq > ?", filter.AfterSeq)
	}
	if filter.Limit > 0 {
		query = query.Limit(filter.Limit)
	} else {
		query = query.Limit(maxAgentEventsPerQuery)
	}
	err := query.Order("event_seq ASC, created_at ASC, id ASC").Find(&events).Error
	return events, err
}

// maxAgentRunEventsPerBatch caps the total events returned by
// ListAgentRunEventsByTaskIDs to prevent unbounded memory consumption when
// many tasks each have many events.
const maxAgentRunEventsPerBatch = 50000

func ListAgentRunEventsByTaskIDs(db *gorm.DB, taskIDs []string) ([]model.AgentRunEvent, error) {
	var events []model.AgentRunEvent
	if len(taskIDs) == 0 {
		return events, nil
	}
	err := db.Where("task_id IN ?", taskIDs).
		Order("task_id ASC, event_seq ASC, created_at ASC, id ASC").
		Limit(maxAgentRunEventsPerBatch).
		Find(&events).Error
	return events, err
}

// ClaimOrphanedTasks atomically finds queued tasks older than the grace period
// that have no delivery_outbox row (orphaned by crash or semaphore backoff) and
// claims up to limit of them by transitioning status to 'dispatched'. The CAS
// UPDATE prevents concurrent sweepers from double-claiming. Returns the claimed
// task IDs.
func ClaimOrphanedTasks(db *gorm.DB, grace time.Time, limit int) ([]string, error) {
	if limit <= 0 {
		limit = 10
	}
	var ids []string
	err := db.Raw(`
		UPDATE pending_agent_tasks
		SET status = 'dispatched'
		WHERE id IN (
			SELECT t.id FROM pending_agent_tasks t
			WHERE t.status = 'queued'
			  AND t.created_at < ?
			  AND NOT EXISTS (
				  SELECT 1 FROM delivery_outbox d WHERE d.task_id = t.id
			  )
			LIMIT ?
		)
		RETURNING id
	`, grace, limit).Scan(&ids).Error
	return ids, err
}

// RequeueClaimedOrphanTask rolls a claimed orphan task from 'dispatched' back
// to 'queued' when redelivery-context rebuild fails, so the next sweep can
// re-claim it. The CAS predicate only touches a task still in the claimed
// state — a task that moved on (running/done/failed) is never clobbered.
// Returns whether the rollback was applied.
func RequeueClaimedOrphanTask(db *gorm.DB, taskID string) (bool, error) {
	res := db.Exec(`
		UPDATE pending_agent_tasks
		SET status = ?
		WHERE id = ? AND status = ?
	`, model.TaskStatusQueued, taskID, model.TaskStatusDispatched)
	return res.RowsAffected > 0, res.Error
}
