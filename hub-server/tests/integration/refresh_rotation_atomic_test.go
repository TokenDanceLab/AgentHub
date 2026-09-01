//go:build integration

package integration

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/auth"
)

// TestRefreshRotationConcurrentSingleWinner proves that N concurrent
// presentations of the SAME refresh token rotate exactly once (#2154:
// database-lane P2-2 / security-lane finding 1 — both reports' recommended
// item). Pre-fix, every racer passes the revoked check before any rotation
// commits, each obtains a fresh access+refresh pair (double-spend), and the
// F2 refresh_token_reuse_total signal never fires because the upsert
// replaces the row in place.
func TestRefreshRotationConcurrentSingleWinner(t *testing.T) {
	CleanDB(t, db)

	u := register(t, "trefresh_race", "pass1234", "RefreshRace")
	deviceID := testDeviceID(u.Username, "desktop")
	raw := seedRefreshToken(t, u.ID, "desktop", deviceID)

	svc := auth.NewService(db, testJWT, testCacheClient)

	const racers = 8
	results := make([]error, racers)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			_, results[i] = svc.RefreshToken(context.Background(), raw)
		}(i)
	}
	close(start)
	wg.Wait()

	successes := 0
	for i, err := range results {
		if err == nil {
			successes++
			continue
		}
		if !errors.Is(err, errcode.AuthRefreshInvalid) {
			t.Errorf("racer %d error = %v, want AuthRefreshInvalid", i, err)
		}
	}
	if successes != 1 {
		t.Fatalf("concurrent refresh successes = %d, want exactly 1 (double-spend: %d extra racers obtained fresh token pairs)", successes, successes-1)
	}

	// The seed hash must no longer resolve to a live row.
	if rt, err := repository.FindRefreshTokenByHash(db, jwtutil.HashRefreshToken(raw)); err == nil && !rt.Revoked {
		t.Fatalf("seed token row still live after rotation (revoked=%v)", rt.Revoked)
	}

	// Exactly one live row for the device, holding the winner's new hash.
	var liveCount int64
	if err := db.Model(&model.RefreshToken{}).
		Where("user_id = ? AND revoked = ?", u.ID, false).
		Count(&liveCount).Error; err != nil {
		t.Fatalf("count live rows: %v", err)
	}
	if liveCount != 1 {
		t.Fatalf("live refresh rows after rotation = %d, want 1", liveCount)
	}
}
