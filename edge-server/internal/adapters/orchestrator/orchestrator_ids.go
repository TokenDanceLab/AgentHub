package orchestrator

import "github.com/agenthub/edge-server/internal/idgen"

// genHexID generates a random 16-character hex string.
func genHexID() string {
	return idgen.Hex()
}

// genAgentID generates a random agent instance ID.
func genAgentID() string {
	return idgen.New("agent_")
}
