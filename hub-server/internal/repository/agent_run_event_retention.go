package repository

import (
	"fmt"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

// TerminalTaskStatuses mirrors dispatch.IsTerminalTaskStatus. Duplicated here
// to avoid importing the service/dispatch package from repository (layering).
// Keep in sync with model.TaskStatus* terminal constants.
var TerminalTaskStatuses = []string{
	model.TaskStatusDone,
	model.TaskStatusFailed,
	model.TaskStatusCancelled,
	model.TaskStatusTimeout,
}

// AgentRunEventRetentionResult reports what a retention pass did.
type AgentRunEventRetentionResult struct {
	DeletedRows    int64
	AffectedTasks  int64
	SkippedNonTerm int64 // tasks seen but not terminal (for observability only)
}

// PurgeTerminalRunEvents enforces the agent_run_events retention policy:
// for each terminal task whose finished_at is older than cutoff, delete all
// events except the most recent keepTail rows (ordered by event_seq desc).
// Non-terminal tasks are never touched. Returns aggregate counts.
//
// Implementation uses a single DELETE with a correlated subquery so the
// operation is atomic and requires no per-task round-trips. SQLite and
// Postgres both support the required syntax.
func PurgeTerminalRunEvents(db *gorm.DB, cutoff time.Time, keepTail int64) (AgentRunEventRetentionResult, error) {
	if keepTail < 0 {
		return AgentRunEventRetentionResult{}, fmt.Errorf("keepTail must be >= 0")
	}

	// Step 1: count affected terminal tasks (observability; cheap).
	var affected int64
	if err := db.Model(&model.PendingAgentTask{}).
		Where("status IN ? AND finished_at IS NOT NULL AND finished_at <= ?", TerminalTaskStatuses, cutoff).
		Count(&affected).Error; err != nil {
		return AgentRunEventRetentionResult{}, fmt.Errorf("count affected tasks: %w", err)
	}
	if affected == 0 {
		return AgentRunEventRetentionResult{AffectedTasks: 0, DeletedRows: 0}, nil
	}

	// Step 2: delete events past the tail window for qualifying terminal tasks.
	// The subquery selects the (task_id, event_seq) threshold: for each
	// terminal task with finished_at <= cutoff, find the event_seq of the
	// keepTail-th newest event. Events with seq strictly less than that
	// threshold are eligible for deletion. When a task has fewer than
	// keepTail events, the subquery returns NULL and the row is kept.
	sql := `DELETE FROM agent_run_events
WHERE id IN (
    SELECT e.id
    FROM agent_run_events e
    JOIN pending_agent_tasks t ON t.id = e.task_id
    WHERE t.status IN (?)
      AND t.finished_at IS NOT NULL
      AND t.finished_at <= ?
      AND e.event_seq <= (
          SELECT COALESCE(
              (SELECT ee.event_seq
               FROM agent_run_events ee
               WHERE ee.task_id = e.task_id
               ORDER BY ee.event_seq DESC
               LIMIT 1 OFFSET ?),
              -1
          )
      )
)`
	res := db.Exec(sql, TerminalTaskStatuses, cutoff, keepTail)
	if res.Error != nil {
		return AgentRunEventRetentionResult{}, fmt.Errorf("purge terminal run events: %w", res.Error)
	}
	return AgentRunEventRetentionResult{
		DeletedRows:   res.RowsAffected,
		AffectedTasks: affected,
	}, nil
}
