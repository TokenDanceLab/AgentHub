package message

import (
	"reflect"

	"github.com/agenthub/hub-server/internal/cache"
)

// resolveCache falls back to cache.NoOpCache when the injected Cache is nil
// (including typed-nil interface values). Package-local copy of the flat
// service isNilCache pattern — do not import flat service to avoid cycles.
func resolveCache(c Cache) Cache {
	if isNilCache(c) {
		return cache.NoOpCache{}
	}
	return c
}

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
