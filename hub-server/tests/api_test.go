package tests

import (
	"encoding/json"
	"testing"
)

func TestAuth(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	t.Run("Register", func(t *testing.T) {
		w := post("/client/auth/register", map[string]string{
			"username": "ta01", "password": "pass1234", "nickname": "A1",
		})
		mustOK(t, parse(w), "register")
		w = post("/client/auth/register", map[string]string{
			"username": "ta01", "password": "pass1234", "nickname": "A1",
		})
		mustCode(t, parse(w), "USER_USERNAME_TAKEN", "duplicate")
	})

	t.Run("LoginAndMe", func(t *testing.T) {
		post("/client/auth/register", map[string]string{"username": "ta02", "password": "pass1234", "nickname": "A2"})
		w := post("/client/auth/login", map[string]interface{}{"username": "ta02", "password": "pass1234", "device_type": "web", "device_id": "00000000-0000-0000-0000-00000000a001"})
		r := parse(w)
		mustOK(t, r, "login")
		tok := extract(r.Data, "access_token")
		mustOK(t, parse(get("/client/auth/me", tok)), "me")
	})

	t.Run("WrongPassword", func(t *testing.T) {
		w := post("/client/auth/login", map[string]interface{}{"username": "ta02", "password": "wrong", "device_type": "web", "device_id": "00000000-0000-0000-0000-00000000a002"})
		mustCode(t, parse(w), "AUTH_INVALID_CREDENTIALS", "wrong pw")
	})

	t.Run("NoToken", func(t *testing.T) {
		mustCode(t, parse(get("/client/auth/me", "")), "AUTH_INVALID_TOKEN", "no token")
	})

	t.Run("RefreshToken", func(t *testing.T) {
		w := post("/client/auth/login", map[string]interface{}{"username": "ta02", "password": "pass1234", "device_type": "web", "device_id": "00000000-0000-0000-0000-00000000a003"})
		rt := extract(parse(w).Data, "refresh_token")
		mustOK(t, parse(post("/client/auth/refresh", map[string]string{"refresh_token": rt})), "refresh")
	})

	t.Run("ChangePassword", func(t *testing.T) {
		post("/client/auth/register", map[string]string{"username": "ta03", "password": "pass1234", "nickname": "A3"})
		w := post("/client/auth/login", map[string]interface{}{"username": "ta03", "password": "pass1234", "device_type": "web", "device_id": "00000000-0000-0000-0000-00000000b001"})
		tok := extract(parse(w).Data, "access_token")
		mustOK(t, parse(put("/client/auth/password", tok, map[string]string{"old_password": "pass1234", "new_password": "newpass5678"})), "change pw")
		w = post("/client/auth/login", map[string]interface{}{"username": "ta03", "password": "newpass5678", "device_type": "web", "device_id": "00000000-0000-0000-0000-00000000b002"})
		mustOK(t, parse(w), "login new pw")
	})

	t.Run("UpdateProfile", func(t *testing.T) {
		u := register(t, "ta04", "pass1234", "Original")
		mustOK(t, parse(put("/client/auth/profile", u.Token, map[string]string{"nickname": "Updated"})), "update profile")
	})

	t.Run("Logout", func(t *testing.T) {
		w := post("/client/auth/login", map[string]interface{}{"username": "ta02", "password": "pass1234", "device_type": "web", "device_id": "00000000-0000-0000-0000-00000000a009"})
		tok := extract(parse(w).Data, "access_token")
		mustOK(t, parse(postAuth("/client/auth/logout", tok, nil)), "logout")
	})
}

func TestContacts(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	alice := register(t, "tc0a", "pass1234", "AliceC")
	bob := register(t, "tc0b", "pass1234", "BobC")

	t.Run("SearchStranger", func(t *testing.T) {
		mustOK(t, parse(get("/client/contacts/search?id="+bob.ID, alice.Token)), "search")
	})

	t.Run("SendAndAcceptRequest", func(t *testing.T) {
		mustOK(t, parse(postAuth("/client/contacts/friend-requests", alice.Token, map[string]interface{}{"friend_id": bob.ID, "message": "Hi!"})), "send")
		w := get("/client/contacts/friend-requests", bob.Token)
		r := parse(w)
		mustOK(t, r, "list requests")
		var arr []map[string]interface{}
		json.Unmarshal(r.Data, &arr)
		if len(arr) == 0 {
			t.Fatal("no friend request found")
		}
		reqID := arr[0]["request_id"].(string)
		acceptResp := parse(postAuth("/client/contacts/friend-requests/"+reqID+"/accept", bob.Token, nil))
		mustOK(t, acceptResp, "accept")
	})

	t.Run("ContactList", func(t *testing.T) {
		mustOK(t, parse(get("/client/contacts", alice.Token)), "contact list")
	})

	t.Run("Remark", func(t *testing.T) {
		mustOK(t, parse(put("/client/contacts/"+bob.ID+"/remark", alice.Token, map[string]string{"remark": "Best"})), "remark")
	})

	t.Run("BlockAndUnblock", func(t *testing.T) {
		mustOK(t, parse(postAuth("/client/contacts/"+bob.ID+"/block", alice.Token, nil)), "block")
		mustOK(t, parse(postAuth("/client/contacts/"+bob.ID+"/unblock", alice.Token, nil)), "unblock")
	})
}

func TestSessions(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	alice := register(t, "ts0a", "pass1234", "AliceS")
	bob := register(t, "ts0b", "pass1234", "BobS")

	postAuth("/client/contacts/friend-requests", alice.Token, map[string]interface{}{"friend_id": bob.ID, "message": "Hi"})
	w := get("/client/contacts/friend-requests", bob.Token)
	var arr []map[string]interface{}
	json.Unmarshal(parse(w).Data, &arr)
	if len(arr) > 0 {
		postAuth("/client/contacts/friend-requests/"+arr[0]["request_id"].(string)+"/accept", bob.Token, nil)
	}

	t.Run("CreatePrivate", func(t *testing.T) {
		mustOK(t, parse(postAuth("/client/sessions/private", alice.Token, map[string]string{"target_user_id": bob.ID})), "create private")
	})

	t.Run("DuplicatePrivate", func(t *testing.T) {
		mustOK(t, parse(postAuth("/client/sessions/private", alice.Token, map[string]string{"target_user_id": bob.ID})), "dup private")
	})

	t.Run("CreateGroup", func(t *testing.T) {
		mustOK(t, parse(postAuth("/client/sessions/group", alice.Token, map[string]interface{}{"name": "TG", "member_ids": []string{bob.ID}})), "create group")
	})

	t.Run("SessionList", func(t *testing.T) {
		mustOK(t, parse(get("/client/sessions", alice.Token)), "session list")
	})

	t.Run("UpdateSettings", func(t *testing.T) {
		r := parse(postAuth("/client/sessions/private", alice.Token, map[string]string{"target_user_id": bob.ID}))
		sid := extract(r.Data, "session_id")
		mustOK(t, parse(put("/client/sessions/"+sid+"/settings", alice.Token, map[string]bool{"pinned": true})), "settings")
	})

	t.Run("DeleteSession", func(t *testing.T) {
		r := parse(postAuth("/client/sessions/private", alice.Token, map[string]string{"target_user_id": bob.ID}))
		sid := extract(r.Data, "session_id")
		mustOK(t, parse(del("/client/sessions/"+sid, alice.Token)), "delete")
	})
}

func TestMessages(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	alice := register(t, "tm0a", "pass1234", "AliceM")
	bob := register(t, "tm0b", "pass1234", "BobM")

	postAuth("/client/contacts/friend-requests", alice.Token, map[string]interface{}{"friend_id": bob.ID, "message": "Hi"})
	w := get("/client/contacts/friend-requests", bob.Token)
	var arr []map[string]interface{}
	json.Unmarshal(parse(w).Data, &arr)
	if len(arr) > 0 {
		postAuth("/client/contacts/friend-requests/"+arr[0]["request_id"].(string)+"/accept", bob.Token, nil)
	}

	r := parse(postAuth("/client/sessions/private", alice.Token, map[string]string{"target_user_id": bob.ID}))
	mustOK(t, r, "create session")
	sid := extract(r.Data, "session_id")

	t.Run("SendMessage", func(t *testing.T) {
		mustOK(t, parse(postAuth("/client/sessions/"+sid+"/messages", alice.Token, map[string]interface{}{"client_msg_id": "00000000-0000-0000-0000-000000001001", "content_type": "text", "content": "Hello!"})), "send")
	})

	t.Run("Idempotent", func(t *testing.T) {
		mustOK(t, parse(postAuth("/client/sessions/"+sid+"/messages", alice.Token, map[string]interface{}{"client_msg_id": "00000000-0000-0000-0000-000000001001", "content_type": "text", "content": "Hello!"})), "idempotent")
	})

	t.Run("History", func(t *testing.T) {
		mustOK(t, parse(get("/client/sessions/"+sid+"/messages?limit=10", alice.Token)), "history")
	})

	t.Run("Sync", func(t *testing.T) {
		mustOK(t, parse(get("/client/sessions/"+sid+"/messages/sync?after_seq=0", alice.Token)), "sync")
	})

	t.Run("Recall", func(t *testing.T) {
		hr := parse(get("/client/sessions/"+sid+"/messages?limit=1", alice.Token))
		var msgs []map[string]interface{}
		json.Unmarshal(hr.Data, &msgs)
		if len(msgs) == 0 {
			t.Skip("no messages")
			return
		}
		mid := msgs[0]["id"].(string)
		mustOK(t, parse(postAuth("/client/messages/"+mid+"/recall", alice.Token, nil)), "recall")
	})

	t.Run("MarkRead", func(t *testing.T) {
		mustOK(t, parse(postAuth("/client/sessions/"+sid+"/read", alice.Token, map[string]int64{"last_read_seq": 10})), "mark read")
	})
}

func TestAttachmentsAndNotifications(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	u := register(t, "tan1", "pass1234", "AN")

	t.Run("Probe", func(t *testing.T) {
		mustOK(t, parse(postAuth("/client/attachments/probe", u.Token, map[string]string{"hash": "abc123def456abc123def456abc123def456abc123def456abc123def4560000"})), "probe")
	})

	t.Run("ListNotifications", func(t *testing.T) {
		mustOK(t, parse(get("/client/notifications", u.Token)), "notifications")
	})

	t.Run("ReadAll", func(t *testing.T) {
		mustOK(t, parse(postAuth("/client/notifications/read-all", u.Token, nil)), "read all")
	})
}

func TestCustomAgent(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	u := register(t, "tca01", "pass1234", "CA")

	t.Run("CRUD", func(t *testing.T) {
		r := parse(postAuth("/web/custom-agents", u.Token, map[string]interface{}{"name": "MyAgent", "agent_type": "claude-code", "system_prompt": "Helpful"}))
		mustOK(t, r, "create")
		caID := extract(r.Data, "id")

		mustOK(t, parse(get("/web/custom-agents", u.Token)), "list")
		mustOK(t, parse(put("/web/custom-agents/"+caID, u.Token, map[string]string{"name": "Updated", "agent_type": "claude-code", "system_prompt": "Updated"})), "update")
		mustOK(t, parse(del("/web/custom-agents/"+caID, u.Token)), "delete")
	})
}

func TestEdgeDevice(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	register(t, "ted1", "pass1234", "Edge")

	w := post("/client/auth/login", map[string]interface{}{"username": "ted1", "password": "pass1234", "device_type": "desktop", "device_id": "dddddddd-dddd-dddd-dddd-dddddddddd01"})
	tok := extract(parse(w).Data, "access_token")

	t.Run("RegisterDevice", func(t *testing.T) {
		mustOK(t, parse(postAuth("/edge/devices/register", tok, map[string]interface{}{"device_id": "dddddddd-dddd-dddd-dddd-dddddddddd01", "app_version": "1.0", "capabilities": []string{"claude-code"}})), "register device")
	})
}
