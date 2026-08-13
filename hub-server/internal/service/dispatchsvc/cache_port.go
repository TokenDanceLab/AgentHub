package dispatchsvc

import (
	"reflect"

	"github.com/agenthub/hub-server/internal/cache"
)

// resolveDispatchCache validates the route / offline-queue cache port and
// falls back to cache.NoOpCache when nil is passed (for unit tests that do
// not exercise cache paths). Production code must inject a real *cache.Client.
func resolveDispatchCache(c dispatchCache) dispatchCache {
	if isNilCache(c) {
		return cache.NoOpCache{}
	}
	return c
}

// isNilCache reports whether an interface holds nil (typed-nil pointers and
// untyped nil both count).
func isNilCache(c any) bool {
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
