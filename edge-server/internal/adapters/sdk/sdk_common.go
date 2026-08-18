package sdk

import "runtime"

// sdkNoopCommand returns a cross-platform no-op command that exits immediately
// with status 0. SDK adapters (anthropic-sdk, openai-sdk) use this as the
// sentinel command from BuildCommand — the real work happens in ParseStream
// via direct HTTP calls, not subprocess I/O.
func sdkNoopCommand() (string, []string) {
	if runtime.GOOS == "windows" {
		return "cmd", []string{"/c", "exit", "0"}
	}
	return "true", nil
}
