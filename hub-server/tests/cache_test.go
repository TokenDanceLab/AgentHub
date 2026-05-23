package tests

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

func TestCacheWarmsOnRead(t *testing.T) {
	alice := register(t, "tcch_a01", "pass1234", "AliceCache")
	bob := register(t, "tcch_b01", "pass1234", "BobCache")

	// Make friends
	postAuth("/client/contacts/friend-requests", alice.Token, map[string]interface{}{"friend_id": bob.ID, "message": "Hi"})
	w := get("/client/contacts/friend-requests", bob.Token)
	var arr []map[string]interface{}
	json.Unmarshal(parse(w).Data, &arr)
	if len(arr) > 0 {
		postAuth("/client/contacts/friend-requests/"+arr[0]["request_id"].(string)+"/accept", bob.Token, nil)
	}

	// Create private session
	r := parse(postAuth("/client/sessions/private", alice.Token, map[string]string{"target_user_id": bob.ID}))
	mustOK(t, r, "create private session")

	// Get session list — this should warm the cache
	sl := parse(get("/client/sessions", alice.Token))
	mustOK(t, sl, "list sessions post-warm")

	// Verify session list contains data
	var sessions []map[string]interface{}
	json.Unmarshal(sl.Data, &sessions)
	if len(sessions) == 0 {
		t.Fatal("expected at least one session in list")
	}
}

func TestCacheInvalidateOnSessionChange(t *testing.T) {
	alice := register(t, "tcinv_a", "pass1234", "AliceInv")
	bob := register(t, "tcinv_b", "pass1234", "BobInv")
	charlie := register(t, "tcinv_c", "pass1234", "CharlieInv")

	// Make A friends with B and C
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

	// Create group with A (owner), B, C
	gr := parse(postAuth("/client/sessions/group", alice.Token, map[string]interface{}{
		"name": "InvalidCacheGroup", "member_ids": []string{bob.ID, charlie.ID},
	}))
	mustOK(t, gr, "create group")
	sid := extract(gr.Data, "session_id")

	// Verify session list returns OK (cache warmed)
	sl := parse(get("/client/sessions", alice.Token))
	mustOK(t, sl, "session list after create")

	// A kicks C (cache should be invalidated)
	mustOK(t, parse(del("/client/sessions/"+sid+"/members/"+charlie.ID, alice.Token)), "kick C")

	// A's session list should still be accessible (cache was invalidated after kick)
	sl2 := parse(get("/client/sessions", alice.Token))
	mustOK(t, sl2, "session list after kick")

	// B should also still see the group session
	bl := parse(get("/client/sessions", bob.Token))
	mustOK(t, bl, "bob session list after kick")
}

func TestProfileUpdateInvalidatesCache(t *testing.T) {
	u := register(t, "tprof_c1", "pass1234", "OriginalName")

	// Update nickname
	r := parse(put("/client/auth/profile", u.Token, map[string]string{"nickname": "UpdatedName"}))
	mustOK(t, r, "update profile")

	// Call /me — should return updated nickname (cache was invalidated)
	me := parse(get("/client/auth/me", u.Token))
	mustOK(t, me, "me after profile update")

	var resp struct {
		ID       string `json:"id"`
		Username string `json:"username"`
		Nickname string `json:"nickname"`
	}
	json.Unmarshal(me.Data, &resp)
	if resp.Nickname != "UpdatedName" {
		t.Fatalf("expected nickname 'UpdatedName' got '%s'", resp.Nickname)
	}
}

func TestBlockAddsToCorrectList(t *testing.T) {
	alice := register(t, "tblk2_a", "pass1234", "AliceBlk2")
	bob := register(t, "tblk2_b", "pass1234", "BobBlk2")

	// Make friends
	postAuth("/client/contacts/friend-requests", alice.Token, map[string]interface{}{"friend_id": bob.ID, "message": "Hi"})
	w := get("/client/contacts/friend-requests", bob.Token)
	var arr []map[string]interface{}
	json.Unmarshal(parse(w).Data, &arr)
	if len(arr) > 0 {
		postAuth("/client/contacts/friend-requests/"+arr[0]["request_id"].(string)+"/accept", bob.Token, nil)
	}

	// Block B
	r := parse(postAuth("/client/contacts/"+bob.ID+"/block", alice.Token, nil))
	mustOK(t, r, "block user")

	// Unblock B
	u := parse(postAuth("/client/contacts/"+bob.ID+"/unblock", alice.Token, nil))
	mustOK(t, u, "unblock user")

	// Block again to verify idempotency
	r2 := parse(postAuth("/client/contacts/"+bob.ID+"/block", alice.Token, nil))
	mustOK(t, r2, "block again")
}

func TestRecallByOwnerNonSender(t *testing.T) {
	alice := register(t, "trecl_a", "pass1234", "AliceRecall")
	bob := register(t, "trecl_b", "pass1234", "BobRecall")
	charlie := register(t, "trecl_c", "pass1234", "CharlieRecall")

	// Make A friends with B and C
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

	// A creates group with B and C (A is owner)
	gr := parse(postAuth("/client/sessions/group", alice.Token, map[string]interface{}{
		"name": "RecallGroup", "member_ids": []string{bob.ID, charlie.ID},
	}))
	mustOK(t, gr, "create group")
	sid := extract(gr.Data, "session_id")

	// B sends a message in the group
	msg := parse(postAuth("/client/sessions/"+sid+"/messages", bob.Token, map[string]interface{}{
		"client_msg_id": "00000000-0000-0000-0000-00000000c001",
		"content_type":  "text", "content": "recall me pls",
	}))
	mustOK(t, msg, "B sends message")
	mid := extract(msg.Data, "message_id")

	// A (owner) recalls B's message — should succeed
	recall := parse(postAuth("/client/messages/"+mid+"/recall", alice.Token, nil))
	mustOK(t, recall, "owner recalls non-sender message")
}

func TestRecallTimeout(t *testing.T) {
	alice := register(t, "trect_a", "pass1234", "AliceRecallT")
	bob := register(t, "trect_b", "pass1234", "BobRecallT")

	// Make friends
	postAuth("/client/contacts/friend-requests", alice.Token, map[string]interface{}{"friend_id": bob.ID, "message": "Hi"})
	w := get("/client/contacts/friend-requests", bob.Token)
	var arr []map[string]interface{}
	json.Unmarshal(parse(w).Data, &arr)
	if len(arr) > 0 {
		postAuth("/client/contacts/friend-requests/"+arr[0]["request_id"].(string)+"/accept", bob.Token, nil)
	}

	// Create private session
	r := parse(postAuth("/client/sessions/private", alice.Token, map[string]string{"target_user_id": bob.ID}))
	mustOK(t, r, "create private session")
	sid := extract(r.Data, "session_id")

	// A sends a message
	msg := parse(postAuth("/client/sessions/"+sid+"/messages", alice.Token, map[string]interface{}{
		"client_msg_id": "00000000-0000-0000-0000-00000000d001",
		"content_type":  "text", "content": "about to be recalled",
	}))
	mustOK(t, msg, "send message")
	mid := extract(msg.Data, "message_id")

	// A recalls immediately — should succeed (within 5 min)
	recall := parse(postAuth("/client/messages/"+mid+"/recall", alice.Token, nil))
	mustOK(t, recall, "immediate recall")
}

func TestPinLimit(t *testing.T) {
	alice := register(t, "tpin2_a", "pass1234", "AlicePin2")
	bob := register(t, "tpin2_b", "pass1234", "BobPin2")

	// Make friends
	postAuth("/client/contacts/friend-requests", alice.Token, map[string]interface{}{"friend_id": bob.ID, "message": "Hi"})
	w := get("/client/contacts/friend-requests", bob.Token)
	var arr []map[string]interface{}
	json.Unmarshal(parse(w).Data, &arr)
	if len(arr) > 0 {
		postAuth("/client/contacts/friend-requests/"+arr[0]["request_id"].(string)+"/accept", bob.Token, nil)
	}

	// Create private session
	r := parse(postAuth("/client/sessions/private", alice.Token, map[string]string{"target_user_id": bob.ID}))
	mustOK(t, r, "create private session")
	sid := extract(r.Data, "session_id")

	// Send 2 messages
	postAuth("/client/sessions/"+sid+"/messages", alice.Token, map[string]interface{}{
		"client_msg_id": "00000000-0000-0000-0000-00000000e001",
		"content_type":  "text", "content": "Pin message 1",
	})
	postAuth("/client/sessions/"+sid+"/messages", alice.Token, map[string]interface{}{
		"client_msg_id": "00000000-0000-0000-0000-00000000e002",
		"content_type":  "text", "content": "Pin message 2",
	})

	// Get messages to get IDs
	hr := parse(get("/client/sessions/"+sid+"/messages?limit=2", alice.Token))
	var msgs []map[string]interface{}
	json.Unmarshal(hr.Data, &msgs)
	if len(msgs) < 2 {
		t.Fatal("need at least 2 messages")
	}
	firstID := msgs[0]["id"].(string)
	secondID := msgs[1]["id"].(string)

	// Pin both — should succeed (limit is 50 per session)
	mustOK(t, parse(postAuth("/client/messages/"+firstID+"/pin", alice.Token, map[string]string{"session_id": sid})), "pin first")
	mustOK(t, parse(postAuth("/client/messages/"+secondID+"/pin", alice.Token, map[string]string{"session_id": sid})), "pin second")

	// Verify pins list
	pins := parse(get("/client/sessions/"+sid+"/pins", alice.Token))
	mustOK(t, pins, "list pins")
	var pinList []map[string]interface{}
	json.Unmarshal(pins.Data, &pinList)
	if len(pinList) != 2 {
		t.Fatalf("expected 2 pins, got %d", len(pinList))
	}
}

func TestSearchSessions(t *testing.T) {
	alice := register(t, "tsrch_a", "pass1234", "AliceSearch")
	bob := register(t, "tsrch_b", "pass1234", "BobSearch")

	// Make friends
	postAuth("/client/contacts/friend-requests", alice.Token, map[string]interface{}{"friend_id": bob.ID, "message": "Hi"})
	w := get("/client/contacts/friend-requests", bob.Token)
	var arr []map[string]interface{}
	json.Unmarshal(parse(w).Data, &arr)
	if len(arr) > 0 {
		postAuth("/client/contacts/friend-requests/"+arr[0]["request_id"].(string)+"/accept", bob.Token, nil)
	}

	// Create group named "SearchTestGroup"
	gr := parse(postAuth("/client/sessions/group", alice.Token, map[string]interface{}{
		"name": "SearchTestGroup", "member_ids": []string{bob.ID},
	}))
	mustOK(t, gr, "create group")

	// Search for the group by name
	sr := parse(get("/client/sessions/search?q=SearchTest", alice.Token))
	mustOK(t, sr, "search sessions")

	var results []map[string]interface{}
	json.Unmarshal(sr.Data, &results)
	if len(results) == 0 {
		t.Fatal("expected to find SearchTestGroup")
	}

	// Search for something non-existent
	sr2 := parse(get("/client/sessions/search?q=NonExistentGroupXYZ", alice.Token))
	mustOK(t, sr2, "search non-existent sessions")
	var empty []map[string]interface{}
	json.Unmarshal(sr2.Data, &empty)
	if len(empty) != 0 {
		t.Fatalf("expected empty results, got %d", len(empty))
	}
}

func TestSearchNonExistentUser(t *testing.T) {
	alice := register(t, "tsrchu_a", "pass1234", "AliceSearchU")

	// Search for a random UUID that doesn't exist
	r := parse(get("/client/contacts/search?id="+uuid.New().String(), alice.Token))
	mustCode(t, r, "USER_NOT_FOUND", "search non-existent user")

	// Search for self — should return error (cannot search self)
	r2 := parse(get("/client/contacts/search?id="+alice.ID, alice.Token))
	mustCode(t, r2, "USER_INVALID_PARAM", "search self")
}
