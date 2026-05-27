package service

import (
	"reflect"

	"github.com/agenthub/hub-server/internal/cache"
)

// resolveAuthCache validates the cache client and falls back to cache.NoOpCache
// when nil is passed (for unit tests that do not exercise cache paths).
// Production code must inject a real *cache.Client.
func resolveAuthCache(c authCache) authCache {
	if isNilCache(c) {
		return cache.NoOpCache{}
	}
	return c
}

func resolveContactCache(c contactCache) contactCache {
	if isNilCache(c) {
		return cache.NoOpCache{}
	}
	return c
}

func resolveSessionCache(c sessionCache) sessionCache {
	if isNilCache(c) {
		return cache.NoOpCache{}
	}
	return c
}

func resolveMessageCache(c messageCache) messageCache {
	if isNilCache(c) {
		return cache.NoOpCache{}
	}
	return c
}

func resolveAgentCache(c agentCache) agentCache {
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
