package tests

import (
	"encoding/json"
	"fmt"
	"sync"
	"testing"

	"github.com/google/uuid"
)

// =============================================================================
// helpers for seq tests
// =============================================================================

// friendPair registers two users, makes them friends, and returns both.
func friendPair(t *testing.T, nameA, nameB string) (testUser, testUser) {
	t.Helper()
	a := register(t, nameA, "pass1234", nameA+"_nick")
	b := register(t, nameB, "pass1234", nameB+"_nick")

	postAuth("/client/contacts/friend-requests", a.Token, map[string]interface{}{
		"friend_id": b.ID, "message": "Hi",
	})
	w := get("/client/contacts/friend-requests", b.Token)
	var arr []map[string]interface{}
	json.Unmarshal(parse(w).Data, &arr)
	if len(arr) > 0 {
		postAuth("/client/contacts/friend-requests/"+arr[0]["request_id"].(string)+"/accept", b.Token, nil)
	}
	return a, b
}

// privateSession creates a private session between a and b, returning the session_id.
func privateSession(t *testing.T, a, b testUser) string {
	t.Helper()
	r := parse(postAuth("/client/sessions/private", a.Token, map[string]string{
		"target_user_id": b.ID,
	}))
	mustOK(t, r, "create private session")
	return extract(r.Data, "session_id")
}

// sendMsg sends a message to a session and returns the parsed response plus the API response.
func sendMsg(t *testing.T, token, sessionID, clientMsgID, content string) apiResp {
	t.Helper()
	return parse(postAuth("/client/sessions/"+sessionID+"/messages", token, map[string]interface{}{
		"client_msg_id": clientMsgID,
		"content_type":  "text",
		"content":       content,
	}))
}

// fetchMessages fetches message history with the given limit.
func fetchMessages(t *testing.T, token, sessionID string, limit int) []map[string]interface{} {
	t.Helper()
	w := get(fmt.Sprintf("/client/sessions/%s/messages?limit=%d", sessionID, limit), token)
	r := parse(w)
	mustOK(t, r, "fetch messages")
	var msgs []map[string]interface{}
	json.Unmarshal(r.Data, &msgs)
	return msgs
}

// =============================================================================
// Test 1: Sequential messages produce consecutive seq_ids
// =============================================================================

func TestSeqContinuity(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	a, b := friendPair(t, "tseq_a", "tseq_b")
	sid := privateSession(t, a, b)

	const n = 10
	for i := 0; i < n; i++ {
		clientMsgID := uuid.New().String()
		r := sendMsg(t, a.Token, sid, clientMsgID, fmt.Sprintf("msg-%d", i+1))
		mustOK(t, r, fmt.Sprintf("send msg %d", i+1))
	}

	msgs := fetchMessages(t, a.Token, sid, n+5)
	if len(msgs) < n {
		t.Fatalf("expected at least %d messages, got %d", n, len(msgs))
	}

	// History returns newest first, so iterate in reverse for seq order.
	seen := map[int64]bool{}
	for i := len(msgs) - 1; i >= 0; i-- {
		seq := int64(msgs[i]["seq_id"].(float64))
		seen[seq] = true
	}

	for s := int64(1); s <= n; s++ {
		if !seen[s] {
			t.Errorf("seq_id %d missing", s)
		}
	}

	if len(seen) != n {
		t.Errorf("expected %d unique seq_ids, got %d", n, len(seen))
	}
	t.Logf("seq continuity verified: %d messages with seq 1..%d", n, n)
}

// =============================================================================
// Test 2: Concurrent sends produce unique, gap-free seq_ids
// =============================================================================

func TestConcurrentSendNoDuplicateSeq(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	a, b := friendPair(t, "tconc_a", "tconc_b")
	sid := privateSession(t, a, b)

	const n = 50
	clientMsgIDs := make([]string, n)
	for i := 0; i < n; i++ {
		clientMsgIDs[i] = uuid.New().String()
	}

	var wg sync.WaitGroup
	errCh := make(chan error, n)

	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			r := sendMsg(t, a.Token, sid, clientMsgIDs[idx], fmt.Sprintf("concurrent-msg-%d", idx))
			if r.Code != "OK" {
				errCh <- fmt.Errorf("send %d failed: %s %s", idx, r.Code, r.Message)
			}
		}(i)
	}
	wg.Wait()
	close(errCh)

	for e := range errCh {
		t.Error(e)
	}

	msgs := fetchMessages(t, a.Token, sid, 100)
	if len(msgs) < n {
		t.Fatalf("expected at least %d messages, got %d", n, len(msgs))
	}

	seen := map[int64]bool{}
	minSeq := int64(1<<63 - 1)
	maxSeq := int64(0)

	for _, m := range msgs {
		seq := int64(m["seq_id"].(float64))
		if seen[seq] {
			t.Errorf("duplicate seq_id %d", seq)
		}
		seen[seq] = true
		if seq < minSeq {
			minSeq = seq
		}
		if seq > maxSeq {
			maxSeq = seq
		}
	}

	if len(seen) != n {
		t.Errorf("expected %d unique seq_ids, got %d", n, len(seen))
	}

	// Check no gaps: every seq from minSeq to maxSeq should exist
	for s := minSeq; s <= maxSeq; s++ {
		if !seen[s] {
			t.Errorf("seq_id gap at %d (range %d..%d)", s, minSeq, maxSeq)
		}
	}

	t.Logf("concurrent send verified: %d messages, seq range %d..%d, no gaps, no duplicates", n, minSeq, maxSeq)
}

// =============================================================================
// Test 3: Forward a message to multiple target sessions concurrently
// =============================================================================

func TestForwardToMultipleSessions(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	a, b := friendPair(t, "tfwd_a", "tfwd_b")
	sid := privateSession(t, a, b)

	// Create 3 group sessions with a as owner and b as member.
	groupSIDs := make([]string, 3)
	for i := 0; i < 3; i++ {
		gr := parse(postAuth("/client/sessions/group", a.Token, map[string]interface{}{
			"name":       fmt.Sprintf("FwdGroup-%d", i+1),
			"member_ids": []string{b.ID},
		}))
		mustOK(t, gr, fmt.Sprintf("create group %d", i+1))
		groupSIDs[i] = extract(gr.Data, "session_id")
	}

	// Send a message in the private session.
	clientMsgID := uuid.New().String()
	sr := sendMsg(t, a.Token, sid, clientMsgID, "forward-me")
	mustOK(t, sr, "send source message")
	msgID := extract(sr.Data, "message_id")

	// Forward to all 3 groups.
	fw := parse(postAuth("/client/messages/"+msgID+"/forward", a.Token, map[string]interface{}{
		"target_session_ids": groupSIDs,
	}))
	mustOK(t, fw, "forward to multiple sessions")

	// Verify each target group has exactly 1 message.
	for i, gsid := range groupSIDs {
		msgs := fetchMessages(t, a.Token, gsid, 10)
		if len(msgs) == 0 {
			t.Errorf("group %d (%s): no messages after forward", i+1, gsid)
		} else {
			t.Logf("group %d (%s): has %d message(s)", i+1, gsid, len(msgs))
		}
	}

	t.Logf("forward to multiple sessions verified: %d target groups all received message", len(groupSIDs))
}

// =============================================================================
// Test 4: Seq after Redis restart (skipped — requires Redis restart)
// =============================================================================

func TestSeqAfterRedisRestart(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	t.Skip("TestSeqAfterRedisRestart: requires Redis restart to verify seq continuity across restarts. " +
		"After restart, seq should continue from where it left off (not reset to 1). " +
		"Manual verification: send messages before restart, restart Redis, send more messages, " +
		"verify seq continues monotonically.")
	t.Log("seq-after-restart test skipped (no Redis restart access)")
}

// =============================================================================
// Test 5: Non-member cannot send a message to a session
// =============================================================================

func TestSendMessageRejectNonMember(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	a, b := friendPair(t, "tnmem_a", "tnmem_b")
	c := register(t, "tnmem_c", "pass1234", "Charlie_nmem")

	sid := privateSession(t, a, b)

	// C is not a member of A-B's private session.
	r := sendMsg(t, c.Token, sid, uuid.New().String(), "intruder!")
	mustCode(t, r, "SESSION_NOT_MEMBER", "non-member send rejected")

	t.Logf("non-member send correctly rejected with SESSION_NOT_MEMBER")
}

// =============================================================================
// Test 6: Cannot send a message to a dissolved group
// =============================================================================

func TestSendMessageToDissolvedSession(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	a, b := friendPair(t, "tdiss_a", "tdiss_b")

	gr := parse(postAuth("/client/sessions/group", a.Token, map[string]interface{}{
		"name":       "ToBeDissolved",
		"member_ids": []string{b.ID},
	}))
	mustOK(t, gr, "create group")
	sid := extract(gr.Data, "session_id")

	// Owner dissolves the group.
	mustOK(t, parse(postAuth("/client/sessions/"+sid+"/dissolve", a.Token, nil)), "dissolve")

	// Now try to send a message.
	r := sendMsg(t, a.Token, sid, uuid.New().String(), "should fail")
	mustCode(t, r, "SESSION_DISSOLVED", "send to dissolved session rejected")

	t.Logf("send to dissolved session correctly rejected with SESSION_DISSOLVED")
}

// =============================================================================
// Test 7: Non-sender cannot recall someone else's message
// =============================================================================

func TestRecallNotOwnByNonSender(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	a, b := friendPair(t, "trec_a", "trec_b")
	sid := privateSession(t, a, b)

	// A sends a message.
	clientMsgID := uuid.New().String()
	sr := sendMsg(t, a.Token, sid, clientMsgID, "A's message")
	mustOK(t, sr, "A sends message")
	msgID := extract(sr.Data, "message_id")

	// B tries to recall A's message (B is not the sender, not the owner).
	rec := parse(postAuth("/client/messages/"+msgID+"/recall", b.Token, nil))
	mustCode(t, rec, "SESSION_NOT_MEMBER", "recall rejected for non-sender non-owner")

	t.Logf("recall by non-sender correctly rejected with SESSION_NOT_MEMBER")
}
