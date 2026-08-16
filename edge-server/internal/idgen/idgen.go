// Package idgen is the single implementation of prefixed random IDs for the
// edge server: 16 lowercase hex chars derived from 8 crypto/rand bytes.
//
// Five near-identical copies previously lived in api/genID, events/genID,
// mcp/generateID, runcontrol/generateRunID and orchestrator/genHexID; the
// simple copies silently ignored crypto/rand errors and would emit all-zero
// IDs (collision) while the mcp copy carried a monotonic fallback. The
// unified implementation keeps the fallback everywhere.
//
// Role in the backend ID scheme (#1675, canonical description in
// hub-server/internal/uuidv7): edge IDs deliberately stay prefixed 16-hex
// instead of UUIDs — edge rows live in a per-device local SQLite store and
// are shown in local URLs/logs, where a short scannable ID beats UUID
// shape; Hub entity rows are the UUIDv7 case. Do not "unify" this package
// into UUIDv7.
package idgen

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"sync/atomic"
)

// Hex returns 16 lowercase hex chars from 8 crypto/rand bytes.
// When crypto/rand fails (extremely rare), falls back to a monotonic atomic
// counter — unique within the process lifetime, avoiding the collision risk
// of timestamp-based fallbacks.
func Hex() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		slog.Warn("idgen: crypto/rand.Read failed, falling back to atomic counter", "error", err)
		return fmt.Sprintf("%d", fallbackCounter.Add(1))
	}
	return hex.EncodeToString(b)
}

// New returns prefix + Hex() (e.g. New("run_") → "run_9f2c4a1b7d3e8f0a").
func New(prefix string) string {
	return prefix + Hex()
}

// fallbackCounter provides a monotonic unique counter for the rare case when
// crypto/rand.Read fails. Unique within the process lifetime.
var fallbackCounter atomic.Int64
