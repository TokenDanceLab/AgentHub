package auth

import (
	"github.com/agenthub/hub-server/internal/cache"
)

// resolveAuthCache validates the cache client and falls back to cache.NoOpCache
// when nil is passed (for unit tests that do not exercise cache paths).
// Production code must inject a real *cache.Client.
func resolveAuthCache(c authCache) authCache {
	return cache.ResolveCache[authCache](c, cache.NoOpCache{})
}
