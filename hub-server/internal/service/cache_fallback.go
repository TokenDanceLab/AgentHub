package service

import (
	"context"
	"errors"
	"reflect"
)

var errCacheUnavailable = errors.New("cache unavailable")

// noopCache keeps service-layer tests and offline construction paths from
// panicking when Redis is intentionally not injected. Production App.Run still
// fails fast before routes start if Redis is unavailable.
type noopCache struct{}

func (noopCache) Invalidate(ctx context.Context, keys ...string) error { return nil }

func (noopCache) IsOnline(ctx context.Context, userID string) (bool, error) {
	return false, nil
}

func (noopCache) InitSeqIfAbsent(ctx context.Context, sessionID string, seq int64) error {
	return nil
}

func (noopCache) AllocateSeq(ctx context.Context, sessionID string) (int64, error) {
	return 0, errCacheUnavailable
}

func (noopCache) GetRoute(ctx context.Context, userID, deviceType string) (string, error) {
	return "", errCacheUnavailable
}

func (noopCache) PushPendingTask(ctx context.Context, userID, taskJSON string) error {
	return errCacheUnavailable
}

func resolveAuthCache(c authCache) authCache {
	if isNilCache(c) {
		return noopCache{}
	}
	return c
}

func resolveContactCache(c contactCache) contactCache {
	if isNilCache(c) {
		return noopCache{}
	}
	return c
}

func resolveSessionCache(c sessionCache) sessionCache {
	if isNilCache(c) {
		return noopCache{}
	}
	return c
}

func resolveMessageCache(c messageCache) messageCache {
	if isNilCache(c) {
		return noopCache{}
	}
	return c
}

func resolveAgentCache(c agentCache) agentCache {
	if isNilCache(c) {
		return noopCache{}
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
