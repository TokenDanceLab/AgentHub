//go:build integration

package integration

import (
	"context"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service"
	"github.com/agenthub/hub-server/internal/service/deliveryoutbox"
)

// ==================== #2071 S3 — outbox ClaimRetry CAS under real PG ====================
//
// These tests verify that Store.ClaimRetry's SQL CAS (WHERE attempt_count =
// expectedAttempt) is atomic under true PostgreSQL concurrency. The unit tests
// in outbox_test.go use a fakeStore with an in-process mutex; this file proves
// the same invariant holds when multiple goroutines hit a real PG backend
// simultaneously, which is the production deployment model (multi-replica hub).

// openTempMigratedDB creates an ephemeral PostgreSQL database, runs all
// migrations against it, and returns a *gorm.DB connected to that database
// plus a cleanup function that drops the database. The caller must invoke
// cleanup (typically via t.Cleanup). This avoids touching the shared
// integration "agenthub" database.
func openTempMigratedDB(t *testing.T) (*gorm.DB, func()) {
	t.Helper()

	password := os.Getenv("AGENTHUB_DB_PASSWORD")
	if password == "" {
		t.Fatal("AGENTHUB_DB_PASSWORD not set; required for the PostgreSQL integration path")
	}

	host := "localhost"
	port := 5432
	user := "agenthub"

	// Connect to the default "postgres" database to create/drop our temp DB.
	adminDSN := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=postgres sslmode=disable",
		host, port, user, password)
	adminDB, err := gorm.Open(postgres.Open(adminDSN), &gorm.Config{
		Logger: logger.Discard,
	})
	if err != nil {
		t.Fatalf("open admin connection: %v", err)
	}

	dbName := fmt.Sprintf("outbox_claim_test_%d", time.Now().UnixNano())
	if err := adminDB.Exec("CREATE DATABASE " + dbName).Error; err != nil {
		t.Fatalf("create temp database %s: %v", dbName, err)
	}

	// Connect to the new temp database and run migrations.
	tempCfg := &config.DBConfig{
		Host:            host,
		Port:            port,
		User:            user,
		Password:        password,
		Name:            dbName,
		SSLMode:         "disable",
		ApplicationName: "outbox_claim_test",
		MaxOpenConns:    4,
		MaxIdleConns:    2,
		ConnMaxLifetime: 5 * time.Minute,
		ConnMaxIdleTime: 1 * time.Minute,
	}

	tempDB, err := repository.InitDB(tempCfg)
	if err != nil {
		// Best-effort drop on init failure.
		_ = adminDB.Exec("DROP DATABASE IF EXISTS " + dbName).Error
		t.Fatalf("init temp db: %v", err)
	}

	if err := repository.RunMigrationsFrom(tempCfg, "file://../../migrations"); err != nil {
		sqlDB, _ := tempDB.DB()
		if sqlDB != nil {
			_ = sqlDB.Close()
		}
		_ = adminDB.Exec("DROP DATABASE IF EXISTS " + dbName).Error
		t.Fatalf("run migrations on temp db: %v", err)
	}

	cleanup := func() {
		sqlDB, _ := tempDB.DB()
		if sqlDB != nil {
			_ = sqlDB.Close()
		}
		// Re-open admin to drop (the original adminDB connection may be stale).
		a, aErr := gorm.Open(postgres.Open(adminDSN), &gorm.Config{Logger: logger.Discard})
		if aErr == nil {
			_ = a.Exec("DROP DATABASE IF EXISTS " + dbName).Error
			if s, e := a.DB(); e == nil {
				_ = s.Close()
			}
		}
	}

	return tempDB, cleanup
}

// seedRetryableDelivery inserts a delivery_outbox row in StatusSent with
// attempt_count=0, ready for a ClaimRetry at expectedAttempt=0.
func seedRetryableDelivery(t *testing.T, store deliveryoutbox.Store, deliveryID string) {
	t.Helper()
	now := time.Now()
	err := store.Insert(context.Background(), deliveryoutbox.Entry{
		ID:           deliveryID, // Insert uses beforeCreate for UUIDv7; override below
		TaskID:       "00000000-0000-4000-8000-000000000001",
		DeliveryID:   deliveryID,
		Payload:      `{"test":"cas"}`,
		Status:       deliveryoutbox.StatusSent,
		AttemptCount: 0,
		MaxAttempts:  3,
		CreatedAt:    now,
		UpdatedAt:    now,
	})
	if err != nil {
		t.Fatalf("seed delivery %s: %v", deliveryID, err)
	}
}

// ptr helpers (unexported in deliveryoutbox package, redefine locally).
func claimStrPtr(s string) *string { return &s }
func claimIntPtr(i int) *int       { return &i }

// TestOutboxClaimRetry_RealPG_ExactlyOneWinner verifies that N concurrent
// goroutines calling ClaimRetry on the same delivery row with the same
// expectedAttempt produce exactly one winner and N-1 losers, and that the
// final DB row state reflects a single increment of attempt_count.
//
// This is the real-PG counterpart of TestOutbox_ConcurrentMarkDeliveryRetryingOnlyOneClaim
// which uses a fakeStore mutex. Here we prove the SQL CAS holds under true
// PostgreSQL row-level locking.
func TestOutboxClaimRetry_RealPG_ExactlyOneWinner(t *testing.T) {
	tempDB, cleanup := openTempMigratedDB(t)
	t.Cleanup(cleanup)

	store := service.NewDeliveryOutboxStore(tempDB)
	ctx := context.Background()

	const deliveryID = "del-cas-real-pg"
	seedRetryableDelivery(t, store, deliveryID)

	const workers = 8
	var (
		wg      sync.WaitGroup
		barrier = make(chan struct{})
		wins    atomic.Int64
		losses  atomic.Int64
		errs    atomic.Int64
	)

	nextRetry := time.Now().Add(5 * time.Minute)
	patch := deliveryoutbox.Patch{
		Status:       claimStrPtr(deliveryoutbox.StatusRetrying),
		AttemptCount: claimIntPtr(1),
		LastError:    claimStrPtr("concurrent-claim"),
		NextRetryAt:  &nextRetry,
	}

	wg.Add(workers)
	for i := 0; i < workers; i++ {
		go func() {
			defer wg.Done()
			<-barrier // all goroutines start simultaneously
			rows, err := store.ClaimRetry(ctx, deliveryID, deliveryoutbox.ActiveStatuses(), 0, patch)
			if err != nil {
				errs.Add(1)
				return
			}
			if rows == 1 {
				wins.Add(1)
			} else {
				losses.Add(1)
			}
		}()
	}
	close(barrier)
	wg.Wait()

	// Hard assertions: no errors, exactly one winner.
	if e := errs.Load(); e != 0 {
		t.Fatalf("ClaimRetry produced %d errors under contention; want 0", e)
	}
	if w := wins.Load(); w != 1 {
		t.Fatalf("ClaimRetry winners = %d; want exactly 1", w)
	}
	if l := losses.Load(); l != int64(workers-1) {
		t.Fatalf("ClaimRetry losers = %d; want %d", l, workers-1)
	}

	// DB state assertion: the row must reflect exactly one claim.
	entry, err := store.FindByDeliveryID(ctx, deliveryID)
	if err != nil {
		t.Fatalf("FindByDeliveryID after claim: %v", err)
	}
	if entry.AttemptCount != 1 {
		t.Fatalf("attempt_count = %d; want 1 (single CAS increment)", entry.AttemptCount)
	}
	if entry.Status != deliveryoutbox.StatusRetrying {
		t.Fatalf("status = %q; want %q", entry.Status, deliveryoutbox.StatusRetrying)
	}
	if entry.LastError != "concurrent-claim" {
		t.Fatalf("last_error = %q; want %q", entry.LastError, "concurrent-claim")
	}
	if entry.NextRetryAt == nil {
		t.Fatal("next_retry_at is nil; want non-nil after claim")
	}

	t.Logf("PASS: %d workers, 1 winner, %d losers, DB attempt_count=%d status=%s",
		workers, losses.Load(), entry.AttemptCount, entry.Status)
}

// TestOutboxClaimRetry_RealPG_TerminalRowsRejectClaim verifies that rows in
// terminal states (delivered, dead) cannot be claimed by ClaimRetry even when
// the expectedAttempt matches. This is the negative case proving the status IN
// filter works correctly under real PG.
func TestOutboxClaimRetry_RealPG_TerminalRowsRejectClaim(t *testing.T) {
	tempDB, cleanup := openTempMigratedDB(t)
	t.Cleanup(cleanup)

	store := service.NewDeliveryOutboxStore(tempDB)
	ctx := context.Background()

	cases := []struct {
		name       string
		deliveryID string
		status     string
	}{
		{"delivered-row", "del-terminal-delivered", deliveryoutbox.StatusDelivered},
		{"dead-row", "del-terminal-dead", deliveryoutbox.StatusDead},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			now := time.Now()
			err := store.Insert(ctx, deliveryoutbox.Entry{
				ID:           tc.deliveryID,
				TaskID:       "00000000-0000-4000-8000-000000000002",
				DeliveryID:   tc.deliveryID,
				Payload:      `{"test":"terminal"}`,
				Status:       tc.status,
				AttemptCount: 0,
				MaxAttempts:  3,
				CreatedAt:    now,
				UpdatedAt:    now,
			})
			if err != nil {
				t.Fatalf("seed %s: %v", tc.name, err)
			}

			nextRetry := time.Now().Add(5 * time.Minute)
			rows, err := store.ClaimRetry(ctx, tc.deliveryID, deliveryoutbox.ActiveStatuses(), 0, deliveryoutbox.Patch{
				Status:       claimStrPtr(deliveryoutbox.StatusRetrying),
				AttemptCount: claimIntPtr(1),
				LastError:    claimStrPtr("should-not-apply"),
				NextRetryAt:  &nextRetry,
			})
			if err != nil {
				t.Fatalf("ClaimRetry on %s errored: %v", tc.name, err)
			}
			if rows != 0 {
				t.Fatalf("ClaimRetry on %s returned %d rows; want 0 (terminal status must reject)", tc.name, rows)
			}

			// Verify DB row is unchanged.
			entry, findErr := store.FindByDeliveryID(ctx, tc.deliveryID)
			if findErr != nil {
				t.Fatalf("FindByDeliveryID after rejected claim: %v", findErr)
			}
			if entry.Status != tc.status {
				t.Fatalf("status changed to %q; want %q (unchanged)", entry.Status, tc.status)
			}
			if entry.AttemptCount != 0 {
				t.Fatalf("attempt_count = %d; want 0 (unchanged)", entry.AttemptCount)
			}
		})
	}

	t.Log("PASS: terminal rows (delivered, dead) correctly reject ClaimRetry")
}
