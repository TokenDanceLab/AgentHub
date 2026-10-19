package lifecycle

import (
	"fmt"
	"log/slog"
	"strings"

	"github.com/agenthub/edge-server/internal/store"
)

// envForAdapterOrProfile builds the child process env for adapter mode (overlay
// auth vars onto a sanitized base) or profile mode (administrator-configured base).
// In adapter mode, extraEnv originates from the adapter's ExtraEnvTemplate expansion
// and is not covered by the profileEnv sensitive-var warning in envForRun; warn here
// so audits see per-key signals without leaking values.
func envForAdapterOrProfile(run store.Run, hasAdapter bool, profileOrAdapterEnv, extraEnv []string) []string {
	if hasAdapter {
		for _, kv := range extraEnv {
			key, _, _ := strings.Cut(kv, "=")
			if IsSensitiveEnvKey(key) {
				slog.Warn("sensitive env var present in adapter extra environment", "runId", run.ID, "key", key)
			}
		}
		return envForRun(run, nil, append(extraEnv, profileOrAdapterEnv...))
	}
	return envForRun(run, profileOrAdapterEnv, extraEnv)
}

// pipeOpenError wraps a pipe-open failure with the pipe name.
func pipeOpenError(pipe string, err error) error {
	return fmt.Errorf("open %s pipe: %w", pipe, err)
}
