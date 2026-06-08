package tests

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/agenthub/hub-server/internal/model"
)

func TestBackendE2E_HubEdgeCallbackContract_DBWS_NoCLI(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })

	alice := register(t, "te2e_hub_edge_contract_no_cli", "pass1234", "Hub Edge Contract")
	edgeDeviceID := "33333333-3333-4333-8333-333333330608"
	desktopToken := mintDesktopToken(t, alice.ID, edgeDeviceID)

	mustOK(t, parse(postAuth("/edge/devices/register", desktopToken, map[string]interface{}{
		"device_id":    edgeDeviceID,
		"app_version":  "contract-test",
		"capabilities": []string{"codex", "process-executor"},
	})), "register desktop edge device")

	task := seedEdgeCallbackTask(t, alice.ID, model.TaskStatusDispatched, edgeDeviceID, "")
	var agent model.AgentInstance
	if err := db.Select("id", "session_id").Where("id = ?", task.AgentInstanceID).First(&agent).Error; err != nil {
		t.Fatalf("load seeded agent: %v", err)
	}
	if err := testCacheClient.InitSeqIfAbsent(context.Background(), agent.SessionID, 1); err != nil {
		t.Fatalf("initialize session seq in redis: %v", err)
	}
	if err := db.Model(&model.Session{}).Where("id = ?", agent.SessionID).Update("next_seq", 1).Error; err != nil {
		t.Fatalf("initialize session seq in db: %v", err)
	}
	edgeRunID := "run-contract-no-cli-0608"

	mustOK(t, parse(postAuth("/edge/agent-tasks/"+task.ID+"/ack", desktopToken, map[string]string{
		"run_id": edgeRunID,
	})), "ack task")

	mustOK(t, parse(postAuth("/edge/agent-tasks/"+task.ID+"/stream", desktopToken, map[string]interface{}{
		"run_id":     edgeRunID,
		"event_type": model.RunEventTypeOutputBatch,
		"payload": map[string]interface{}{
			"type":    model.RunEventTypeOutputBatch,
			"content": "contract stream chunk",
		},
	})), "stream task output")

	finalContent := `{"text":"Hub Edge callback contract final"}`
	mustOK(t, parse(postAuth("/edge/agent-tasks/"+task.ID+"/done", desktopToken, map[string]string{
		"run_id":        edgeRunID,
		"final_content": finalContent,
	})), "done task")

	var storedTask model.PendingAgentTask
	if err := db.Where("id = ?", task.ID).First(&storedTask).Error; err != nil {
		t.Fatalf("load pending task: %v", err)
	}
	if storedTask.Status != model.TaskStatusDone {
		t.Fatalf("task status = %q, want %q", storedTask.Status, model.TaskStatusDone)
	}
	if storedTask.EdgeDeviceID != edgeDeviceID {
		t.Fatalf("task edge_device_id = %q, want %q", storedTask.EdgeDeviceID, edgeDeviceID)
	}
	if storedTask.EdgeRunID != edgeRunID {
		t.Fatalf("task edge_run_id = %q, want %q", storedTask.EdgeRunID, edgeRunID)
	}
	if storedTask.FinishedAt == nil {
		t.Fatal("task finished_at was not set")
	}

	var events []model.AgentRunEvent
	if err := db.Where("task_id = ?", task.ID).Order("event_seq ASC").Find(&events).Error; err != nil {
		t.Fatalf("load agent run events: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("agent run events len = %d, want 1: %#v", len(events), events)
	}
	event := events[0]
	if event.EdgeRunID != edgeRunID {
		t.Fatalf("event edge_run_id = %q, want %q", event.EdgeRunID, edgeRunID)
	}
	if event.EventSeq != 1 {
		t.Fatalf("event_seq = %d, want 1", event.EventSeq)
	}
	if event.EventType != model.RunEventTypeOutputBatch {
		t.Fatalf("event_type = %q, want %q", event.EventType, model.RunEventTypeOutputBatch)
	}
	var eventPayload map[string]interface{}
	if err := json.Unmarshal([]byte(event.Payload), &eventPayload); err != nil {
		t.Fatalf("decode event payload: %v", err)
	}
	if got, _ := eventPayload["content"].(string); got != "contract stream chunk" {
		t.Fatalf("event payload content = %q, want contract stream chunk", got)
	}

	var finalMessage model.Message
	if err := db.Where("session_id = ? AND sender_type = ? AND sender_id = ? AND content = ?", agent.SessionID, model.SenderTypeAgent, task.AgentInstanceID, finalContent).
		Order("seq_id DESC").
		First(&finalMessage).Error; err != nil {
		t.Fatalf("load final agent message: %v", err)
	}
	if finalMessage.ContentType != model.ContentTypeText {
		t.Fatalf("final message content_type = %q, want %q", finalMessage.ContentType, model.ContentTypeText)
	}
	var finalPayload map[string]string
	if err := json.Unmarshal([]byte(finalMessage.Content), &finalPayload); err != nil {
		t.Fatalf("decode final message content: %v", err)
	}
	if finalPayload["text"] != "Hub Edge callback contract final" {
		t.Fatalf("final message text = %q, want Hub Edge callback contract final", finalPayload["text"])
	}
}
