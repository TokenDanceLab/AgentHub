package ws

import "testing"

// Auth() must return the identity written by SetAuth under c.mu — fanout drop
// logging reads through this getter to avoid a data race with SetAuth.
func TestConnAuthReturnsIdentitySnapshot(t *testing.T) {
	c := NewConn(nil)
	c.SetAuth("user-1", "edge", "dev-1")

	userID, deviceType, deviceID := c.Auth()
	if userID != "user-1" {
		t.Fatalf("userID = %q, want %q", userID, "user-1")
	}
	if deviceType != "edge" {
		t.Fatalf("deviceType = %q, want %q", deviceType, "edge")
	}
	if deviceID != "dev-1" {
		t.Fatalf("deviceID = %q, want %q", deviceID, "dev-1")
	}
}
