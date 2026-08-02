//go:build integration

package integration

import (
	"context"
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/ws"
	"github.com/coder/websocket"
	"github.com/google/uuid"
)

func TestPinAndForward(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	alice := register(t, "tpin_a", "pass1234", "AliceP")
	bob := register(t, "tpin_b", "pass1234", "BobP")

	postAuth("/client/contacts/friend-requests", alice.Token, map[string]interface{}{"friend_id": bob.ID, "message": "Hi"})
	w := get("/client/contacts/friend-requests", bob.Token)
	var arr []map[string]interface{}
	json.Unmarshal(parse(w).Data, &arr)
	if len(arr) > 0 {
		postAuth("/client/contacts/friend-requests/"+arr[0]["request_id"].(string)+"/accept", bob.Token, nil)
	}

	r := parse(postAuth("/client/sessions/private", alice.Token, map[string]string{"target_user_id": bob.ID}))
	sid := extract(r.Data, "session_id")

	// Send a message to pin
	postAuth("/client/sessions/"+sid+"/messages", alice.Token, map[string]interface{}{
		"client_msg_id": "00000000-0000-0000-0000-00000000a001",
		"content_type":  "text", "content": "Pin me!",
	})
	postAuth("/client/sessions/"+sid+"/messages", alice.Token, map[string]interface{}{
		"client_msg_id": "00000000-0000-0000-0000-00000000a002",
		"content_type":  "text", "content": "Forward me!",
	})

	hr := parse(get("/client/sessions/"+sid+"/messages?limit=2", alice.Token))
	var msgs []map[string]interface{}
	json.Unmarshal(hr.Data, &msgs)
	if len(msgs) < 2 {
		t.Fatal("need at least 2 messages")
	}
	firstID := msgs[0]["id"].(string)
	secondID := msgs[1]["id"].(string)

	t.Run("Pin", func(t *testing.T) {
		mustOK(t, parse(postAuth("/client/messages/"+firstID+"/pin", alice.Token, map[string]string{"session_id": sid})), "pin")
	})

	t.Run("ListPins", func(t *testing.T) {
		mustOK(t, parse(get("/client/sessions/"+sid+"/pins", alice.Token)), "list pins")
	})

	t.Run("Unpin", func(t *testing.T) {
		mustOK(t, parse(postAuth("/client/messages/"+firstID+"/pin", alice.Token, map[string]string{"session_id": sid})), "unpin")
	})

	t.Run("Forward", func(t *testing.T) {
		gr := parse(postAuth("/client/sessions/group", alice.Token, map[string]interface{}{
			"name": "FwdTarget", "member_ids": []string{bob.ID},
		}))
		mustOK(t, gr, "create target group")
		targetSID := extract(gr.Data, "session_id")

		mustOK(t, parse(postAuth("/client/messages/"+secondID+"/forward", alice.Token, map[string]interface{}{
			"target_session_ids": []string{targetSID},
		})), "forward")
	})

	t.Run("SearchMessages", func(t *testing.T) {
		mustOK(t, parse(get("/client/sessions/"+sid+"/messages/search?q=Pin", alice.Token)), "session msg search")
		mustOK(t, parse(get("/client/messages/search?q=Forward", alice.Token)), "global msg search")
	})
}

func TestGroupManagement(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	alice := register(t, "tgrp_a", "pass1234", "AliceG")
	bob := register(t, "tgrp_b", "pass1234", "BobG")
	charlie := register(t, "tgrp_c", "pass1234", "CharlieG")

	postAuth("/client/contacts/friend-requests", alice.Token, map[string]interface{}{"friend_id": bob.ID, "message": "Hi"})
	postAuth("/client/contacts/friend-requests", alice.Token, map[string]interface{}{"friend_id": charlie.ID, "message": "Hi"})
	for _, u := range []testUser{bob, charlie} {
		w := get("/client/contacts/friend-requests", u.Token)
		var arr []map[string]interface{}
		json.Unmarshal(parse(w).Data, &arr)
		if len(arr) > 0 {
			postAuth("/client/contacts/friend-requests/"+arr[0]["request_id"].(string)+"/accept", u.Token, nil)
		}
	}

	r := parse(postAuth("/client/sessions/group", alice.Token, map[string]interface{}{
		"name": "MgmtGroup", "member_ids": []string{bob.ID, charlie.ID},
	}))
	mustOK(t, r, "create group")
	sid := extract(r.Data, "session_id")

	t.Run("TransferOwner", func(t *testing.T) {
		mustOK(t, parse(postAuth("/client/sessions/"+sid+"/transfer-owner", alice.Token, map[string]interface{}{
			"new_owner_id": bob.ID,
		})), "transfer owner")
	})

	t.Run("OwnerCannotLeave", func(t *testing.T) {
		w := postAuth("/client/sessions/"+sid+"/leave", bob.Token, nil)
		mustCode(t, parse(w), errcode.GroupOwnerCannotLeave.Code, "owner cannot leave")
	})

	t.Run("DissolveGroup", func(t *testing.T) {
		gr := parse(postAuth("/client/sessions/group", alice.Token, map[string]interface{}{
			"name": "ToDissolve", "member_ids": []string{bob.ID},
		}))
		dsid := extract(gr.Data, "session_id")
		mustOK(t, parse(postAuth("/client/sessions/"+dsid+"/dissolve", alice.Token, nil)), "dissolve")
	})
}

func TestBlockedMessage(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	alice := register(t, "tblk_a", "pass1234", "AliceB")
	bob := register(t, "tblk_b", "pass1234", "BobB")

	postAuth("/client/contacts/friend-requests", alice.Token, map[string]interface{}{"friend_id": bob.ID, "message": "Hi"})
	w := get("/client/contacts/friend-requests", bob.Token)
	var arr []map[string]interface{}
	json.Unmarshal(parse(w).Data, &arr)
	if len(arr) > 0 {
		postAuth("/client/contacts/friend-requests/"+arr[0]["request_id"].(string)+"/accept", bob.Token, nil)
	}

	r := parse(postAuth("/client/sessions/private", alice.Token, map[string]string{"target_user_id": bob.ID}))
	sid := extract(r.Data, "session_id")

	t.Run("BlockBlocksMessages", func(t *testing.T) {
		postAuth("/client/contacts/"+alice.ID+"/block", bob.Token, nil)

		w := postAuth("/client/sessions/"+sid+"/messages", alice.Token, map[string]interface{}{
			"client_msg_id": "00000000-0000-0000-0000-00000000b001",
			"content_type":  "text", "content": "Should fail",
		})
		mustCode(t, parse(w), errcode.MsgBlockedByReceiver.Code, "blocked message rejected")

		postAuth("/client/contacts/"+alice.ID+"/unblock", bob.Token, nil)
	})
}

func TestFileUpload(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	u := register(t, "tfile1", "pass1234", "FileUser")

	t.Run("UploadSmallFile", func(t *testing.T) {
		content := []byte("hello world test file")
		hash := "f4358c219b0067f3659f3640a8abba0147ca0f1248f251b30cd2f720e09c181b"

		// Use multipart form
		body := new(bytes.Buffer)
		writer := multipart.NewWriter(body)
		writer.WriteField("hash", hash)
		writer.WriteField("original_name", "test.txt")
		part, _ := writer.CreateFormFile("file", "test.txt")
		part.Write(content)
		writer.Close()

		req, _ := http.NewRequest("POST", ts.URL+"/client/attachments", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.Header.Set("Authorization", "Bearer "+u.Token)
		resp, _ := client.Do(req)
		r := parse(resp)
		mustOK(t, r, "upload file")

		attID := extract(r.Data, "id")
		if attID == "" {
			// Data might be the attachment object directly
			var att map[string]interface{}
			json.Unmarshal(r.Data, &att)
			if id, ok := att["id"].(string); ok {
				attID = id
			}
		}

		if attID != "" {
			w := get("/client/attachments/"+attID, u.Token)
			// #81: download requires an active session message reference.
			// A bare upload without a session context must not be
			// downloadable — the handler returns 404 attach_not_found.
			if w.StatusCode != http.StatusNotFound {
				t.Errorf("unreferenced attachment download status = %d, want 404", w.StatusCode)
			}
		}
	})
}

func TestRemainingREST(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	alice := register(t, "tresta", "pass1234", "AliceR")
	bob := register(t, "trestb", "pass1234", "BobR")

	postAuth("/client/contacts/friend-requests", alice.Token, map[string]interface{}{"friend_id": bob.ID, "message": "Hi"})
	w := get("/client/contacts/friend-requests", bob.Token)
	var arr []map[string]interface{}
	json.Unmarshal(parse(w).Data, &arr)
	if len(arr) > 0 {
		postAuth("/client/contacts/friend-requests/"+arr[0]["request_id"].(string)+"/accept", bob.Token, nil)
	}

	t.Run("RejectFriendRequest", func(t *testing.T) {
		charlie := register(t, "trestc", "pass1234", "CharlieR")
		postAuth("/client/contacts/friend-requests", alice.Token, map[string]interface{}{"friend_id": charlie.ID, "message": "Hi"})
		w := get("/client/contacts/friend-requests", charlie.Token)
		var arr []map[string]interface{}
		json.Unmarshal(parse(w).Data, &arr)
		if len(arr) > 0 {
			mustOK(t, parse(postAuth("/client/contacts/friend-requests/"+arr[0]["request_id"].(string)+"/reject", charlie.Token, nil)), "reject")
		}
	})

	t.Run("RemoveContact", func(t *testing.T) {
		mustOK(t, parse(del("/client/contacts/"+bob.ID, alice.Token)), "remove contact")
	})

	postAuth("/client/contacts/friend-requests", alice.Token, map[string]interface{}{"friend_id": bob.ID, "message": "Hi2"})
	w = get("/client/contacts/friend-requests", bob.Token)
	json.Unmarshal(parse(w).Data, &arr)
	if len(arr) > 0 {
		postAuth("/client/contacts/friend-requests/"+arr[0]["request_id"].(string)+"/accept", bob.Token, nil)
	}

	gr := parse(postAuth("/client/sessions/group", alice.Token, map[string]interface{}{
		"name": "RestGroup", "member_ids": []string{bob.ID},
	}))
	sid := extract(gr.Data, "session_id")

	charlie := register(t, "trestc2", "pass1234", "Charlie2")
	postAuth("/client/contacts/friend-requests", alice.Token, map[string]interface{}{"friend_id": charlie.ID, "message": "Hi"})
	w = get("/client/contacts/friend-requests", charlie.Token)
	json.Unmarshal(parse(w).Data, &arr)
	if len(arr) > 0 {
		postAuth("/client/contacts/friend-requests/"+arr[0]["request_id"].(string)+"/accept", charlie.Token, nil)
	}

	t.Run("AddMembersToGroup", func(t *testing.T) {
		mustOK(t, parse(postAuth("/client/sessions/"+sid+"/members", alice.Token, map[string]interface{}{
			"member_ids": []string{charlie.ID},
		})), "add members")
	})

	t.Run("KickMember", func(t *testing.T) {
		mustOK(t, parse(del("/client/sessions/"+sid+"/members/"+charlie.ID, alice.Token)), "kick member")
	})

	t.Run("UpdateGroupInfo", func(t *testing.T) {
		mustOK(t, parse(put("/client/sessions/"+sid+"/info", alice.Token, map[string]string{
			"name": "UpdatedGroupName",
		})), "update group info")
	})

	t.Run("AddAgentToSession", func(t *testing.T) {
		mustOK(t, parse(postAuth("/client/sessions/"+sid+"/agents", alice.Token, map[string]interface{}{
			"agent_type": "claude-code", "display_name": "Claude",
		})), "add agent")
	})

	t.Run("MarkSingleNotifRead", func(t *testing.T) {
		notifs := parse(get("/client/notifications", alice.Token))
		var arr2 []map[string]interface{}
		json.Unmarshal(notifs.Data, &arr2)
		if len(arr2) > 0 {
			nid := arr2[0]["id"].(string)
			mustOK(t, parse(postAuth("/client/notifications/"+nid+"/read", alice.Token, nil)), "mark single read")
		}
	})
}

func TestWebSocketUpgrade(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })

	t.Run("UnauthorizedUpgradeRejected", func(t *testing.T) {
		// 无认证裸握手必须被拒绝（negative case，401 是明确预期，不是"may be expected"）。
		req, _ := http.NewRequest("GET", ts.URL+"/client/ws", nil)
		req.Header.Set("Connection", "Upgrade")
		req.Header.Set("Upgrade", "websocket")
		req.Header.Set("Sec-WebSocket-Version", "13")
		req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("ws upgrade request failed: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("unauthorized ws upgrade: got %d, want 401", resp.StatusCode)
		}
	})

	t.Run("AuthorizedUpgradeSucceeds", func(t *testing.T) {
		// 有效认证握手必须建立连接并收到 auth.ok 帧（happy path 硬断言）。
		// 走 newWSTestServer + dialWS（同包已验证路径）：该 server 同样
		// 挂 WSAuthMiddleware + ServeWS，认证/升级语义与主 server 一致。
		u := register(t, "wsupg_auth", "pass1234", "WsUpgAuth")
		manager := ws.NewManager()
		manager.StartHeartbeat(context.Background())
		defer manager.Shutdown()

		wsURL := newWSTestServer(t, manager)
		conn := dialWS(t, wsURL, u.Username)
		defer conn.Close(websocket.StatusNormalClosure, "")

		frame := readWSFrame(t, conn)
		if frame.Type != ws.TypeAuthOK {
			t.Fatalf("authorized upgrade: got frame %s, want auth.ok", frame.Type)
		}
	})
}

// TestAgentTaskCallbacks exercises the full Edge task callback state machine
// with tasks seeded directly in PostgreSQL (deterministic — no real Edge
// required): dispatched → ack(running) → stream → done; plus fail and cancel
// paths; plus not_found/bad_request negatives. Every step hard-asserts both
// the HTTP envelope and the persisted status transition.
func TestAgentTaskCallbacks(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	alice := register(t, "tagtcb1", "pass1234", "AgentT")

	// Edge callbacks require a desktop-type token (DeviceTypeCheck middleware);
	// mint it directly like TestEdgeDevice does (password login was removed in #1367).
	deskDeviceID := "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01"
	seedTestDevice(t, alice.ID, "desktop", deskDeviceID)
	deskTok, err := jwtutil.GenerateAccessToken(alice.ID, "desktop",
		deskDeviceID, testJWT.Secret, testJWT.AccessTTL)
	if err != nil {
		t.Fatalf("generate desktop token: %v", err)
	}

	// ── helpers（seed 一个真实 session + agent 实例 + 指定状态 task）──
	bob := register(t, "tagtcb2", "pass1234", "BobT")
	// privateSession 需要好友关系：先建好友（幂等）。
	postAuth("/client/contacts/friend-requests", alice.Token, map[string]interface{}{"friend_id": bob.ID, "message": "Hi"})
	w := get("/client/contacts/friend-requests", bob.Token)
	var reqs []map[string]interface{}
	json.Unmarshal(parse(w).Data, &reqs)
	for _, req := range reqs {
		if rid, ok := req["request_id"].(string); ok {
			postAuth("/client/contacts/friend-requests/"+rid+"/accept", bob.Token, nil)
		}
	}

	seedAgentAndTask := func(status string) string {
		t.Helper()
		sid := privateSession(t, alice, bob)
		// pending_agent_tasks.trigger_message_id 有 FK 到 messages：先发一条真实消息。
		msg := parse(postAuth("/client/sessions/"+sid+"/messages", alice.Token, map[string]interface{}{
			"client_msg_id": uuid.New().String(),
			"content_type":  "text",
			"content":       "seed task trigger",
		}))
		mustOK(t, msg, "seed trigger message")
		triggerMsgID := extract(msg.Data, "message_id")
		ai := &model.AgentInstance{
			AgentType:     "claude-code",
			SessionID:     sid,
			InviterUserID: alice.ID,
			DisplayName:   "Claude",
		}
		if err := db.Create(ai).Error; err != nil {
			t.Fatalf("seed agent instance: %v", err)
		}
		task := &model.PendingAgentTask{
			AgentInstanceID:   ai.ID,
			TriggeredByUserID: alice.ID,
			TriggerMessageID:  triggerMsgID,
			Status:            status,
			EdgeDeviceID:      deskDeviceID,
			ExpireAt:          time.Now().Add(time.Hour),
		}
		if err := db.Create(task).Error; err != nil {
			t.Fatalf("seed pending agent task: %v", err)
		}
		return task.ID
	}
	taskStatus := func(taskID string) string {
		t.Helper()
		var task model.PendingAgentTask
		if err := db.First(&task, "id = ?", taskID).Error; err != nil {
			t.Fatalf("load pending task %s: %v", taskID, err)
		}
		return task.Status
	}

	t.Run("TaskAckTransitionsDispatchedToRunning", func(t *testing.T) {
		taskID := seedAgentAndTask(model.TaskStatusDispatched)
		r := parse(postAuth("/edge/agent-tasks/"+taskID+"/ack", deskTok, map[string]string{
			"edge_run_id": "run-ack-001",
		}))
		mustOK(t, r, "task ack")
		if got := taskStatus(taskID); got != model.TaskStatusRunning {
			t.Fatalf("after ack: status %s, want running", got)
		}
	})

	t.Run("TaskStreamWhileRunning", func(t *testing.T) {
		taskID := seedAgentAndTask(model.TaskStatusRunning)
		r := parse(postAuth("/edge/agent-tasks/"+taskID+"/stream", deskTok, map[string]string{
			"edge_run_id": "run-str-001",
			"content":     "streaming output...",
		}))
		mustOK(t, r, "task stream")
	})

	t.Run("TaskDoneTransitionsRunningToDone", func(t *testing.T) {
		taskID := seedAgentAndTask(model.TaskStatusRunning)
		r := parse(postAuth("/edge/agent-tasks/"+taskID+"/done", deskTok, map[string]string{
			"edge_run_id": "run-done-001",
			"content":     "all done!",
		}))
		mustOK(t, r, "task done")
		if got := taskStatus(taskID); got != model.TaskStatusDone {
			t.Fatalf("after done: status %s, want done", got)
		}
	})

	t.Run("TaskFailTransitionsRunningToFailed", func(t *testing.T) {
		taskID := seedAgentAndTask(model.TaskStatusRunning)
		r := parse(postAuth("/edge/agent-tasks/"+taskID+"/fail", deskTok, map[string]string{
			"edge_run_id": "run-fail-001",
			"error":       "edge crashed",
		}))
		mustOK(t, r, "task fail")
		if got := taskStatus(taskID); got != model.TaskStatusFailed {
			t.Fatalf("after fail: status %s, want failed", got)
		}
	})

	t.Run("CancelTaskTransitionsRunningToCancelled", func(t *testing.T) {
		taskID := seedAgentAndTask(model.TaskStatusRunning)
		r := parse(postAuth("/web/agent-tasks/"+taskID+"/cancel", alice.Token, nil))
		mustOK(t, r, "task cancel")
		if got := taskStatus(taskID); got != model.TaskStatusCancelled {
			t.Fatalf("after cancel: status %s, want cancelled", got)
		}
	})

	t.Run("AckUnknownTaskNotFound", func(t *testing.T) {
		r := parse(postAuth("/edge/agent-tasks/00000000-0000-0000-0000-00000000ffff/ack",
			deskTok, map[string]string{"edge_run_id": "run-nf-001"}))
		mustCode(t, r, errcode.AgentTaskNotFound.Code, "ack unknown task")
	})

	t.Run("AckWrongDeviceRejected", func(t *testing.T) {
		taskID := seedAgentAndTask(model.TaskStatusDispatched)
		// 另一个桌面设备（edge_device_id 不匹配）→ not_found（authorize 不泄露存在性）
		otherDev := "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02"
		otherTok, err := jwtutil.GenerateAccessToken(alice.ID, "desktop",
			otherDev, testJWT.Secret, testJWT.AccessTTL)
		if err != nil {
			t.Fatalf("generate other desktop token: %v", err)
		}
		r := parse(postAuth("/edge/agent-tasks/"+taskID+"/ack", otherTok, map[string]string{
			"edge_run_id": "run-wrong-dev",
		}))
		mustCode(t, r, errcode.AgentTaskNotFound.Code, "ack with wrong device")
	})
}
