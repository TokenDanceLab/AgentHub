//go:build windows

package lifecycle

import (
	"os/exec"
	"syscall"
)

// setResourceLimits applies OS-level resource limits to a child process.
// On Windows, this sets CREATE_NEW_PROCESS_GROUP so the child and all its
// descendants can be terminated as a group via Job Object semantics.
// Without this, os.Process.Kill only kills the direct child, leaving
// grandchild processes (shell commands, node workers) as orphans.
func setResourceLimits(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags = syscall.CREATE_NEW_PROCESS_GROUP
}
