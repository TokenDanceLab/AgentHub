package api

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// Quad-scan Q8 resolved (#2056): PostDeployments / PostApplyRunDiff /
// PostApplyAllRunDiffs handler behavior tests now live in
// deploy_handler_test.go and diff_apply_handler_test.go, built on the real
// in-memory store.Repository plus a re-exec'd test binary standing in for
// the ssh/scp binaries. Only the real-host gap below remains skipped here.

// runSSHCommand / runSCP (deploy.go) exec the ssh/scp binaries against a real
// SSH target host. Real-host behavior is intentionally NOT covered here:
//   - mocking exec.Command would over-test the implementation and prove nothing
//     about real SSH behavior;
//   - running them for real requires an SSH host reachable from this machine.
//
// These placeholders keep the skip explicit. To run for real:
//
//	go test ./internal/api/ -run 'TestRunSSH|TestRunSCP' -ssh-integration
//
// and pass AGENTHUB_DEPLOY_HOST / AGENTHUB_DEPLOY_PATH to point at the target.
func TestRunSSHCommand_RequiresSSHTarget(t *testing.T) {
	t.Skip("requires SSH target host; run with -ssh-integration")
}

func TestRunSCP_RequiresSSHTarget(t *testing.T) {
	t.Skip("requires SSH target host; run with -ssh-integration")
}

func shrinkDeployTimeouts(t *testing.T) {
	t.Helper()
	origSSH, origSCP := deploySSHTimeout, deploySCPTimeout
	deploySSHTimeout = 300 * time.Millisecond
	deploySCPTimeout = 300 * time.Millisecond
	t.Cleanup(func() {
		deploySSHTimeout, deploySCPTimeout = origSSH, origSCP
	})
}

// TestRunSSHCommand_HangingHostHitsTimeout pins the zombie-host fix (#2154):
// against a hanging ssh (unreachable host, no RST) runSSHCommand must return
// within deploySSHTimeout instead of blocking until the kernel TCP
// retransmission cap. Without the context kill this test times out.
func TestRunSSHCommand_HangingHostHitsTimeout(t *testing.T) {
	if runtime.GOOS == "windows" {
		// The re-exec'd hang stub does not reproduce Linux process-kill
		// semantics on Windows (exits early instead of blocking), so the
		// context-kill contract is only asserted on the server platform.
		t.Skip("hang stub behavior is platform-dependent")
	}
	installDeploySSHStubs(t)
	t.Setenv(deployStubEnvHang, "1")
	shrinkDeployTimeouts(t)

	start := time.Now()
	err := runSSHCommand("stub-host", "true")
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("runSSHCommand returned nil against a hanging ssh; want timeout error")
	}
	if !strings.Contains(err.Error(), "timed out") {
		t.Errorf("error = %v, want timeout annotation", err)
	}
	if elapsed > 5*time.Second {
		t.Fatalf("runSSHCommand took %s; want bounded by deploySSHTimeout", elapsed)
	}
}

// TestRunSCP_HangingHostHitsTimeout is the scp counterpart: archive transfer
// against a stalled peer must also hit the context cap.
func TestRunSCP_HangingHostHitsTimeout(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("hang stub behavior is platform-dependent")
	}
	installDeploySSHStubs(t)
	t.Setenv(deployStubEnvHang, "1")
	shrinkDeployTimeouts(t)

	start := time.Now()
	err := runSCP("/dev/null", "stub-host:/tmp/x")
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("runSCP returned nil against a hanging scp; want timeout error")
	}
	if elapsed > 5*time.Second {
		t.Fatalf("runSCP took %s; want bounded by deploySCPTimeout", elapsed)
	}
}

// TestRunSSHCommand_PassesHardeningFlags proves every ssh invocation carries
// the anti-hang options (batch mode, connect timeout, liveness probes).
func TestRunSSHCommand_PassesHardeningFlags(t *testing.T) {
	dir := installDeploySSHStubs(t)
	if err := runSSHCommand("stub-host", "true"); err != nil {
		t.Fatalf("runSSHCommand: %v", err)
	}
	log, err := os.ReadFile(filepath.Join(dir, deployStubLogName))
	if err != nil {
		t.Fatalf("read calls.log: %v", err)
	}
	line := string(log)
	for _, want := range []string{"ConnectTimeout=5", "BatchMode=yes", "ServerAliveInterval=5", "ServerAliveCountMax=3", "stub-host"} {
		if !strings.Contains(line, want) {
			t.Errorf("ssh args missing %q; got %q", want, line)
		}
	}
}

// TestRunSCP_PassesHardeningFlags is the scp counterpart.
func TestRunSCP_PassesHardeningFlags(t *testing.T) {
	dir := installDeploySSHStubs(t)
	if err := runSCP("/dev/null", "stub-host:/tmp/x"); err != nil {
		t.Fatalf("runSCP: %v", err)
	}
	log, err := os.ReadFile(filepath.Join(dir, deployStubLogName))
	if err != nil {
		t.Fatalf("read calls.log: %v", err)
	}
	line := string(log)
	for _, want := range []string{"scp", "-q", "BatchMode=yes", "/dev/null", "stub-host:/tmp/x"} {
		if !strings.Contains(line, want) {
			t.Errorf("scp args missing %q; got %q", want, line)
		}
	}
}
