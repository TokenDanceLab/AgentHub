package sdk

import (
	"runtime"
	"testing"
)

// TestSDKNoopCommandReturnsNonEmptyCmd tests that sdkNoopCommand returns a
// non-empty command path on all platforms.
func TestSDKNoopCommandReturnsNonEmptyCmd(t *testing.T) {
	cmd, args := sdkNoopCommand()
	if cmd == "" {
		t.Fatal("sdkNoopCommand should return a non-empty command")
	}
	_ = args // args can be nil or non-nil depending on platform
}

// TestSDKNoopCommandPlatformSpecific validates platform-specific behavior.
func TestSDKNoopCommandPlatformSpecific(t *testing.T) {
	cmd, args := sdkNoopCommand()

	if runtime.GOOS == "windows" {
		if cmd != "cmd" {
			t.Errorf("on Windows, command should be 'cmd', got %q", cmd)
		}
		if len(args) != 3 || args[0] != "/c" || args[1] != "exit" || args[2] != "0" {
			t.Errorf("on Windows, args should be [/c exit 0], got %v", args)
		}
	} else {
		if cmd != "true" {
			t.Errorf("on non-Windows, command should be 'true', got %q", cmd)
		}
		if len(args) != 0 {
			t.Errorf("on non-Windows, args should be nil/empty, got %v", args)
		}
	}
}

// TestSDKNoopCommandIdempotent tests that sdkNoopCommand returns consistent results.
func TestSDKNoopCommandIdempotent(t *testing.T) {
	cmd1, args1 := sdkNoopCommand()
	cmd2, args2 := sdkNoopCommand()

	if cmd1 != cmd2 {
		t.Fatalf("sdkNoopCommand is not idempotent: cmd1=%q cmd2=%q", cmd1, cmd2)
	}
	if len(args1) != len(args2) {
		t.Fatalf("sdkNoopCommand args length changed: %d vs %d", len(args1), len(args2))
	}
	for i := range args1 {
		if args1[i] != args2[i] {
			t.Fatalf("sdkNoopCommand arg[%d] changed: %q vs %q", i, args1[i], args2[i])
		}
	}
}
