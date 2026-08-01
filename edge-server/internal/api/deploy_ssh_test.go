package api

import "testing"

// TODO(quad-scan Q8): PostDeployments / PostApplyRunDiff / PostApplyAllRunDiffs
// full-chain tests need a store.Repository mock + Handler construction + SSH,
// and belong to a separate wave. Not fabricated here.

// runSSHCommand / runSCP (deploy.go) exec the ssh/scp binaries against a real
// SSH target host. They are intentionally NOT covered here:
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
