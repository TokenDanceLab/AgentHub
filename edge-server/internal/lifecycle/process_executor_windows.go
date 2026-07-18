//go:build windows

package lifecycle

import (
	"os"
	"os/exec"
	"syscall"
)

// setResourceLimits applies OS-level resource limits to a child process.
// On Windows, this sets CREATE_NEW_PROCESS_GROUP so the child starts in a
// new process group. Graceful interrupt can then target the group; force
// kill still uses TerminateProcess on the direct child (full Job Object
// tree kill is residual work).
func setResourceLimits(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags = syscall.CREATE_NEW_PROCESS_GROUP
}

// signalProcessGraceful requests a cooperative shutdown. On Windows,
// Process.Signal(os.Interrupt) is not fully supported for arbitrary
// processes and may return an error; the force path then escalates to Kill.
func signalProcessGraceful(proc *os.Process) error {
	if proc == nil {
		return nil
	}
	return proc.Signal(os.Interrupt)
}

// killProcessTree force-terminates the direct child process. Grandchildren
// may still require Job Object containment (residual); CREATE_NEW_PROCESS_GROUP
// alone does not make TerminateProcess cascade.
func killProcessTree(proc *os.Process) error {
	if proc == nil {
		return nil
	}
	return proc.Kill()
}
