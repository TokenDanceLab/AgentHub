package edgeidentity

import (
	"context"
	"testing"
)

// TestCtxKeyConstants tests that the context key constants have expected values.
func TestCtxKeyConstants(t *testing.T) {
	if HubUserIDKey != "hub_user_id" {
		t.Errorf("HubUserIDKey = %q, want hub_user_id", HubUserIDKey)
	}
	if HubDeviceIDKey != "hub_device_id" {
		t.Errorf("HubDeviceIDKey = %q, want hub_device_id", HubDeviceIDKey)
	}
}

// TestCtxKeyType tests that CtxKey is a string type.
func TestCtxKeyType(t *testing.T) {
	var k CtxKey = "test_key"
	if string(k) != "test_key" {
		t.Errorf("CtxKey string conversion failed")
	}
}

// TestIdentityZeroValue tests the zero-value Identity struct.
func TestIdentityZeroValue(t *testing.T) {
	var id Identity
	if id.UserID != "" {
		t.Errorf("zero-value Identity.UserID should be empty, got %q", id.UserID)
	}
	if id.DeviceID != "" {
		t.Errorf("zero-value Identity.DeviceID should be empty, got %q", id.DeviceID)
	}
}

// TestFromContextEmpty tests FromContext on an empty context.
func TestFromContextEmpty(t *testing.T) {
	id := FromContext(context.Background())
	if id.UserID != "" {
		t.Errorf("empty ctx UserID = %q, want empty", id.UserID)
	}
	if id.DeviceID != "" {
		t.Errorf("empty ctx DeviceID = %q, want empty", id.DeviceID)
	}
}

// TestFromContextUserIDOnly tests FromContext with only a user ID set.
func TestFromContextUserIDOnly(t *testing.T) {
	ctx := context.WithValue(context.Background(), HubUserIDKey, "user-123")
	id := FromContext(ctx)
	if id.UserID != "user-123" {
		t.Errorf("UserID = %q, want user-123", id.UserID)
	}
	if id.DeviceID != "" {
		t.Errorf("DeviceID = %q, want empty", id.DeviceID)
	}
}

// TestFromContextDeviceIDOnly tests FromContext with only a device ID set.
func TestFromContextDeviceIDOnly(t *testing.T) {
	ctx := context.WithValue(context.Background(), HubDeviceIDKey, "device-456")
	id := FromContext(ctx)
	if id.DeviceID != "device-456" {
		t.Errorf("DeviceID = %q, want device-456", id.DeviceID)
	}
	if id.UserID != "" {
		t.Errorf("UserID = %q, want empty", id.UserID)
	}
}

// TestFromContextBoth tests FromContext with both user and device IDs set.
func TestFromContextBoth(t *testing.T) {
	ctx := context.Background()
	ctx = context.WithValue(ctx, HubUserIDKey, "user-123")
	ctx = context.WithValue(ctx, HubDeviceIDKey, "device-456")

	id := FromContext(ctx)
	if id.UserID != "user-123" {
		t.Errorf("UserID = %q, want user-123", id.UserID)
	}
	if id.DeviceID != "device-456" {
		t.Errorf("DeviceID = %q, want device-456", id.DeviceID)
	}
}

// TestFromContextWrongType tests that FromContext ignores values of wrong type.
func TestFromContextWrongType(t *testing.T) {
	ctx := context.WithValue(context.Background(), HubUserIDKey, 12345) // not a string
	id := FromContext(ctx)
	if id.UserID != "" {
		t.Errorf("UserID = %q, want empty (wrong type ignored)", id.UserID)
	}
}

// TestFromContextWrongKey tests that FromContext ignores values set under different keys.
func TestFromContextWrongKey(t *testing.T) {
	ctx := context.WithValue(context.Background(), CtxKey("other_key"), "some-value")
	id := FromContext(ctx)
	if id.UserID != "" || id.DeviceID != "" {
		t.Error("FromContext should only read HubUserIDKey and HubDeviceIDKey")
	}
}

// TestFromContextTableDriven is a table-driven test for various context scenarios.
func TestFromContextTableDriven(t *testing.T) {
	cases := []struct {
		name         string
		userIDVal    any
		deviceIDVal  any
		wantUserID   string
		wantDeviceID string
	}{
		{"empty context", nil, nil, "", ""},
		{"user only", "u1", nil, "u1", ""},
		{"device only", nil, "d1", "", "d1"},
		{"both present", "u1", "d1", "u1", "d1"},
		{"user empty string", "", "d1", "", "d1"},
		{"device empty string", "u1", "", "u1", ""},
		{"user wrong type(int)", 1, "d1", "", "d1"},
		{"device wrong type(int)", "u1", 2, "u1", ""},
		{"both wrong type", 1, 2, "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			if tc.userIDVal != nil {
				ctx = context.WithValue(ctx, HubUserIDKey, tc.userIDVal)
			}
			if tc.deviceIDVal != nil {
				ctx = context.WithValue(ctx, HubDeviceIDKey, tc.deviceIDVal)
			}
			id := FromContext(ctx)
			if id.UserID != tc.wantUserID {
				t.Errorf("UserID = %q, want %q", id.UserID, tc.wantUserID)
			}
			if id.DeviceID != tc.wantDeviceID {
				t.Errorf("DeviceID = %q, want %q", id.DeviceID, tc.wantDeviceID)
			}
		})
	}
}
