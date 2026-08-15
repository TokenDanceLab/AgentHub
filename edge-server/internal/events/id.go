package events

import "github.com/agenthub/edge-server/internal/idgen"

// genID generates a random ID with the given prefix, e.g. "evt_" + 16 hex chars.
func genID(prefix string) string {
	return idgen.New(prefix)
}
