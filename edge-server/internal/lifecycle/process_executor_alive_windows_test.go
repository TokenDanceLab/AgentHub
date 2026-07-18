//go:build windows

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
	const (
		// PROCESS_QUERY_LIMITED_INFORMATION is enough for GetExitCodeProcess.
		processQueryLimitedInformation = 0x1000
		stillActive                    = 259
	)
	h, err := syscall.OpenProcess(processQueryLimitedInformation, false, uint32(proc.Pid))
	if err != nil {
		return false
	}
	defer syscall.CloseHandle(h)

	var code uint32
	if err := syscall.GetExitCodeProcess(h, &code); err != nil {
		return false
	}
	return code == stillActive
}
