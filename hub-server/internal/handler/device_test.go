package handler_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/golang-jwt/jwt/v5"
)

type mockDeviceService struct {
	registerFn func(ctx context.Context, deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error)
}

func (m *mockDeviceService) Register(ctx context.Context, deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
	return m.registerFn(ctx, deviceID, userID, deviceType, appVersion, capabilities)
}

func (m *mockDeviceService) ListDevices(userID string) ([]model.Device, error) {
	return nil, nil
}

func TestDeviceHandler_Register_Success(t *testing.T) {
	svc := &mockDeviceService{
		registerFn: func(ctx context.Context, deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
			return &model.Device{
				ID:           deviceID,
				UserID:       userID,
				DeviceType:   deviceType,
				AppVersion:   appVersion,
				Capabilities: `["chat","agent"]`,
			}, nil
		},
	}
	h := handler.NewDeviceHandler(svc)

	c, w := newGinCtx("POST", "/edge/devices/register", map[string]any{
		"device_id":    testDeviceID,
		"app_version":  "1.0.0",
		"capabilities": []string{"chat", "agent"},
	}, "user_id", "u1", "device_type", "desktop")
	h.Register(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp handler.Response
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Code != "ok" {
		t.Fatalf("expected OK, got %s", resp.Code)
	}
	data, err := json.Marshal(resp.Data)
	if err != nil {
		t.Fatalf("marshal response data: %v", err)
	}
	var device map[string]any
	if err := json.Unmarshal(data, &device); err != nil {
		t.Fatalf("unmarshal response data: %v", err)
	}
	capabilities, ok := device["capabilities"].([]any)
	if !ok {
		t.Fatalf("capabilities has type %T, want array", device["capabilities"])
	}
	if len(capabilities) != 2 || capabilities[0] != "chat" || capabilities[1] != "agent" {
		t.Fatalf("capabilities = %v, want [chat agent]", capabilities)
	}
}

func TestDeviceHandler_Register_InvalidDeviceID(t *testing.T) {
	called := false
	svc := &mockDeviceService{
		registerFn: func(ctx context.Context, deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
			called = true
			return nil, errcode.ErrInternal
		},
	}
	h := handler.NewDeviceHandler(svc)

	c, w := newGinCtx("POST", "/edge/devices/register", map[string]any{
		"device_id": "dev1",
	}, "user_id", "u1", "device_type", "desktop")
	h.Register(c)

	if called {
		t.Fatal("service should not be called for malformed device_id")
	}
	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
	var resp struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Error.Code != "bad_request" {
		t.Fatalf("expected BAD_REQUEST, got %s", resp.Error.Code)
	}
	if resp.Error.Message != "device_id must be a UUID" {
		t.Fatalf("unexpected message %q", resp.Error.Message)
	}
}

func TestDeviceHandler_Register_BadRequest(t *testing.T) {
	svc := &mockDeviceService{registerFn: func(ctx context.Context, deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
		return nil, errcode.ErrInternal
	}}
	h := handler.NewDeviceHandler(svc)

	c, w := newGinCtx("POST", "/edge/devices/register", nil, "user_id", "u1", "device_type", "desktop")
	h.Register(c)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestDeviceHandler_Register_InternalError(t *testing.T) {
	svc := &mockDeviceService{
		registerFn: func(ctx context.Context, deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
			return nil, context.DeadlineExceeded
		},
	}
	h := handler.NewDeviceHandler(svc)

	c, w := newGinCtx("POST", "/edge/devices/register", map[string]any{
		"device_id": testDeviceID,
	}, "user_id", "u1", "device_type", "desktop")
	h.Register(c)

	if w.Code != 500 {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestDeviceHandler_RegisterRejectsMismatchedJWTDeviceID(t *testing.T) {
	called := false
	svc := &mockDeviceService{
		registerFn: func(ctx context.Context, deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
			called = true
			return nil, errcode.ErrInternal
		},
	}
	h := handler.NewDeviceHandler(svc)

	c, w := newGinCtx("POST", "/edge/devices/register", map[string]any{
		"device_id": testDeviceID,
	}, "user_id", "u1", "device_type", "desktop", "device_id", "22222222-2222-4222-8222-222222222222")
	h.Register(c)

	if called {
		t.Fatal("service should not be called when JWT device_id does not match the registered device")
	}
	if w.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Error.Message != "device_id does not match JWT claims" {
		t.Fatalf("message = %q, want JWT device mismatch", resp.Error.Message)
	}
}

func TestDeviceHandler_CloudEdgeRegisterAllowsDifferentCallerDeviceAndIssuesEdgeScopedJWT(t *testing.T) {
	called := false
	svc := &mockDeviceService{
		registerFn: func(ctx context.Context, deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
			called = true
			if deviceID != testDeviceID {
				t.Fatalf("deviceID = %q, want %s", deviceID, testDeviceID)
			}
			if userID != "u1" {
				t.Fatalf("userID = %q, want u1", userID)
			}
			if deviceType != "cloud_edge" {
				t.Fatalf("deviceType = %q, want cloud_edge", deviceType)
			}
			return &model.Device{
				ID:           deviceID,
				UserID:       userID,
				DeviceType:   deviceType,
				AppVersion:   appVersion,
				Capabilities: `["edge"]`,
			}, nil
		},
	}
	h := handler.NewDeviceHandler(svc)
	h.SetJWTConfig("hub-secret-at-least-32-bytes-long!!", time.Hour)

	callerDeviceID := "22222222-2222-4222-8222-222222222222"
	c, w := newGinCtx("POST", "/cloud/edge/register", map[string]any{
		"device_id":    testDeviceID,
		"app_version":  "1.0.0",
		"capabilities": []string{"edge"},
	}, "user_id", "u1", "device_id", callerDeviceID)
	h.CloudEdgeRegister(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !called {
		t.Fatal("service should be called for a distinct cloud edge device id")
	}

	var resp handler.Response
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	data, err := json.Marshal(resp.Data)
	if err != nil {
		t.Fatalf("marshal response data: %v", err)
	}
	var body struct {
		DeviceID   string `json:"device_id"`
		DeviceType string `json:"device_type"`
		JWT        string `json:"jwt"`
	}
	if err := json.Unmarshal(data, &body); err != nil {
		t.Fatalf("unmarshal response data: %v", err)
	}
	if body.DeviceID != testDeviceID {
		t.Fatalf("response device_id = %q, want %s", body.DeviceID, testDeviceID)
	}
	if body.DeviceType != "cloud_edge" {
		t.Fatalf("response device_type = %q, want cloud_edge", body.DeviceType)
	}

	var claims struct {
		UserID     string `json:"user_id"`
		DeviceID   string `json:"device_id"`
		DeviceType string `json:"device_type"`
		Purpose    string `json:"purpose"`
		jwt.RegisteredClaims
	}
	token, err := jwt.ParseWithClaims(body.JWT, &claims, func(t *jwt.Token) (interface{}, error) {
		return []byte("hub-secret-at-least-32-bytes-long!!"), nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		t.Fatalf("parse cloud edge jwt: %v", err)
	}
	if !token.Valid {
		t.Fatal("cloud edge jwt is invalid")
	}
	if claims.Issuer != "agenthub-hub" {
		t.Fatalf("issuer = %q, want agenthub-hub", claims.Issuer)
	}
	if !containsClaimString(claims.Audience, "agenthub-edge") {
		t.Fatalf("audience = %v, want agenthub-edge", claims.Audience)
	}
	if claims.DeviceType != "edge" {
		t.Fatalf("jwt device_type = %q, want edge", claims.DeviceType)
	}
	if claims.Purpose != "edge-api" {
		t.Fatalf("purpose = %q, want edge-api", claims.Purpose)
	}
	if claims.UserID != "u1" || claims.DeviceID != testDeviceID {
		t.Fatalf("jwt user/device = %q/%q, want u1/%s", claims.UserID, claims.DeviceID, testDeviceID)
	}
}

func containsClaimString(values jwt.ClaimStrings, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
