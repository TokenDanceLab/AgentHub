package service

import (
	"testing"
)

func TestNewAuditServiceAllowsNilConfig(t *testing.T) {
	svc := NewAuditService(nil, nil)
	if svc == nil {
		t.Fatal("NewAuditService returned nil")
	}
	svc.Shutdown()
}
