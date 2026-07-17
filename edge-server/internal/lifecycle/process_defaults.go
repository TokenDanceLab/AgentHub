package lifecycle

import "time"

// defaultRunTimeout is the hard deadline for any agent run. A hung subprocess
// should not block the executor goroutine forever.
const defaultRunTimeout = 30 * time.Minute

// defaultShutdownGracePeriod is the time between sending a stdin interrupt and
// escalating to SIGTERM (Unix) or Kill (Windows).
const defaultShutdownGracePeriod = 10 * time.Second

// defaultShutdownForceTimeout is the time between SIGTERM and SIGKILL on Unix.
const defaultShutdownForceTimeout = 5 * time.Second

const (
	defaultMaxConcurrentRuns          = 5
	defaultReadBufferSize             = 32 * 1024
	defaultRunOutputMaxBytes          = 1 * 1024 * 1024 // 1MB cap on run output before temp log write
	hubCallbackTimeout                = 15 * time.Second
	persistedAssistantMessageMaxBytes = 200 * 1024
	persistedFailureMessageMaxBytes   = 8 * 1024

	// sessionRetryWindow is the maximum wall-clock duration (from cmd.Start to
	// cmd.Wait) within which a "session already in use" or "no conversation
	// found" error triggers an automatic retry with a fresh session ID.
	sessionRetryWindow = 10 * time.Second

	// maxSessionRetries is the number of subprocess attempts when a session
	// conflict is detected (initial try + one fresh-session retry).
	maxSessionRetries = 2
)

// resolvePositiveDuration returns d when positive, otherwise fallback.
func resolvePositiveDuration(d, fallback time.Duration) time.Duration {
	if d <= 0 {
		return fallback
	}
	return d
}

// resolveMaxConcurrentRuns returns max when positive, otherwise the package default.
func resolveMaxConcurrentRuns(max int) int {
	if max <= 0 {
		return defaultMaxConcurrentRuns
	}
	return max
}
