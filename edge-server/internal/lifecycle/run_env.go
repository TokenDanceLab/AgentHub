package lifecycle

import (
	"log/slog"
	"strings"

	"github.com/agenthub/edge-server/internal/store"
)

// envForRun builds the environment for a child process.
// When profileEnv is nil the child receives a minimal sanitized environment
// (only whitelisted parent vars + extraEnv + AGENTHUB_* runtime vars).
// A non-nil profileEnv is used verbatim as the base (administrator-configured).
func envForRun(run store.Run, profileEnv, extraEnv []string) []string {
	var env []string
	if profileEnv == nil {
		var audit EnvFilterAudit
		env, audit = SanitizedEnv(nil, extraEnv)
		// Log run-scoped audit context when vars were filtered.
		if audit.SensitiveVars > 0 || audit.NotWhitelisted > 0 {
			slog.Info("env sanitized for run",
				"runId", run.ID,
				"total", audit.TotalVars,
				"passed", audit.PassedVars,
				"sensitive", audit.SensitiveVars,
				"not_whitelisted", audit.NotWhitelisted,
			)
		}
	} else {
		// Administrator explicitly configured the environment, respect it,
		// but still warn about any sensitive-looking variables it includes.
		for _, kv := range profileEnv {
			key, _, _ := strings.Cut(kv, "=")
			if IsSensitiveEnvKey(key) {
				slog.Warn("sensitive env var present in explicitly configured agent environment", "key", key)
			}
		}
		env = append(append([]string(nil), profileEnv...), extraEnv...)
	}
	return append(env,
		"AGENTHUB_RUN_ID="+run.ID,
		"AGENTHUB_PROJECT_ID="+run.ProjectID,
		"AGENTHUB_THREAD_ID="+run.ThreadID,
	)
}
