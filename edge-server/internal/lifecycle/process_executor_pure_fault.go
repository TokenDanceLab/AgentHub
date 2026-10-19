package lifecycle

import (
	"errors"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
)

// shouldRetrySessionConflict reports whether a wait error should trigger a
// single fresh-session retry inside the session-retry window.
func shouldRetrySessionConflict(err error, stderrCapture string, attempt int, elapsed time.Duration) bool {
	return err != nil &&
		attempt == 0 &&
		isSessionConflictError(err, stderrCapture) &&
		elapsed < sessionRetryWindow
}

// recoverableParseStreamError returns the recoverable ParseStreamError when err
// is a recoverable structured-output parse failure.
func recoverableParseStreamError(err error) (*adapters.ParseStreamError, bool) {
	if err == nil {
		return nil, false
	}
	var psErr *adapters.ParseStreamError
	if errors.As(err, &psErr) && psErr.Recoverable() {
		return psErr, true
	}
	return nil, false
}

// structuredParseOutcome classifies ParseStream errors for the session-retry loop.
type structuredParseOutcome int

const (
	structuredParseNone structuredParseOutcome = iota
	structuredParseRecoverable
	structuredParseFatal
)

// classifyStructuredParseOutcome distinguishes none / recoverable warning /
// fatal publishFailed paths without reworking #179 recovery semantics.
func classifyStructuredParseOutcome(parseErr error) (structuredParseOutcome, *adapters.ParseStreamError) {
	if parseErr == nil {
		return structuredParseNone, nil
	}
	if psErr, ok := recoverableParseStreamError(parseErr); ok {
		return structuredParseRecoverable, psErr
	}
	return structuredParseFatal, nil
}
