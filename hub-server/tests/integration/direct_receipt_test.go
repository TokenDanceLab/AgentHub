//go:build integration

package integration

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// Use the migrated PostgreSQL UUID column: SQLite text fixtures cannot catch
// comparisons that accidentally coerce an empty string to a UUID.
func TestDirectReceiptPostgresIdentityAndLateCallbacks(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	owner := register(t, "directreceipt2350", "pass1234", "DirectReceipt")
	ownerToken := mintDesktopToken(t, owner.ID, edgeDeviceA)
	otherToken := mintDesktopToken(t, owner.ID, edgeDeviceB)
	mustOK(t, parse(postAuth("/edge/devices/register", ownerToken, map[string]interface{}{
		"device_id": edgeDeviceA, "app_version": "direct-receipt-fixture", "capabilities": []string{"codex"},
	})), "register direct callback device")
	task := seedEdgeCallbackTask(t, owner.ID, model.TaskStatusQueued, "", "")
	var seededAgent model.AgentInstance
	require.NoError(t, db.Select("id", "session_id").Where("id = ?", task.AgentInstanceID).First(&seededAgent).Error)
	require.NoError(t, testCacheClient.InitSeqIfAbsent(context.Background(), seededAgent.SessionID, 1))
	require.NoError(t, db.Model(&model.Session{}).Where("id = ?", seededAgent.SessionID).Update("next_seq", 1).Error)
	const runID = "direct-receipt-run"

	owned, err := repository.DirectCallbackDeviceMatchesTask(db, task.ID, edgeDeviceA)
	require.NoError(t, err)
	require.True(t, owned)
	require.NoError(t, repository.ReservePendingTaskDirectDevice(db, task.ID, edgeDeviceA))
	require.ErrorIs(t, repository.ReservePendingTaskDirectDevice(db, task.ID, edgeDeviceB), gorm.ErrRecordNotFound)
	require.NoError(t, repository.RecordPendingTaskDirectReceipt(db, task.ID, edgeDeviceA, runID))
	stored, err := repository.GetPendingTaskByID(db, task.ID)
	require.NoError(t, err)
	require.Equal(t, model.TaskStatusDispatched, stored.Status)
	require.Equal(t, edgeDeviceA, stored.EdgeDeviceID)
	require.Equal(t, runID, stored.EdgeRunID)

	mustCode(t, parse(postAuth("/edge/agent-tasks/"+task.ID+"/ack", otherToken,
		map[string]string{"run_id": runID})), "agent_task_not_found", "wrong callback device")
	mustOK(t, parse(postAuth("/edge/agent-tasks/"+task.ID+"/ack", ownerToken,
		map[string]string{"run_id": runID})), "direct owner ack")
	require.NoError(t, repository.RecordPendingTaskDirectReceipt(db, task.ID, edgeDeviceA, runID))
	stored, err = repository.GetPendingTaskByID(db, task.ID)
	require.NoError(t, err)
	require.Equal(t, model.TaskStatusRunning, stored.Status, "late HTTP receipt must not undo the ACK")

	mustOK(t, parse(postAuth("/edge/agent-tasks/"+task.ID+"/done", ownerToken,
		map[string]string{"run_id": runID, "final_content": "Complete."})), "direct owner done")
	require.NoError(t, repository.RecordPendingTaskDirectReceipt(db, task.ID, edgeDeviceA, runID))
	stored, err = repository.GetPendingTaskByID(db, task.ID)
	require.NoError(t, err)
	require.Equal(t, model.TaskStatusDone, stored.Status, "late HTTP receipt must not undo completion")
	require.ErrorIs(t, repository.RecordPendingTaskDirectReceipt(db, task.ID, edgeDeviceB, runID), gorm.ErrRecordNotFound)
	require.ErrorIs(t, repository.RecordPendingTaskDirectReceipt(db, task.ID, edgeDeviceA, "other-run"), gorm.ErrRecordNotFound)
}
