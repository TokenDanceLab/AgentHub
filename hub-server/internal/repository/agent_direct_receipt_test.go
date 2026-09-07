package repository

import (
	"errors"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/model"
	"gorm.io/gorm"
)

func TestRecordPendingTaskDirectReceiptPreservesProgressAndBinding(t *testing.T) {
	for _, status := range []string{model.TaskStatusQueued, model.TaskStatusDispatched, model.TaskStatusRunning, model.TaskStatusDone, model.TaskStatusFailed} {
		t.Run(status, func(t *testing.T) {
			db := setupSQLite(t)
			task := model.PendingAgentTask{ID: "receipt-task", AgentInstanceID: "agent-1", TriggeredByUserID: "user-1", TriggerMessageID: "msg-1", Status: status, ExpireAt: time.Now().Add(time.Hour)}
			if err := db.Create(&task).Error; err != nil {
				t.Fatal(err)
			}
			for n := 0; n < 2; n++ {
				if err := RecordPendingTaskDirectReceipt(db, task.ID, "actual-edge-device", "actual-run"); err != nil {
					t.Fatal(err)
				}
			}
			got, err := GetPendingTaskByID(db, task.ID)
			if err != nil {
				t.Fatal(err)
			}
			wantStatus := status
			if status == model.TaskStatusQueued {
				wantStatus = model.TaskStatusDispatched
			}
			if got.Status != wantStatus || got.EdgeDeviceID != "actual-edge-device" || got.EdgeRunID != "actual-run" {
				t.Fatalf("receipt changed execution state or identity: %#v", got)
			}
			if err := RecordPendingTaskDirectReceipt(db, task.ID, "different-device", "actual-run"); !errors.Is(err, gorm.ErrRecordNotFound) {
				t.Fatalf("device conflict accepted: %v", err)
			}
			if err := RecordPendingTaskDirectReceipt(db, task.ID, "actual-edge-device", "different-run"); !errors.Is(err, gorm.ErrRecordNotFound) {
				t.Fatalf("run conflict accepted: %v", err)
			}
		})
	}
}
