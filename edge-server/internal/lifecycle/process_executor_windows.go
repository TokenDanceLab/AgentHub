//go:build windows

package lifecycle

import (
	"os/exec"
)

// setResourceLimits applies OS-level resource limits to a child process.
// On Windows, no special SysProcAttr setup is needed for process group
// isolation (Job Objects would be heavier than warranted here).
func setResourceLimits(cmd *exec.Cmd) {
	// Nothing needed on Windows.
}
