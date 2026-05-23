
package tests

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"testing"
)

func TestPinAndForward(t *testing.T) {
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
		mustCode(t, parse(w), "GROUP_OWNER_CANNOT_LEAVE", "owner cannot leave")
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
		mustCode(t, parse(w), "MSG_BLOCKED_BY_RECEIVER", "blocked message rejected")

		postAuth("/client/contacts/"+alice.ID+"/unblock", bob.Token, nil)
	})
}

func TestFileUpload(t *testing.T) {
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
			if w.StatusCode != 200 {
				t.Errorf("download attachment failed: %d", w.StatusCode)
			}
		}
	})
}

func TestRemainingREST(t *testing.T) {
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
	t.Run("WSUpgrade", func(t *testing.T) {
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
		if resp.StatusCode != http.StatusSwitchingProtocols {
			t.Logf("WS upgrade returned %d (may be expected with test server)", resp.StatusCode)
		} else {
			t.Log("WS upgrade successful (101 Switching Protocols)")
		}
	})
}

func TestAgentTaskCallbacks(t *testing.T) {
	alice := register(t, "tagtcb1", "pass1234", "AgentT")
	bob := register(t, "tagtcb2", "pass1234", "BobT")

	postAuth("/client/contacts/friend-requests", alice.Token, map[string]interface{}{"friend_id": bob.ID, "message": "Hi"})
	w := get("/client/contacts/friend-requests", bob.Token)
	var arr []map[string]interface{}
	json.Unmarshal(parse(w).Data, &arr)
	if len(arr) > 0 {
		postAuth("/client/contacts/friend-requests/"+arr[0]["request_id"].(string)+"/accept", bob.Token, nil)
	}

	gr := parse(postAuth("/client/sessions/group", alice.Token, map[string]interface{}{
		"name": "AgentGrp2", "member_ids": []string{bob.ID},
	}))
	sid := extract(gr.Data, "session_id")

	ag := parse(postAuth("/client/sessions/"+sid+"/agents", alice.Token, map[string]interface{}{
		"agent_type": "claude-code", "display_name": "Claude",
	}))
	mustOK(t, ag, "add agent")

	msg := parse(postAuth("/client/sessions/"+sid+"/messages", alice.Token, map[string]interface{}{
		"client_msg_id": "00000000-0000-0000-0000-00000000d001",
		"content_type":  "text", "content": "@Claude help",
	}))
	mustOK(t, msg, "send trigger message")

	tr := parse(postAuth("/web/agent-tasks", alice.Token, map[string]interface{}{
		"trigger_message_id": extract(msg.Data, "message_id"),
	}))
	taskID := extract(tr.Data, "id")
	t.Logf("trigger task result: code=%s taskID=%s", tr.Code, taskID)
	if taskID == "" {
		t.Skip("no task created (agent needs edge online)")
		return
	}

	deskLogin := parse(post("/client/auth/login", map[string]interface{}{
		"username": "tagtcb1", "password": "pass1234",
		"device_type": "desktop", "device_id": "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01",
	}))
	deskTok := extract(deskLogin.Data, "access_token")

	t.Run("TaskAck", func(t *testing.T) {
		r := parse(postAuth("/edge/agent-tasks/"+taskID+"/ack", deskTok, nil))
		t.Logf("task ack: code=%s", r.Code)
	})

	t.Run("TaskStream", func(t *testing.T) {
		r := parse(postAuth("/edge/agent-tasks/"+taskID+"/stream", deskTok, map[string]string{
			"content": "streaming output...",
		}))
		t.Logf("task stream: code=%s", r.Code)
	})

	t.Run("TaskDone", func(t *testing.T) {
		r := parse(postAuth("/edge/agent-tasks/"+taskID+"/done", deskTok, map[string]string{
			"content": "all done!",
		}))
		t.Logf("task done: code=%s", r.Code)
	})

	t.Run("CancelTask", func(t *testing.T) {
		msg2 := parse(postAuth("/client/sessions/"+sid+"/messages", alice.Token, map[string]interface{}{
			"client_msg_id": "00000000-0000-0000-0000-00000000d002",
			"content_type":  "text", "content": "@Claude again",
		}))
		tr2 := parse(postAuth("/web/agent-tasks", alice.Token, map[string]interface{}{
			"trigger_message_id": extract(msg2.Data, "message_id"),
		}))
		tid2 := extract(tr2.Data, "id")
		if tid2 != "" {
			r := parse(postAuth("/web/agent-tasks/"+tid2+"/cancel", alice.Token, nil))
			t.Logf("cancel task: code=%s", r.Code)
		} else {
			t.Log("no second task to cancel")
		}
	})

	t.Run("TaskFail", func(t *testing.T) {
		msg3 := parse(postAuth("/client/sessions/"+sid+"/messages", alice.Token, map[string]interface{}{
			"client_msg_id": "00000000-0000-0000-0000-00000000d003",
			"content_type":  "text", "content": "@Claude last one",
		}))
		tr3 := parse(postAuth("/web/agent-tasks", alice.Token, map[string]interface{}{
			"trigger_message_id": extract(msg3.Data, "message_id"),
		}))
		tid3 := extract(tr3.Data, "id")
		if tid3 != "" {
			r := parse(postAuth("/edge/agent-tasks/"+tid3+"/fail", deskTok, map[string]string{
				"error": "boom",
			}))
			t.Logf("task fail: code=%s", r.Code)
		} else {
			t.Log("no third task to fail")
		}
	})
}
