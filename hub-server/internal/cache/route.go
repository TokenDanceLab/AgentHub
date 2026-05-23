package cache

import (
	"context"
	"encoding/json"
	"time"
)

func routeKey(userID string) string { return "device_route:" + userID }

func SetRoute(ctx context.Context, userID, deviceType, connID string) error {
	return RDB.HSet(ctx, routeKey(userID), deviceType, connID).Err()
}

func DeleteRoute(ctx context.Context, userID, deviceType string) error {
	return RDB.HDel(ctx, routeKey(userID), deviceType).Err()
}

func GetRoute(ctx context.Context, userID, deviceType string) (string, error) {
	return RDB.HGet(ctx, routeKey(userID), deviceType).Result()
}

func IsOnline(ctx context.Context, userID string) (bool, error) {
	n, err := RDB.HLen(ctx, routeKey(userID)).Result()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

func GetAllRoutes(ctx context.Context, userID string) (map[string]string, error) {
	return RDB.HGetAll(ctx, routeKey(userID)).Result()
}

func MarkKicked(ctx context.Context, connID string) error {
	return RDB.Set(ctx, "kicked:"+connID, "1", 60*time.Second).Err()
}

func IsKicked(ctx context.Context, connID string) (bool, error) {
	n, err := RDB.Exists(ctx, "kicked:"+connID).Result()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// Pending task offline queue (Redis List)

func pendingTaskKey(userID string) string { return "pending_tasks:" + userID }

// PushPendingTask pushes a task JSON to the user's offline pending queue.
func PushPendingTask(ctx context.Context, userID, taskJSON string) error {
	return RDB.LPush(ctx, pendingTaskKey(userID), taskJSON).Err()
}

// PopPendingTasks pops all pending tasks for a user and clears the queue.
func PopPendingTasks(ctx context.Context, userID string) ([]string, error) {
	key := pendingTaskKey(userID)
	tasks, err := RDB.LRange(ctx, key, 0, -1).Result()
	if err != nil {
		return nil, err
	}
	if len(tasks) > 0 {
		RDB.Del(ctx, key)
	}
	// unmarshal each to verify, return raw strings
	result := make([]string, 0, len(tasks))
	for _, t := range tasks {
		var raw json.RawMessage
		if json.Unmarshal([]byte(t), &raw) == nil {
			result = append(result, t)
		}
	}
	return result, nil
}

// PendingTaskCount returns the number of pending tasks for a user.
func PendingTaskCount(ctx context.Context, userID string) (int64, error) {
	return RDB.LLen(ctx, pendingTaskKey(userID)).Result()
}
