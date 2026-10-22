package model

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestUserJSONOmitsRetiredTokenDanceIdentityFields(t *testing.T) {
	legacySubject := "legacy-subject"
	legacyLinkedAt := time.Now().UTC()
	raw, err := json.Marshal(&User{
		ID:                    "00000000-0000-0000-0000-000000000001",
		Username:              "alice",
		Nickname:              "Alice",
		TokenDanceSub:         &legacySubject,
		TokenDanceSubLinkedAt: &legacyLinkedAt,
	})
	if err != nil {
		t.Fatalf("marshal user: %v", err)
	}
	body := string(raw)
	for _, forbidden := range []string{"tokendance_sub", "tokendance_sub_linked_at", legacySubject} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("public user JSON leaked legacy identity field %q: %s", forbidden, body)
		}
	}
}
