// Package uuidv7 is the Hub Server's entity-ID generator: UUIDv7 strings
// via github.com/google/uuid.
//
// ID scheme across the AgentHub backend (#1675) — one documented scheme,
// four deliberate roles. Not every identifier is a UUID, and that is by
// design; each format exists because of a different requirement:
//
//   - Hub entity IDs (this package): UUIDv7 for every Hub-owned row
//     (session, message, user, task, outbox delivery, team assignment…).
//     Chosen because Hub rows are written from many devices concurrently
//     into a shared Postgres B-tree; UUIDv7 is time-ordered at the leading
//     48 bits, so inserts are roughly sequential (index locality, no
//     v4-style page splits) while still being globally unique without a
//     coordination point.
//   - Edge entity IDs (edge-server/internal/idgen): prefix + 16 hex chars
//     of crypto/rand. Edge rows live in a local SQLite store per device,
//     are shown in local URLs and logs, and never need cross-process
//     ordering — a short, human-scannable, collision-resistant ID is worth
//     more than UUID shape. Keep the prefix convention (run_/proj_/…);
//     do not replace with UUIDv7 here.
//   - Request IDs (github.com/agenthub/pkg/reqlog.NewRequestID): real
//     UUIDv4 with the "req_" prefix, propagated via X-Request-ID for
//     cross-service correlation. Correlation IDs need uniqueness, not
//     ordering.
//   - Trace IDs (github.com/agenthub/pkg/errcode.NewTraceID): "trace_" +
//     per-process monotonic counter. These only correlate a log line with
//     an error response inside one process; a counter is ordered, cheap,
//     and unambiguous in logs — a UUID would be noise.
//
// Rule: pick the format from the role, not from the caller's convenience.
// New Hub entity IDs go through this package; never hand-roll UUID
// formatting (version/variant bits) anywhere.
package uuidv7

import "github.com/google/uuid"

// New returns a new UUIDv7 string. The error is only possible when the
// platform's randomness source fails; treat it as fatal for entity creation.
func New() (string, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return "", err
	}
	return id.String(), nil
}

// Must returns a new UUIDv7 string, swallowing the (practically impossible)
// randomness error. Use only where the call site cannot propagate an error;
// prefer New in constructors that can fail.
func Must() string { id, _ := New(); return id }
