package agent

import (
	"github.com/agenthub/hub-server/internal/cache"
)

func resolveAgentCache(c agentCache) agentCache {
	return cache.ResolveCache[agentCache](c, cache.NoOpCache{})
}
