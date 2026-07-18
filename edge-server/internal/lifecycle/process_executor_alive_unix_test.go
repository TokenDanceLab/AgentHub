//go:build !windows

package lifecycle

import (
	"os"
	"syscall"
)

// processLikelyAlive reports whether the OS still has a live process for pid.
// Used by Cancel-grace regression tests (#988).
func processLikelyAlive(proc *os.Process) bool {
	if proc == nil {
		return false
	}
	// Signal 0 does not deliver a signal; it only checks for existence/permissions.
	return syscall.Kill(proc.Pid, 0) == nil
}
