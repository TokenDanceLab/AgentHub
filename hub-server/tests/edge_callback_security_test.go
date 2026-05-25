package tests

import (
	"os"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/pkg/uuidv7"
)

const (
	edgeDeviceA = "11111111-1111-4111-8111-111111111111"
	edgeDeviceB = "22222222-2222-4222-8222-222222222222"
)

func TestEdgeTaskCallbacksRejectWrongDesktopDevice(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	alice := register(t, "tedgedev1", "pass1234", "EdgeDevice")
	deviceAToken := mintDesktopToken(t, alice.ID, edgeDeviceA)
	deviceBToken := mintDesktopToken(t, alice.ID, edgeDeviceB)

	task := seedEdgeCallbackTask(t, alice.ID, model.TaskStatusDispatched, edgeDeviceA, "")

	wrongDeviceAck := parse(postAuth("/edge/agent-tasks/"+task.ID+"/ack", deviceBToken, map[string]string{
		"run_id": "run-edge-1",
	}))
	mustCode(t, wrongDeviceAck, "AGENT_TASK_NOT_FOUND", "wrong device ack")

	okAck := parse(postAuth("/edge/agent-tasks/"+task.ID+"/ack", deviceAToken, map[string]string{
		"run_id": "run-edge-1",
	}))
	mustOK(t, okAck, "right device ack")

	for _, tc := range []struct {
		name string
		path string
		body map[string]string
	}{
		{
			name: "stream",
			path: "/edge/agent-tasks/" + task.ID + "/stream",
			body: map[string]string{"content": "partial", "run_id": "run-edge-1"},
		},
		{
			name: "done",
			path: "/edge/agent-tasks/" + task.ID + "/done",
			body: map[string]string{"final_content": "final", "run_id": "run-edge-1"},
		},
		{
			name: "fail",
			path: "/edge/agent-tasks/" + task.ID + "/fail",
			body: map[string]string{"error": "failed", "run_id": "run-edge-1"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := parse(postAuth(tc.path, deviceBToken, tc.body))
			mustCode(t, r, "AGENT_TASK_NOT_FOUND", "wrong device "+tc.name)
		})
	}
}

func TestEdgeTaskCallbacksRejectWrongRunID(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	alice := register(t, "tedgerun1", "pass1234", "EdgeRun")
	deviceAToken := mintDesktopToken(t, alice.ID, edgeDeviceA)

	task := seedEdgeCallbackTask(t, alice.ID, model.TaskStatusRunning, edgeDeviceA, "run-good")

	for _, tc := range []struct {
		name string
		path string
		body map[string]string
	}{
		{
			name: "stream",
			path: "/edge/agent-tasks/" + task.ID + "/stream",
			body: map[string]string{"content": "partial", "run_id": "run-other"},
		},
		{
			name: "done",
			path: "/edge/agent-tasks/" + task.ID + "/done",
			body: map[string]string{"final_content": "final", "run_id": "run-other"},
		},
		{
			name: "fail",
			path: "/edge/agent-tasks/" + task.ID + "/fail",
			body: map[string]string{"error": "failed", "run_id": "run-other"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := parse(postAuth(tc.path, deviceAToken, tc.body))
			mustCode(t, r, "BAD_REQUEST", "wrong run "+tc.name)
		})
	}
}

func mintDesktopToken(t *testing.T, userID, deviceID string) string {
	t.Helper()
	token, err := jwtutil.GenerateAccessToken(
		userID,
		"desktop",
		deviceID,
		os.Getenv("AGENTHUB_JWT_SECRET"),
		15*time.Minute,
	)
	if err != nil {
		t.Fatalf("mint desktop token: %v", err)
	}
	return token
}

func seedEdgeCallbackTask(t *testing.T, userID, status, edgeDeviceID, edgeRunID string) *model.PendingAgentTask {
	t.Helper()
	ownerID := userID
	session := &model.Session{
		Type:        model.SessionTypeGroup,
		Name:        "Edge callback security",
		OwnerUserID: &ownerID,
	}
	if err := repository.CreateSession(db, session); err != nil {
		t.Fatalf("create session: %v", err)
	}
	if err := repository.CreateSessionMember(db, &model.SessionMember{
		SessionID:  session.ID,
		MemberType: model.MemberTypeUser,
		MemberID:   userID,
		Role:       model.MemberRoleOwner,
	}); err != nil {
		t.Fatalf("create user member: %v", err)
	}

	agent := &model.AgentInstance{
		AgentType:     "claude-code",
		SessionID:     session.ID,
		InviterUserID: userID,
		DisplayName:   "Claude",
	}
	if err := repository.CreateAgentInstance(db, agent); err != nil {
		t.Fatalf("create agent: %v", err)
	}
	if err := repository.CreateSessionMember(db, &model.SessionMember{
		SessionID:  session.ID,
		MemberType: model.MemberTypeAgent,
		MemberID:   agent.ID,
		Role:       model.MemberRoleMember,
	}); err != nil {
		t.Fatalf("create agent member: %v", err)
	}

	msg := &model.Message{
		SessionID:   session.ID,
		SeqID:       1,
		ClientMsgID: uuidv7.Must(),
		SenderType:  model.SenderTypeUser,
		SenderID:    userID,
		ContentType: model.ContentTypeText,
		Content:     `{"text":"@Claude help"}`,
	}
	if err := repository.InsertMessage(db, msg); err != nil {
		t.Fatalf("insert trigger message: %v", err)
	}

	task := &model.PendingAgentTask{
		AgentInstanceID:   agent.ID,
		TriggeredByUserID: userID,
		TriggerMessageID:  msg.ID,
		Status:            status,
		EdgeDeviceID:      edgeDeviceID,
		EdgeRunID:         edgeRunID,
		ExpireAt:          time.Now().Add(time.Hour),
	}
	if err := repository.CreatePendingTask(db, task); err != nil {
		t.Fatalf("create pending task: %v", err)
	}
	return task
}
