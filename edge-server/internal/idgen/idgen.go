// Package idgen is the single implementation of prefixed random IDs for the
// edge server: 16 lowercase hex chars derived from 8 crypto/rand bytes.
//
// Five near-identical copies previously lived in api/genID, events/genID,
// mcp/generateID, runcontrol/generateRunID and orchestrator/genHexID; the
// simple copies silently ignored crypto/rand errors and would emit all-zero
// IDs (collision) while the mcp copy carried a monotonic fallback. The
// unified implementation keeps the fallback everywhere.
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
