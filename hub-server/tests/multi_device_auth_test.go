package tests

import (
	"testing"

	"golang.org/x/crypto/bcrypt"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

func TestLoginAllowsMultipleDesktopDevicesForSameUser(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	user := register(t, "tmultidev1", "pass1234", "MultiDevice")

	first := parse(post("/client/auth/login", map[string]interface{}{
		"username":    user.Username,
		"password":    user.Password,
		"device_type": "desktop",
		"device_id":   "11111111-1111-4111-8111-111111111111",
	}))
	mustOK(t, first, "first desktop login")

	second := parse(post("/client/auth/login", map[string]interface{}{
		"username":    user.Username,
		"password":    user.Password,
		"device_type": "desktop",
		"device_id":   "22222222-2222-4222-8222-222222222222",
	}))
	mustOK(t, second, "second desktop login")

	mustOK(t, parse(post("/client/auth/refresh", map[string]string{
		"refresh_token": extract(first.Data, "refresh_token"),
	})), "refresh first desktop")
	mustOK(t, parse(post("/client/auth/refresh", map[string]string{
		"refresh_token": extract(second.Data, "refresh_token"),
	})), "refresh second desktop")
}

func TestLoginRejectsDeviceIDOwnedByAnotherUser(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	firstUser := createLoginUser(t, "tmultidev2a", "pass1234", "MultiDeviceA")
	secondUser := createLoginUser(t, "tmultidev2b", "pass1234", "MultiDeviceB")
	sharedDeviceID := "33333333-3333-4333-8333-333333333333"

	mustOK(t, parse(post("/client/auth/login", map[string]interface{}{
		"username":    firstUser.Username,
		"password":    firstUser.Password,
		"device_type": "desktop",
		"device_id":   sharedDeviceID,
	})), "first user desktop login")

	mustCode(t, parse(post("/client/auth/login", map[string]interface{}{
		"username":    secondUser.Username,
		"password":    secondUser.Password,
		"device_type": "desktop",
		"device_id":   sharedDeviceID,
	})), "BAD_REQUEST", "second user reuses first user's device_id")
}

func createLoginUser(t *testing.T, username, password, nickname string) testUser {
	t.Helper()

	hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	user := &model.User{
		Username:     username,
		PasswordHash: string(hash),
		Nickname:     nickname,
	}
	if err := repository.CreateUser(db, user); err != nil {
		t.Fatalf("create user %s: %v", username, err)
	}
	return testUser{Username: username, Password: password, ID: user.ID}
}
