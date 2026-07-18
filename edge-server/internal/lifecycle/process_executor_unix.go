//go:build !windows

package lifecycle

import (
	"os"
	"os/exec"
	"syscall"
)

// setResourceLimits applies OS-level resource limits to a child process.
// On Unix, this sets process group isolation so the child and its descendants
// share a process group that can be terminated together via negative PID.
func setResourceLimits(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
}

// signalProcessGraceful sends SIGTERM to the child's process group so
// grandchildren started by the agent also receive the signal. Falls back
// to signaling the direct child if group delivery fails.
func signalProcessGraceful(proc *os.Process) error {
	if proc == nil {
		return nil
	}
	if err := syscall.Kill(-proc.Pid, syscall.SIGTERM); err != nil {
		return proc.Signal(syscall.SIGTERM)
	}
	return nil
}

// killProcessTree sends SIGKILL to the child's process group so orphaned
// grandchildren cannot outlive the run. Falls back to killing the direct
// child if group delivery fails.
func killProcessTree(proc *os.Process) error {
	if proc == nil {
		return nil
	}
	if err := syscall.Kill(-proc.Pid, syscall.SIGKILL); err != nil {
		return proc.Kill()
	}
	return nil
}
