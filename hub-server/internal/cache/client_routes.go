package cache

import (
	"context"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// Residual pure-helper peel #1123: device route + kicked-connection helpers.

func routeKey(userID string) string { return "device_route:" + userID }

func routeField(deviceType, deviceID string) string {
	if deviceID == "" {
		return deviceType
	}
	return deviceType + ":" + deviceID
}

// SetRoute records the WebSocket connection for a user device.
func (c *Client) SetRoute(ctx context.Context, userID, deviceType, connID string) error {
	key := routeKey(userID)
	if err := c.rdb.HSet(ctx, key, deviceType, connID).Err(); err != nil {
		return err
	}
	_ = c.rdb.Expire(ctx, key, 7*24*time.Hour).Err()
	return nil
}

// DeleteRoute removes the route entry for a user device. If the hash becomes
// empty after deletion, the entire key is removed to avoid residual empty
// hashes that linger until TTL expiry (P2 audit #2119).
func (c *Client) DeleteRoute(ctx context.Context, userID, deviceType string) error {
	key := routeKey(userID)
	removed, err := c.rdb.HDel(ctx, key, deviceType).Result()
	if err != nil {
		return err
	}
	if removed == 0 {
		return nil // field didn't exist; nothing to clean up
	}
	// Best-effort cleanup: if the hash is now empty, DEL the key.
	// A race where another goroutine adds a field between HDel and HLen is
	// benign — we simply skip the DEL and the next DeleteRoute will retry.
	n, err := c.rdb.HLen(ctx, key).Result()
	if err != nil {
		return nil // swallow; the hash still has fields or is gone
	}
	if n == 0 {
		_ = c.rdb.Del(ctx, key).Err()
	}
	return nil
}

// GetRoute returns the connection ID for a user device.
func (c *Client) GetRoute(ctx context.Context, userID, deviceType string) (string, error) {
	// Try exact match first (backward compatible)
	connID, err := c.rdb.HGet(ctx, routeKey(userID), deviceType).Result()
	if err == nil {
		return connID, nil
	}
	// Scan for compound keys (deviceType:deviceID)
	all, scanErr := c.rdb.HGetAll(ctx, routeKey(userID)).Result()
	if scanErr != nil {
		return "", scanErr
	}
	prefix := deviceType + ":"
	for field, val := range all {
		if strings.HasPrefix(field, prefix) {
			return val, nil
		}
	}
	return "", redis.Nil
}

// GetRouteForDevice returns the exact connection route for a device. It does
// not fall back to another device of the same type.
func (c *Client) GetRouteForDevice(ctx context.Context, userID, deviceType, deviceID string) (string, error) {
	if deviceID == "" {
		return "", redis.Nil
	}
	return c.rdb.HGet(ctx, routeKey(userID), routeField(deviceType, deviceID)).Result()
}

// IsOnline reports whether the user has at least one active device route.
func (c *Client) IsOnline(ctx context.Context, userID string) (bool, error) {
	n, err := c.rdb.HLen(ctx, routeKey(userID)).Result()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// AreOnline reports, for every given user, whether at least one active
// device route exists. The per-user HLEN commands are bundled into a single
// Redis pipeline round trip instead of N sequential ones — ListContacts and
// online-status fanout previously paid one round trip per friend (#2154
// perf lane). Users missing from the result map are offline; a pipeline
// error is returned to the caller (callers today ignore it and treat the
// batch as offline, matching the per-item IsOnline convention).
func (c *Client) AreOnline(ctx context.Context, userIDs []string) (map[string]bool, error) {
	online := make(map[string]bool, len(userIDs))
	if len(userIDs) == 0 {
		return online, nil
	}
	pipe := c.rdb.Pipeline()
	cmds := make([]*redis.IntCmd, 0, len(userIDs))
	ids := make([]string, 0, len(userIDs))
	for _, userID := range userIDs {
		if _, dup := online[userID]; dup {
			continue
		}
		online[userID] = false
		cmds = append(cmds, pipe.HLen(ctx, routeKey(userID)))
		ids = append(ids, userID)
	}
	if _, err := pipe.Exec(ctx); err != nil && err != redis.Nil {
		return nil, err
	}
	for i, cmd := range cmds {
		online[ids[i]] = cmd.Val() > 0
	}
	return online, nil
}

// GetAllRoutes returns all device routes for a user.
func (c *Client) GetAllRoutes(ctx context.Context, userID string) (map[string]string, error) {
	return c.rdb.HGetAll(ctx, routeKey(userID)).Result()
}

// MarkKicked flags a connection ID as kicked (60s TTL).
func (c *Client) MarkKicked(ctx context.Context, connID string) error {
	return c.rdb.Set(ctx, "kicked:"+connID, "1", 60*time.Second).Err()
}

// IsKicked reports whether a connection ID has been kicked.
func (c *Client) IsKicked(ctx context.Context, connID string) (bool, error) {
	n, err := c.rdb.Exists(ctx, "kicked:"+connID).Result()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}
