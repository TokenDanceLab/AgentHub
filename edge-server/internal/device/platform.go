package device

import (
	"errors"
	"runtime"
)

// ErrUnsupportedPlatform keeps paired execution fail-closed until its private
// storage and workspace contracts have a native Windows implementation.
var ErrUnsupportedPlatform = errors.New("paired Edge execution requires POSIX private storage; Windows is not supported")

func ValidatePlatform() error {
	if runtime.GOOS == "windows" {
		return ErrUnsupportedPlatform
	}
	return nil
}
