package agent

import (
	"context"
	"testing"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

func TestDirectReceiptRealDeviceAllowsOwnerCallback(t *testing.T) {
	db, _ := newStreamPerfTestDB(t)
	if err := db.Model(&model.PendingAgentTask{}).Where("id = ?", "task-1").Updates(map[string]any{"status": model.TaskStatusQueued, "edge_device_id": nil, "edge_run_id": ""}).Error; err != nil {
		t.Fatal(err)
	}
	if err := repository.RecordPendingTaskDirectReceipt(db, "task-1", "real-edge-device", "direct-run"); err != nil {
		t.Fatal(err)
	}
	svc := &Service{db: db}
	if err := svc.HandleTaskAck(context.Background(), "user-1", "real-edge-device", "task-1", "direct-run"); err != nil {
		t.Fatalf("legitimate Edge callback rejected after direct receipt: %v", err)
	}
	if err := svc.HandleTaskAck(context.Background(), "user-1", "other-device", "task-1", "direct-run"); err == nil {
		t.Fatal("unbound callback device was allowed")
	}
	// A late repeat of the HTTP receipt cannot downgrade the callback's progress.
	if err := repository.RecordPendingTaskDirectReceipt(db, "task-1", "real-edge-device", "direct-run"); err != nil {
		t.Fatal(err)
	}
	task, err := repository.GetPendingTaskByID(db, "task-1")
	if err != nil {
		t.Fatal(err)
	}
	if task.Status != model.TaskStatusRunning {
		t.Fatalf("late HTTP receipt downgraded ACK: %#v", task)
	}
}
