package cache

import (
	"context"
	"strconv"
)

// AllocateSeq atomically increments and returns the next seq for a session.
func AllocateSeq(ctx context.Context, sessionID string) (int64, error) {
	return RDB.Incr(ctx, "session:seq:"+sessionID).Result()
}

// InitSeqIfAbsent initializes the seq key if it doesn't exist (SetNX, no TTL).
func InitSeqIfAbsent(ctx context.Context, sessionID string, seq int64) error {
	return RDB.SetNX(ctx, "session:seq:"+sessionID, seq, 0).Err()
}

// PeekSeq returns the current seq value for a session (diagnostics only).
func PeekSeq(ctx context.Context, sessionID string) (int64, error) {
	s, err := RDB.Get(ctx, "session:seq:"+sessionID).Result()
	if err != nil {
		return 0, err
	}
	return strconv.ParseInt(s, 10, 64)
}
