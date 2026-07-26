package tests

import (
	"testing"

	"github.com/agenthub/hub-server/internal/jwtutil"
)

// TestRefreshAllowsMultipleDesktopDevicesForSameUser verifies that one user
// can hold independent refresh-token chains on multiple desktop devices:
// refreshing one device's token does not invalidate the other's. Password
// login used to establish the two sessions; after the OIDC migration (#1367)
// the tokens are seeded directly the way the OIDC callback persists them, and
// POST /client/auth/refresh carries the behavior (#1369).
func TestRefreshAllowsMultipleDesktopDevicesForSameUser(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	user := register(t, "tmultidev1", "pass1234", "MultiDevice")

	firstRefresh := seedRefreshToken(t, user.ID, "desktop", "11111111-1111-4111-8111-111111111111")
	secondRefresh := seedRefreshToken(t, user.ID, "desktop", "22222222-2222-4222-8222-222222222222")

	mustOK(t, parse(post("/client/auth/refresh", map[string]string{
		"refresh_token": firstRefresh,
	})), "refresh first desktop")
	mustOK(t, parse(post("/client/auth/refresh", map[string]string{
		"refresh_token": secondRefresh,
	})), "refresh second desktop")
}

// TestDeviceRegisterRejectsDeviceIDOwnedByAnotherUser verifies that a
// device_id claimed by one user cannot be re-registered by another. The
// password login that used to surface this check was removed in #1367; the
// ownership check lives on in repository.UpsertDevice and is reachable via
// POST /edge/devices/register.
func TestDeviceRegisterRejectsDeviceIDOwnedByAnotherUser(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	firstUser := register(t, "tmultidev2a", "pass1234", "MultiDeviceA")
	secondUser := register(t, "tmultidev2b", "pass1234", "MultiDeviceB")
	sharedDeviceID := "33333333-3333-4333-8333-333333333333"

	// /edge/* requires a desktop-type token (DeviceTypeCheck middleware), so
	// mint the desktop JWTs directly like register() does.
	firstTok, err := jwtutil.GenerateAccessToken(firstUser.ID, "desktop", sharedDeviceID, testJWT.Secret, testJWT.AccessTTL)
	if err != nil {
		t.Fatalf("generate first desktop token: %v", err)
	}
	secondTok, err := jwtutil.GenerateAccessToken(secondUser.ID, "desktop", sharedDeviceID, testJWT.Secret, testJWT.AccessTTL)
	if err != nil {
		t.Fatalf("generate second desktop token: %v", err)
	}

	mustOK(t, parse(postAuth("/edge/devices/register", firstTok, map[string]interface{}{
		"device_id": sharedDeviceID, "app_version": "1.0", "capabilities": []string{"claude-code"},
	})), "first user registers device")

	mustCode(t, parse(postAuth("/edge/devices/register", secondTok, map[string]interface{}{
		"device_id": sharedDeviceID, "app_version": "1.0", "capabilities": []string{"claude-code"},
	})), "bad_request", "second user reuses first user's device_id")
}

// stringPtr returns a pointer to the given string.
func stringPtr(s string) *string {
	return &s
}
