package handler_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/model"
)

type mockDeviceService struct {
	registerFn func(deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error)
}

func (m *mockDeviceService) Register(deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
	return m.registerFn(deviceID, userID, deviceType, appVersion, capabilities)
}

func TestDeviceHandler_Register_Success(t *testing.T) {
	svc := &mockDeviceService{
		registerFn: func(deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
			return &model.Device{ID: deviceID, UserID: userID, DeviceType: deviceType, AppVersion: appVersion}, nil
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
	if resp.Code != "OK" {
		t.Fatalf("expected OK, got %s", resp.Code)
	}
}

func TestDeviceHandler_Register_InvalidDeviceID(t *testing.T) {
	called := false
	svc := &mockDeviceService{
		registerFn: func(deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
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
	var resp handler.Response
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Code != "BAD_REQUEST" {
		t.Fatalf("expected BAD_REQUEST, got %s", resp.Code)
	}
	if resp.Message != "device_id must be a UUID" {
		t.Fatalf("unexpected message %q", resp.Message)
	}
}

func TestDeviceHandler_Register_BadRequest(t *testing.T) {
	svc := &mockDeviceService{registerFn: func(deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
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
		registerFn: func(deviceID, userID, deviceType, appVersion string, capabilities []string) (*model.Device, error) {
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
