package message

import "github.com/agenthub/hub-server/internal/cache"

// resolveCache returns c, falling back to cache.NoOpCache when c is nil or a
// typed-nil cache port. Thin type-bridge over cache.ResolveCache so call sites
// stay on the package-local Cache interface; the nil-detection logic lives in
// the shared internal/cache helper (Audit-D §4 cluster 2). Kept package-local
// rather than calling cache.ResolveCache directly at each call site because the
// message Cache interface is package-local and Go cannot infer the generic
// type parameter from a mix of the interface port and the NoOpCache fallback.
func resolveCache(c Cache) Cache {
	return cache.ResolveCache[Cache](c, cache.NoOpCache{})
}
