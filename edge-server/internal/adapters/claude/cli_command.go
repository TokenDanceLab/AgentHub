package claude

import (
	"os"
	"path/filepath"
	"strings"
)

// resolveNodeCLICommand handles Windows .cmd shim bypass for npm-installed
// Node.js CLIs (Claude Code).
//
// On Windows, npm installs a .cmd shim that forwards args via %*, which corrupts
// multiline prompts when launched via os/exec. This function resolves the underlying
// Node.js entrypoint and returns it with the node binary path so prompts are passed
// as real argv values.
//
// Parameters:
//   - binaryPath: the CLI name or path (e.g. "claude")
//   - entrypoint: relative path from the .cmd shim directory to the JS entrypoint
//     (e.g. "node_modules/@anthropic-ai/claude-code/cli.js")
//   - lookPath: typically exec.LookPath, injected for testability
//   - stat: typically os.Stat, injected for testability
//   - goos: typically runtime.GOOS, injected for testability
func resolveNodeCLICommand(
	binaryPath, entrypoint string,
	lookPath func(string) (string, error),
	stat func(string) (os.FileInfo, error),
	goos string,
) (string, []string, bool) {
	resolved, err := lookPath(binaryPath)
	if err != nil {
		return binaryPath, nil, false
	}

	if goos != "windows" || !strings.EqualFold(filepath.Ext(resolved), ".cmd") {
		return resolved, nil, true
	}

	script := filepath.Join(filepath.Dir(resolved), entrypoint)
	info, err := stat(script)
	if err != nil || info.IsDir() {
		return resolved, nil, true
	}
	nodePath, err := lookPath("node")
	if err != nil {
		return resolved, nil, true
	}
	return nodePath, []string{script}, true
}
