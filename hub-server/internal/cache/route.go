package cache

import (
	"context"
)

// Deprecated: use Client.SetRoute instead. Will be removed in Phase 5.
func SetRoute(ctx context.Context, userID, deviceType, connID string) error {
	return defaultClient.SetRoute(ctx, userID, deviceType, connID)
}

// Deprecated: use Client.DeleteRoute instead. Will be removed in Phase 5.
func DeleteRoute(ctx context.Context, userID, deviceType string) error {
	return defaultClient.DeleteRoute(ctx, userID, deviceType)
}

// Deprecated: use Client.GetRoute instead. Will be removed in Phase 5.
func GetRoute(ctx context.Context, userID, deviceType string) (string, error) {
	return defaultClient.GetRoute(ctx, userID, deviceType)
}

// Deprecated: use Client.IsOnline instead. Will be removed in Phase 5.
func IsOnline(ctx context.Context, userID string) (bool, error) {
	return defaultClient.IsOnline(ctx, userID)
}

// Deprecated: use Client.GetAllRoutes instead. Will be removed in Phase 5.
func GetAllRoutes(ctx context.Context, userID string) (map[string]string, error) {
	return defaultClient.GetAllRoutes(ctx, userID)
}

// Deprecated: use Client.MarkKicked instead. Will be removed in Phase 5.
func MarkKicked(ctx context.Context, connID string) error {
	return defaultClient.MarkKicked(ctx, connID)
}

// Deprecated: use Client.IsKicked instead. Will be removed in Phase 5.
func IsKicked(ctx context.Context, connID string) (bool, error) {
	return defaultClient.IsKicked(ctx, connID)
}

// Deprecated: use Client.PushPendingTask instead. Will be removed in Phase 5.
func PushPendingTask(ctx context.Context, userID, taskJSON string) error {
	return defaultClient.PushPendingTask(ctx, userID, taskJSON)
}

// Deprecated: use Client.PopPendingTasks instead. Will be removed in Phase 5.
func PopPendingTasks(ctx context.Context, userID string) ([]string, error) {
	return defaultClient.PopPendingTasks(ctx, userID)
}

// Deprecated: use Client.PendingTaskCount instead. Will be removed in Phase 5.
func PendingTaskCount(ctx context.Context, userID string) (int64, error) {
	return defaultClient.PendingTaskCount(ctx, userID)
}
