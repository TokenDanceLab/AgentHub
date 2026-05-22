package serviceconfig_test

import (
	"testing"
	"time"

	"github.com/agenthub/agenthub/internal/serviceconfig"
)

func TestFromEnvUsesDefaultsWhenUnset(t *testing.T) {
	t.Setenv("AGENTHUB_HUB_ADDR", "")

	cfg, err := serviceconfig.FromEnv(serviceconfig.Options{
		ServiceName: "hub",
		EnvPrefix:   "AGENTHUB_HUB",
		DefaultAddr: ":8080",
	})
	if err != nil {
		t.Fatalf("FromEnv returned error: %v", err)
	}

	if cfg.Name != "hub" {
		t.Fatalf("Name = %q, want hub", cfg.Name)
	}
	if cfg.Addr != ":8080" {
		t.Fatalf("Addr = %q, want :8080", cfg.Addr)
	}
	if cfg.ReadHeaderTimeout != 5*time.Second {
		t.Fatalf("ReadHeaderTimeout = %s, want 5s", cfg.ReadHeaderTimeout)
	}
}

func TestFromEnvReadsServiceAddress(t *testing.T) {
	t.Setenv("AGENTHUB_EDGE_ADDR", "127.0.0.1:18081")

	cfg, err := serviceconfig.FromEnv(serviceconfig.Options{
		ServiceName: "edge",
		EnvPrefix:   "AGENTHUB_EDGE",
		DefaultAddr: ":8081",
	})
	if err != nil {
		t.Fatalf("FromEnv returned error: %v", err)
	}

	if cfg.Addr != "127.0.0.1:18081" {
		t.Fatalf("Addr = %q, want 127.0.0.1:18081", cfg.Addr)
	}
}

func TestFromEnvRejectsMissingRequiredOptions(t *testing.T) {
	_, err := serviceconfig.FromEnv(serviceconfig.Options{})
	if err == nil {
		t.Fatal("FromEnv returned nil error, want validation error")
	}
}
