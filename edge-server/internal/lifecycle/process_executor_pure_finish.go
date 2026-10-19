package lifecycle

import (
	"strings"

	"github.com/agenthub/edge-server/internal/store"
)

// trimAgentFailureContent trims and validates content for agent_message persistence.
func trimAgentFailureContent(content string) (string, bool) {
	content = strings.TrimSpace(content)
	if content == "" {
		return "", false
	}
	return content, true
}

// hasAgentMessageForRun reports whether the thread already has an agent_message
// item for the given run (so failure persistence is skipped).
func hasAgentMessageForRun(items []store.Item, runID string) bool {
	for _, item := range items {
		if item.RunID == runID && item.Type == "agent_message" {
			return true
		}
	}
	return false
}

// asStoreWriter returns the store when it implements store.Writer.
func asStoreWriter(runStore store.RunLifecycleStore) (store.Writer, bool) {
	writer, ok := runStore.(store.Writer)
	return writer, ok
}

// agentFailureRepository is the dual Reader+Writer surface needed to persist a
// failed agent_message without inventing a new store API.
type agentFailureRepository interface {
	store.Reader
	store.Writer
}

// asAgentFailureRepository returns the store when it can both list thread items
// and create failure messages.
func asAgentFailureRepository(runStore store.RunLifecycleStore) (agentFailureRepository, bool) {
	repository, ok := runStore.(agentFailureRepository)
	return repository, ok
}

// persistErrorSource exposes the last FileStore persistence failure.
type persistErrorSource interface {
	LastPersistError() error
}

// asPersistErrorSource returns the store when it tracks persistence errors.
func asPersistErrorSource(runStore store.RunLifecycleStore) (persistErrorSource, bool) {
	source, ok := runStore.(persistErrorSource)
	return source, ok
}
