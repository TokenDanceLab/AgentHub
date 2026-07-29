package cache

import "reflect"

// IsNilCache reports whether c is nil or a typed-nil value: a nil pointer,
// channel, function, map, or slice held inside a non-nil interface value.
//
// Service packages inject an optional cache port (a package-local Cache
// interface) that may be nil, or hold a typed-nil *Client (whose interface
// value is non-nil even though the underlying pointer is nil). IsNilCache
// detects both so callers can fall back to NoOpCache.
//
// Extracted from the verbatim-duplicated isNilCache copies that lived in the
// session, contact, and message service packages (Audit-D §4 cluster 2). The
// logic is pure: only stdlib reflect, no DB/WS/cache-self dependencies.
func IsNilCache(c any) bool {
	if c == nil {
		return true
	}
	v := reflect.ValueOf(c)
	switch v.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return v.IsNil()
	default:
		return false
	}
}

// ResolveCache returns c when it is non-nil, or fallback otherwise. It is the
// shared resolver for service packages whose injected cache port may be nil
// (or a typed-nil interface) in partial/offline tests and must fall back to a
// NoOpCache.
//
// T is the caller's package-local Cache interface; callers pass cache.NoOpCache{}
// as fallback so the nil branch yields a usable no-op value typed as T. The
// explicit type argument is required: Go cannot infer T from a mix of an
// interface-typed cache port and the concrete NoOpCache fallback.
//
// Extracted from the verbatim-duplicated resolveCache copies that lived in the
// session, contact, and message service packages (Audit-D §4 cluster 2).
func ResolveCache[T any](c T, fallback T) T {
	if IsNilCache(c) {
		return fallback
	}
	return c
}
