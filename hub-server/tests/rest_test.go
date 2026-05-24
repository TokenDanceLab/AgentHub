package tests

import (
	"encoding/json"
	"testing"
)

// ============================================================
// Session Lifecycle Tests
// ============================================================

func TestLeaveAndRejoinGroup(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	a := register(t, "trlj_a", "pass1234", "LeaveJoinA")
	b := register(t, "trlj_b", "pass1234", "LeaveJoinB")
	c := register(t, "trlj_c", "pass1234", "LeaveJoinC")

	// Make all friends
	postAuth("/client/contacts/friend-requests", a.Token, map[string]interface{}{"friend_id": b.ID, "message": "Hi"})
	postAuth("/client/contacts/friend-requests", a.Token, map[string]interface{}{"friend_id": c.ID, "message": "Hi"})
	for _, u := range []testUser{b, c} {
		w := get("/client/contacts/friend-requests", u.Token)
		var arr []map[string]interface{}
		json.Unmarshal(parse(w).Data, &arr)
		if len(arr) > 0 {
			postAuth("/client/contacts/friend-requests/"+arr[0]["request_id"].(string)+"/accept", u.Token, nil)
		}
	}

	// A creates group with B and C
	gr := parse(postAuth("/client/sessions/group", a.Token, map[string]interface{}{
		"name": "LJGroup", "member_ids": []string{b.ID, c.ID},
	}))
	mustOK(t, gr, "create group")
	sid := extract(gr.Data, "session_id")

	// C leaves the group
	mustOK(t, parse(postAuth("/client/sessions/"+sid+"/leave", c.Token, nil)), "C leave")

	// C tries to leave again - should fail (not a member)
	w := postAuth("/client/sessions/"+sid+"/leave", c.Token, nil)
	mustCode(t, parse(w), "SESSION_NOT_MEMBER", "C leave again")

	// A adds C back
	mustOK(t, parse(postAuth("/client/sessions/"+sid+"/members", a.Token, map[string]interface{}{
		"member_ids": []string{c.ID},
	})), "A add C back")
}

func TestLeaveAsLastOwner(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	a := register(t, "tllo_a", "pass1234", "LastOwnerA")
	b := register(t, "tllo_b", "pass1234", "LastOwnerB")
	c := register(t, "tllo_c", "pass1234", "LastOwnerC")

	// Make all friends
	postAuth("/client/contacts/friend-requests", a.Token, map[string]interface{}{"friend_id": b.ID, "message": "Hi"})
	postAuth("/client/contacts/friend-requests", a.Token, map[string]interface{}{"friend_id": c.ID, "message": "Hi"})
	for _, u := range []testUser{b, c} {
		w := get("/client/contacts/friend-requests", u.Token)
		var arr []map[string]interface{}
		json.Unmarshal(parse(w).Data, &arr)
		if len(arr) > 0 {
			postAuth("/client/contacts/friend-requests/"+arr[0]["request_id"].(string)+"/accept", u.Token, nil)
		}
	}

	// A creates group with B and C
	gr := parse(postAuth("/client/sessions/group", a.Token, map[string]interface{}{
		"name": "LOGroup", "member_ids": []string{b.ID, c.ID},
	}))
	mustOK(t, gr, "create group")
	sid := extract(gr.Data, "session_id")

	// A (owner) tries to leave while other members exist - should fail
	w := postAuth("/client/sessions/"+sid+"/leave", a.Token, nil)
	mustCode(t, parse(w), "GROUP_OWNER_CANNOT_LEAVE", "owner cannot leave with others present")
}

func TestDissolveByNonOwner(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	a := register(t, "tdno_a", "pass1234", "DissolveNonA")
	b := register(t, "tdno_b", "pass1234", "DissolveNonB")
	c := register(t, "tdno_c", "pass1234", "DissolveNonC")

	// Make all friends
	postAuth("/client/contacts/friend-requests", a.Token, map[string]interface{}{"friend_id": b.ID, "message": "Hi"})
	postAuth("/client/contacts/friend-requests", a.Token, map[string]interface{}{"friend_id": c.ID, "message": "Hi"})
	for _, u := range []testUser{b, c} {
		w := get("/client/contacts/friend-requests", u.Token)
		var arr []map[string]interface{}
		json.Unmarshal(parse(w).Data, &arr)
		if len(arr) > 0 {
			postAuth("/client/contacts/friend-requests/"+arr[0]["request_id"].(string)+"/accept", u.Token, nil)
		}
	}

	// A creates group with B and C
	gr := parse(postAuth("/client/sessions/group", a.Token, map[string]interface{}{
		"name": "DissolveGrp", "member_ids": []string{b.ID, c.ID},
	}))
	mustOK(t, gr, "create group")
	sid := extract(gr.Data, "session_id")

	// B tries to dissolve - should fail (not owner)
	w := postAuth("/client/sessions/"+sid+"/dissolve", b.Token, nil)
	mustCode(t, parse(w), "GROUP_NOT_OWNER", "non-owner cannot dissolve")
}

// ============================================================
// Contact Edge Case Tests
// ============================================================

func TestCreatePrivateWithSelf(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	a := register(t, "tcpws", "pass1234", "PrivateSelf")

	// Try to create private session with self
	w := postAuth("/client/sessions/private", a.Token, map[string]string{
		"target_user_id": a.ID,
	})
	mustCode(t, parse(w), "BAD_REQUEST", "private with self")
}

func TestCreateGroupWithoutFriends(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	a := register(t, "tcgwf_a", "pass1234", "GroupNoFriendA")
	b := register(t, "tcgwf_b", "pass1234", "GroupNoFriendB")
	c := register(t, "tcgwf_c", "pass1234", "GroupNoFriendC")

	// Only A-B are friends
	postAuth("/client/contacts/friend-requests", a.Token, map[string]interface{}{"friend_id": b.ID, "message": "Hi"})
	w := get("/client/contacts/friend-requests", b.Token)
	var arr []map[string]interface{}
	json.Unmarshal(parse(w).Data, &arr)
	if len(arr) > 0 {
		postAuth("/client/contacts/friend-requests/"+arr[0]["request_id"].(string)+"/accept", b.Token, nil)
	}

	// A tries to create group with C (not a friend) - should fail
	w2 := postAuth("/client/sessions/group", a.Token, map[string]interface{}{
		"name": "BadGroup", "member_ids": []string{c.ID},
	})
	mustCode(t, parse(w2), "BAD_REQUEST", "group with non-friend")
}

func TestDuplicateFriendRequest(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	a := register(t, "tdfr_a", "pass1234", "DupFRA")
	b := register(t, "tdfr_b", "pass1234", "DupFRB")

	// A sends friend request to B
	mustOK(t, parse(postAuth("/client/contacts/friend-requests", a.Token, map[string]interface{}{
		"friend_id": b.ID, "message": "Hi",
	})), "first request")

	// A sends another friend request to B - should fail (already pending)
	w := postAuth("/client/contacts/friend-requests", a.Token, map[string]interface{}{
		"friend_id": b.ID, "message": "Hi again",
	})
	mustCode(t, parse(w), "FRIEND_ALREADY", "duplicate friend request")
}

func TestAcceptNonPendingRequest(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	a := register(t, "tanpr_a", "pass1234", "AccNonPenA")
	b := register(t, "tanpr_b", "pass1234", "AccNonPenB")

	// Make them friends
	postAuth("/client/contacts/friend-requests", a.Token, map[string]interface{}{"friend_id": b.ID, "message": "Hi"})
	w := get("/client/contacts/friend-requests", b.Token)
	var arr []map[string]interface{}
	json.Unmarshal(parse(w).Data, &arr)
	if len(arr) > 0 {
		postAuth("/client/contacts/friend-requests/"+arr[0]["request_id"].(string)+"/accept", b.Token, nil)
	}

	// A tries to send request again to B (already friends) - should fail
	w2 := postAuth("/client/contacts/friend-requests", a.Token, map[string]interface{}{
		"friend_id": b.ID, "message": "Hi again",
	})
	mustCode(t, parse(w2), "FRIEND_ALREADY", "request to existing friend")

	// Try accepting a random UUID that isn't a valid request
	w3 := postAuth("/client/contacts/friend-requests/00000000-0000-0000-0000-00000000dead/accept", a.Token, nil)
	mustCode(t, parse(w3), "FRIEND_REQUEST_NOT_FOUND", "accept random uuid")
}

func TestSelfBlock(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	a := register(t, "tsblk", "pass1234", "SelfBlock")

	// Try to block self
	w := postAuth("/client/contacts/"+a.ID+"/block", a.Token, nil)
	mustCode(t, parse(w), "USER_INVALID_PARAM", "self block")
}

// ============================================================
// Message Edge Case Tests
// ============================================================

func TestInvalidContentType(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	a := register(t, "tict_a", "pass1234", "InvContentA")
	b := register(t, "tict_b", "pass1234", "InvContentB")

	// Make friends
	postAuth("/client/contacts/friend-requests", a.Token, map[string]interface{}{"friend_id": b.ID, "message": "Hi"})
	w := get("/client/contacts/friend-requests", b.Token)
	var arr []map[string]interface{}
	json.Unmarshal(parse(w).Data, &arr)
	if len(arr) > 0 {
		postAuth("/client/contacts/friend-requests/"+arr[0]["request_id"].(string)+"/accept", b.Token, nil)
	}

	// Create private session
	r := parse(postAuth("/client/sessions/private", a.Token, map[string]string{"target_user_id": b.ID}))
	sid := extract(r.Data, "session_id")

	// Try to send a message with invalid content_type
	w2 := postAuth("/client/sessions/"+sid+"/messages", a.Token, map[string]interface{}{
		"client_msg_id": "00000000-0000-0000-0000-00000000f001",
		"content_type":  "invalid_type",
		"content":       "test",
	})
	mustCode(t, parse(w2), "BAD_REQUEST", "invalid content_type")
}

func TestGetMessagesWithoutMembership(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	a := register(t, "tgmwm_a", "pass1234", "GetMsgNoMemA")
	b := register(t, "tgmwm_b", "pass1234", "GetMsgNoMemB")
	c := register(t, "tgmwm_c", "pass1234", "GetMsgNoMemC")

	// A-B are friends, create private session
	postAuth("/client/contacts/friend-requests", a.Token, map[string]interface{}{"friend_id": b.ID, "message": "Hi"})
	w := get("/client/contacts/friend-requests", b.Token)
	var arr []map[string]interface{}
	json.Unmarshal(parse(w).Data, &arr)
	if len(arr) > 0 {
		postAuth("/client/contacts/friend-requests/"+arr[0]["request_id"].(string)+"/accept", b.Token, nil)
	}

	r := parse(postAuth("/client/sessions/private", a.Token, map[string]string{"target_user_id": b.ID}))
	sid := extract(r.Data, "session_id")

	// Send a message so there's something to read
	postAuth("/client/sessions/"+sid+"/messages", a.Token, map[string]interface{}{
		"client_msg_id": "00000000-0000-0000-0000-00000000f002",
		"content_type":  "text", "content": "Hello",
	})

	// C is not a member and not a friend of either - try to get messages
	w2 := get("/client/sessions/"+sid+"/messages?limit=10", c.Token)
	mustCode(t, parse(w2), "SESSION_NOT_MEMBER", "non-member cannot get messages")
}

// ============================================================
// Auth Edge Case Tests
// ============================================================

func TestChangePasswordWithWrongOldPassword(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	a := register(t, "tcpwp", "pass1234", "ChangePWWrongOld")

	// Try to change password with wrong old_password
	w := put("/client/auth/password", a.Token, map[string]string{
		"old_password": "wrongoldpassword",
		"new_password": "newpass5678",
	})
	mustCode(t, parse(w), "AUTH_INVALID_CREDENTIALS", "wrong old password")
}

func TestRegisterWithShortPassword(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	// Try to register with password length < 8
	w := post("/client/auth/register", map[string]string{
		"username": "trwsp01", "password": "short", "nickname": "ShortPW",
	})
	mustCode(t, parse(w), "USER_INVALID_PARAM", "short password")
}

func TestLoginWithInvalidDeviceType(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	// Register a user
	a := register(t, "tlidt", "pass1234", "LoginDevType")

	// Try to login with empty device_type - should fail (binding required)
	w := post("/client/auth/login", map[string]interface{}{
		"username": "tlidt", "password": "pass1234",
		"device_type": "", "device_id": "dddddddd-dddd-dddd-dddd-dddddddddd01",
	})
	mustCode(t, parse(w), "BAD_REQUEST", "empty device_type")

	// Try to login with missing device_id - should fail (binding required)
	w2 := post("/client/auth/login", map[string]interface{}{
		"username": "tlidt", "password": "pass1234",
		"device_type": "web",
	})
	mustCode(t, parse(w2), "BAD_REQUEST", "missing device_id")

	// Verify normal login still works
	w3 := post("/client/auth/login", map[string]interface{}{
		"username": "tlidt", "password": "pass1234",
		"device_type": "web", "device_id": "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01",
	})
	mustOK(t, parse(w3), "valid login")
	_ = a
}
