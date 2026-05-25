package tests

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/model"
)

func TestMessagePinRejectsCrossSessionMessage(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })

	alice := seedPinSecurityUser(t, "tpinsec_a", "AlicePinSec")
	bob := seedPinSecurityUser(t, "tpinsec_b", "BobPinSec")
	charlie := seedPinSecurityUser(t, "tpinsec_c", "CharliePinSec")

	aliceSessionID := seedPrivateSession(t, alice.ID, bob.ID)
	otherSessionID := seedPrivateSession(t, charlie.ID, bob.ID)

	_ = sendTextMessage(t, alice.Token, aliceSessionID, "00000000-0000-0000-0000-00000000f101", "safe target session")
	otherMessageID := sendTextMessage(t, charlie.Token, otherSessionID, "00000000-0000-0000-0000-00000000f102", "do not leak")

	resp := parse(postAuth("/client/messages/"+otherMessageID+"/pin", alice.Token, map[string]string{
		"session_id": aliceSessionID,
	}))
	mustCode(t, resp, "MSG_NOT_FOUND", "pin message from another session")
}

func TestListPinsDoesNotLeakHistoricalCrossSessionPin(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })

	alice := seedPinSecurityUser(t, "tpinsec2_a", "AlicePinSec2")
	bob := seedPinSecurityUser(t, "tpinsec2_b", "BobPinSec2")
	charlie := seedPinSecurityUser(t, "tpinsec2_c", "CharliePinSec2")

	aliceSessionID := seedPrivateSession(t, alice.ID, bob.ID)
	otherSessionID := seedPrivateSession(t, charlie.ID, bob.ID)

	visibleMessageID := sendTextMessage(t, alice.Token, aliceSessionID, "00000000-0000-0000-0000-00000000f201", "visible pin")
	otherMessageID := sendTextMessage(t, charlie.Token, otherSessionID, "00000000-0000-0000-0000-00000000f202", "historical bad pin")

	if err := db.Create(&model.MessagePin{
		SessionID:      aliceSessionID,
		MessageID:      visibleMessageID,
		PinnedByUserID: alice.ID,
		PinnedAt:       time.Now(),
	}).Error; err != nil {
		t.Fatalf("seed visible pin: %v", err)
	}
	if err := db.Create(&model.MessagePin{
		SessionID:      aliceSessionID,
		MessageID:      otherMessageID,
		PinnedByUserID: alice.ID,
		PinnedAt:       time.Now().Add(time.Second),
	}).Error; err != nil {
		t.Fatalf("seed cross-session pin: %v", err)
	}

	resp := parse(get("/client/sessions/"+aliceSessionID+"/pins", alice.Token))
	mustOK(t, resp, "list pins")

	var pins []map[string]interface{}
	if err := json.Unmarshal(resp.Data, &pins); err != nil {
		t.Fatalf("decode pins: %v", err)
	}
	if len(pins) != 1 {
		t.Fatalf("expected only same-session pin, got %d: %#v", len(pins), pins)
	}
	if pins[0]["id"] != visibleMessageID {
		t.Fatalf("expected visible message %s, got %#v", visibleMessageID, pins[0]["id"])
	}
}

func seedPinSecurityUser(t *testing.T, username, nickname string) testUser {
	t.Helper()

	user := &model.User{
		Username:     username,
		Nickname:     nickname,
		PasswordHash: "seeded-test-user",
	}
	if err := db.Create(user).Error; err != nil {
		t.Fatalf("seed user %s: %v", username, err)
	}

	secret := os.Getenv("AGENTHUB_JWT_SECRET")
	if secret == "" {
		t.Fatal("AGENTHUB_JWT_SECRET must be set for integration auth")
	}
	token, err := jwtutil.GenerateAccessToken(user.ID, "web", testDeviceID(username, "web"), secret, time.Hour)
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}
	return testUser{Username: username, Token: token, ID: user.ID}
}

func seedPrivateSession(t *testing.T, userA, userB string) string {
	t.Helper()
	session := &model.Session{Type: model.SessionTypePrivate}
	if err := db.Create(session).Error; err != nil {
		t.Fatalf("seed session: %v", err)
	}
	members := []*model.SessionMember{
		{SessionID: session.ID, MemberType: model.MemberTypeUser, MemberID: userA, Role: model.MemberRoleMember},
		{SessionID: session.ID, MemberType: model.MemberTypeUser, MemberID: userB, Role: model.MemberRoleMember},
	}
	if err := db.Create(&members).Error; err != nil {
		t.Fatalf("seed session members: %v", err)
	}
	return session.ID
}

func sendTextMessage(t *testing.T, token, sessionID, clientMsgID, text string) string {
	t.Helper()
	resp := parse(postAuth("/client/sessions/"+sessionID+"/messages", token, map[string]interface{}{
		"client_msg_id": clientMsgID,
		"content_type":  "text",
		"content":       text,
	}))
	mustOK(t, resp, "send message")
	return extract(resp.Data, "message_id")
}
