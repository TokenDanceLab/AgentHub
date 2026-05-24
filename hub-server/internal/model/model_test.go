package model

import (
	"encoding/json"
	"testing"
	"time"
)

// --- Constant value tests ---

func TestSenderTypeConstants(t *testing.T) {
	if SenderTypeUser != "user" {
		t.Errorf("SenderTypeUser = %q, want %q", SenderTypeUser, "user")
	}
	if SenderTypeAgent != "agent" {
		t.Errorf("SenderTypeAgent = %q, want %q", SenderTypeAgent, "agent")
	}
}

func TestContentTypeConstants(t *testing.T) {
	tests := []struct {
		name     string
		constant string
		expected string
	}{
		{"ContentTypeText", ContentTypeText, "text"},
		{"ContentTypeCode", ContentTypeCode, "code"},
		{"ContentTypeDiff", ContentTypeDiff, "diff"},
		{"ContentTypeImage", ContentTypeImage, "image"},
		{"ContentTypeFile", ContentTypeFile, "file"},
		{"ContentTypeLinkCard", ContentTypeLinkCard, "link_card"},
		{"ContentTypeDeployCard", ContentTypeDeployCard, "deploy_card"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.constant != tt.expected {
				t.Errorf("%s = %q, want %q", tt.name, tt.constant, tt.expected)
			}
		})
	}
}

func TestSessionTypeConstants(t *testing.T) {
	if SessionTypePrivate != "private" {
		t.Errorf("SessionTypePrivate = %q, want %q", SessionTypePrivate, "private")
	}
	if SessionTypeGroup != "group" {
		t.Errorf("SessionTypeGroup = %q, want %q", SessionTypeGroup, "group")
	}
}

// --- User JSON serialization ---

func TestUserJSONMarshal(t *testing.T) {
	now := time.Date(2025, 1, 15, 10, 30, 0, 0, time.UTC)
	u := User{
		ID:           "user-abc-123",
		Username:     "alice",
		PasswordHash: "$2a$10$xXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXx",
		Nickname:     "Alice",
		AvatarURL:    "https://example.com/avatar.png",
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	data, err := json.Marshal(u)
	if err != nil {
		t.Fatalf("json.Marshal(User) error = %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("json.Unmarshal error = %v", err)
	}

	// PasswordHash has json:"-" tag and must NOT appear.
	if _, ok := result["password_hash"]; ok {
		t.Error("password_hash should not be present in JSON (json:\"-\")")
	}
	if _, ok := result["PasswordHash"]; ok {
		t.Error("PasswordHash should not be present in JSON (json:\"-\")")
	}

	if result["id"] != "user-abc-123" {
		t.Errorf("id = %v, want user-abc-123", result["id"])
	}
	if result["username"] != "alice" {
		t.Errorf("username = %v, want alice", result["username"])
	}
	if result["nickname"] != "Alice" {
		t.Errorf("nickname = %v, want Alice", result["nickname"])
	}
	if result["avatar_url"] != "https://example.com/avatar.png" {
		t.Errorf("avatar_url = %v, want https://example.com/avatar.png", result["avatar_url"])
	}
}

func TestUserJSONOmitempty(t *testing.T) {
	// AvatarURL is omitempty; empty string should not appear.
	u := User{
		ID:       "user-1",
		Username: "bob",
		Nickname: "Bob",
	}

	data, err := json.Marshal(u)
	if err != nil {
		t.Fatalf("json.Marshal error = %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("json.Unmarshal error = %v", err)
	}

	if _, ok := result["avatar_url"]; ok {
		t.Error("avatar_url should not be present when empty (omitempty)")
	}
}

func TestUserJSONUnmarshal(t *testing.T) {
	jsonStr := `{
		"id": "user-xyz",
		"username": "charlie",
		"nickname": "Charlie",
		"avatar_url": "https://example.com/charlie.png"
	}`

	var u User
	if err := json.Unmarshal([]byte(jsonStr), &u); err != nil {
		t.Fatalf("json.Unmarshal error = %v", err)
	}

	if u.ID != "user-xyz" {
		t.Errorf("ID = %q, want user-xyz", u.ID)
	}
	if u.Username != "charlie" {
		t.Errorf("Username = %q, want charlie", u.Username)
	}
	if u.Nickname != "Charlie" {
		t.Errorf("Nickname = %q, want Charlie", u.Nickname)
	}
	if u.AvatarURL != "https://example.com/charlie.png" {
		t.Errorf("AvatarURL = %q, want https://example.com/charlie.png", u.AvatarURL)
	}
	// PasswordHash should remain empty (not in JSON).
	if u.PasswordHash != "" {
		t.Errorf("PasswordHash = %q, want empty (not in JSON)", u.PasswordHash)
	}
}

func TestUserJSONPasswordExcluded(t *testing.T) {
	// Even if JSON includes password_hash, it should NOT be deserialized
	// into the struct because of the json:"-" tag.
	jsonStr := `{
		"id": "user-1",
		"username": "eve",
		"nickname": "Eve",
		"password_hash": "should-be-ignored"
	}`

	var u User
	if err := json.Unmarshal([]byte(jsonStr), &u); err != nil {
		t.Fatalf("json.Unmarshal error = %v", err)
	}
	if u.PasswordHash != "" {
		t.Errorf("PasswordHash = %q, want empty (json:\"-\" should skip it)", u.PasswordHash)
	}
}

// --- Message JSON serialization ---

func TestMessageJSONMarshal(t *testing.T) {
	replyTo := "msg-reply-999"
	m := Message{
		ID:           "msg-001",
		SessionID:    "session-001",
		SeqID:        42,
		ClientMsgID:  "client-001",
		SenderType:   SenderTypeUser,
		SenderID:     "user-001",
		ContentType:  ContentTypeText,
		Content:      `{"text":"hello world"}`,
		ReplyToMsgID: &replyTo,
		Recalled:     false,
	}

	data, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("json.Marshal(Message) error = %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("json.Unmarshal error = %v", err)
	}

	if result["id"] != "msg-001" {
		t.Errorf("id = %v, want msg-001", result["id"])
	}
	if result["session_id"] != "session-001" {
		t.Errorf("session_id = %v, want session-001", result["session_id"])
	}
	if result["seq_id"] != float64(42) {
		t.Errorf("seq_id = %v, want 42", result["seq_id"])
	}
	if result["sender_type"] != SenderTypeUser {
		t.Errorf("sender_type = %v, want %v", result["sender_type"], SenderTypeUser)
	}
	if result["reply_to_message_id"] != "msg-reply-999" {
		t.Errorf("reply_to_message_id = %v, want msg-reply-999", result["reply_to_message_id"])
	}
	if result["recalled"] != false {
		t.Errorf("recalled = %v, want false", result["recalled"])
	}
}

func TestMessageJSONReplyToOmitempty(t *testing.T) {
	// When ReplyToMsgID is nil, reply_to_message_id should not appear.
	m := Message{
		ID:          "msg-002",
		SessionID:   "session-002",
		SenderType:  SenderTypeAgent,
		SenderID:    "agent-001",
		ContentType: ContentTypeCode,
	}

	data, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("json.Marshal error = %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("json.Unmarshal error = %v", err)
	}

	if _, ok := result["reply_to_message_id"]; ok {
		t.Error("reply_to_message_id should not be present when nil (omitempty)")
	}
}

func TestMessageJSONRecalledDefault(t *testing.T) {
	m := Message{
		ID:      "msg-003",
		Content: `{"text":"test"}`,
	}
	if m.Recalled {
		t.Error("Recalled default should be false")
	}
	if m.SeqID != 0 {
		t.Error("SeqID default should be 0")
	}
}

// --- Session JSON serialization ---

func TestSessionJSONMarshal(t *testing.T) {
	s := Session{
		ID:        "session-abc",
		Type:      SessionTypeGroup,
		Name:      "General",
		AvatarURL: "",
		Dissolved: false,
		NextSeq:   100,
	}

	data, err := json.Marshal(s)
	if err != nil {
		t.Fatalf("json.Marshal(Session) error = %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("json.Unmarshal error = %v", err)
	}

	if result["id"] != "session-abc" {
		t.Errorf("id = %v, want session-abc", result["id"])
	}
	if result["type"] != SessionTypeGroup {
		t.Errorf("type = %v, want %v", result["type"], SessionTypeGroup)
	}
	if result["name"] != "General" {
		t.Errorf("name = %v, want General", result["name"])
	}
	if result["dissolved"] != false {
		t.Errorf("dissolved = %v, want false", result["dissolved"])
	}

	// avatar_url is omitempty; empty string should not appear.
	if _, ok := result["avatar_url"]; ok {
		t.Error("avatar_url should not be present when empty (omitempty)")
	}
}

func TestSessionJSONUnmarshal(t *testing.T) {
	jsonStr := `{
		"id": "session-xyz",
		"type": "private",
		"name": "DM",
		"dissolved": true,
		"next_seq": 5
	}`

	var s Session
	if err := json.Unmarshal([]byte(jsonStr), &s); err != nil {
		t.Fatalf("json.Unmarshal error = %v", err)
	}

	if s.ID != "session-xyz" {
		t.Errorf("ID = %q, want session-xyz", s.ID)
	}
	if s.Type != "private" {
		t.Errorf("Type = %q, want private", s.Type)
	}
	if s.Name != "DM" {
		t.Errorf("Name = %q, want DM", s.Name)
	}
	if !s.Dissolved {
		t.Error("Dissolved should be true")
	}
	if s.NextSeq != 5 {
		t.Errorf("NextSeq = %d, want 5", s.NextSeq)
	}
}

func TestSessionOmitemptyFields(t *testing.T) {
	s := Session{
		ID:   "session-min",
		Type: SessionTypePrivate,
	}

	data, err := json.Marshal(s)
	if err != nil {
		t.Fatalf("json.Marshal error = %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("json.Unmarshal error = %v", err)
	}

	// These omitempty fields should not appear when empty/nil.
	for _, field := range []string{"name", "avatar_url", "announcement", "owner_user_id", "last_message_at"} {
		if _, ok := result[field]; ok {
			t.Errorf("%s should not be present when empty/nil (omitempty)", field)
		}
	}
}

// --- Device JSON serialization ---

func TestDeviceJSONMarshal(t *testing.T) {
	d := Device{
		ID:           "device-001",
		UserID:       "user-001",
		DeviceType:   "desktop",
		AppVersion:   "1.0.0",
		Capabilities: `["code","file"]`,
	}

	data, err := json.Marshal(d)
	if err != nil {
		t.Fatalf("json.Marshal(Device) error = %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("json.Unmarshal error = %v", err)
	}

	if result["id"] != "device-001" {
		t.Errorf("id = %v, want device-001", result["id"])
	}
	if result["user_id"] != "user-001" {
		t.Errorf("user_id = %v, want user-001", result["user_id"])
	}
	if result["device_type"] != "desktop" {
		t.Errorf("device_type = %v, want desktop", result["device_type"])
	}
	if result["app_version"] != "1.0.0" {
		t.Errorf("app_version = %v, want 1.0.0", result["app_version"])
	}
}

func TestDeviceJSONOmitemptyFields(t *testing.T) {
	d := Device{
		ID:         "device-min",
		UserID:     "user-min",
		DeviceType: "web",
	}

	data, err := json.Marshal(d)
	if err != nil {
		t.Fatalf("json.Marshal error = %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("json.Unmarshal error = %v", err)
	}

	if _, ok := result["app_version"]; ok {
		t.Error("app_version should not be present when empty (omitempty)")
	}
	if _, ok := result["capabilities"]; ok {
		t.Error("capabilities should not be present when empty (omitempty)")
	}
}

// --- Notification JSON test ---

func TestNotificationJSONMarshal(t *testing.T) {
	n := Notification{
		ID:        "notif-001",
		UserID:    "user-001",
		Type:      TypeFriendRequest,
		Payload:   `{"from_user_id":"user-002","message":"Alice wants to be your friend"}`,
		Read:      false,
		CreatedAt: time.Date(2025, 1, 15, 10, 0, 0, 0, time.UTC),
	}

	data, err := json.Marshal(n)
	if err != nil {
		t.Fatalf("json.Marshal(Notification) error = %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("json.Unmarshal error = %v", err)
	}

	if result["id"] != "notif-001" {
		t.Errorf("id = %v, want notif-001", result["id"])
	}
	if result["user_id"] != "user-001" {
		t.Errorf("user_id = %v, want user-001", result["user_id"])
	}
	if result["type"] != TypeFriendRequest {
		t.Errorf("type = %v, want %v", result["type"], TypeFriendRequest)
	}
	if result["payload"] != `{"from_user_id":"user-002","message":"Alice wants to be your friend"}` {
		t.Errorf("payload = %v, want the friend request payload", result["payload"])
	}
	if result["read"] != false {
		t.Errorf("read = %v, want false", result["read"])
	}
}

// --- Friendship JSON test ---

func TestFriendshipJSONMarshal(t *testing.T) {
	f := Friendship{
		ID:       "friend-001",
		UserID:   "user-001",
		FriendID: "user-002",
		Status:   StatusAccepted,
	}

	data, err := json.Marshal(f)
	if err != nil {
		t.Fatalf("json.Marshal(Friendship) error = %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("json.Unmarshal error = %v", err)
	}

	if result["id"] != "friend-001" {
		t.Errorf("id = %v, want friend-001", result["id"])
	}
	if result["user_id"] != "user-001" {
		t.Errorf("user_id = %v, want user-001", result["user_id"])
	}
	if result["friend_id"] != "user-002" {
		t.Errorf("friend_id = %v, want user-002", result["friend_id"])
	}
	if result["status"] != "accepted" {
		t.Errorf("status = %v, want accepted", result["status"])
	}
}
