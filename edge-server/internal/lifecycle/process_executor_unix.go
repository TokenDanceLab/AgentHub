//go:build !windows

package lifecycle

import (
	"os/exec"
	"syscall"
)

// setResourceLimits applies OS-level resource limits to a child process.
// On Unix, this sets process group isolation so the child does not become
// a new session leader and won't leave a zombie if the parent exits.
func setResourceLimits(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
}
