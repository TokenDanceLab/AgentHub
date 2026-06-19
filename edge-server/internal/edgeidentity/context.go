// Package edgeidentity provides shared context key types for passing Hub-authenticated
// request identity through the middleware chain into API handlers.
package edgeidentity

import "context"

// CtxKey is the context key type for Edge request identity values.
type CtxKey string

const (
	// HubUserIDKey is the context key for the Hub-authenticated user ID.
	HubUserIDKey CtxKey = "hub_user_id"
	// HubDeviceIDKey is the context key for the Hub-authenticated device ID.
	HubDeviceIDKey CtxKey = "hub_device_id"
)

// Identity holds the Hub-authenticated caller identity extracted from a request context.
type Identity struct {
	UserID   string
	DeviceID string
}

// FromContext extracts Hub identity from a request context.
// Returns zero-value Identity if the context does not carry Hub auth info.
func FromContext(ctx context.Context) Identity {
	var id Identity
	if v, ok := ctx.Value(HubUserIDKey).(string); ok {
		id.UserID = v
	}
	if v, ok := ctx.Value(HubDeviceIDKey).(string); ok {
		id.DeviceID = v
	}
	return id
}
