package events

import (
	"crypto/rand"
	"fmt"
)

// genID generates a random ID with the given prefix, e.g. "evt_" + 16 hex chars.
func genID(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%s%016x", prefix, b)
}
