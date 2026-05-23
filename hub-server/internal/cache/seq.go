package cache

import (
	"context"
)

// Deprecated: use Client.AllocateSeq instead. Will be removed in Phase 5.
func AllocateSeq(ctx context.Context, sessionID string) (int64, error) {
	return defaultClient.AllocateSeq(ctx, sessionID)
}

// Deprecated: use Client.InitSeqIfAbsent instead. Will be removed in Phase 5.
func InitSeqIfAbsent(ctx context.Context, sessionID string, seq int64) error {
	return defaultClient.InitSeqIfAbsent(ctx, sessionID, seq)
}

// Deprecated: use Client.PeekSeq instead. Will be removed in Phase 5.
func PeekSeq(ctx context.Context, sessionID string) (int64, error) {
	return defaultClient.PeekSeq(ctx, sessionID)
}
