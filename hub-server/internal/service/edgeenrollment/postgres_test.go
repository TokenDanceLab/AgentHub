//go:build integration

package edgeenrollment

import (
	"context"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/device"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

// Use the same config/environment and production migration runner as the Hub
// integration lane, but create a unique database so no shared data is mutated.
func postgresService(t *testing.T) (*Service, Authorizer) {
	t.Helper()
	require.NotEmpty(t, os.Getenv("AGENTHUB_DB_PASSWORD"), "PostgreSQL integration requires an explicit fixture password")
	cfg, err := config.Load("../../../configs/config.yaml")
	require.NoError(t, err)
	adminCfg := cfg.DB
	adminCfg.Name = "postgres"
	admin, err := gorm.Open(postgres.Open(adminCfg.DSN()), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	adminSQL, err := admin.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, adminSQL.Close()) })
	name := "edge_enrollment_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	require.NoError(t, admin.Exec("CREATE DATABASE "+name).Error)
	t.Cleanup(func() { require.NoError(t, admin.Exec("DROP DATABASE "+name).Error) })
	cfg.DB.Name = name
	db, err := gorm.Open(postgres.Open(cfg.DB.DSN()), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(16)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	require.NoError(t, repository.RunMigrations(&cfg.DB))
	return New(db, "hub-test-client"), seedIdentity(t, db)
}

func TestPostgresConcurrentConfirmationAndExchangeHaveOneWinner(t *testing.T) {
	s, auth := postgresService(t)
	ctx := context.Background()
	start, err := s.Start(ctx, startInput())
	require.NoError(t, err)
	const workers = 12
	var wins atomic.Int32
	var wg sync.WaitGroup
	ready := make(chan struct{})
	errors := make(chan error, workers)
	for range workers {
		wg.Go(func() {
			<-ready
			_, err := s.Confirm(ctx, auth, start.UserCode)
			if err == nil {
				wins.Add(1)
			} else {
				errors <- err
			}
		})
	}
	close(ready)
	wg.Wait()
	close(errors)
	require.EqualValues(t, 1, wins.Load())
	for err := range errors {
		require.ErrorIs(t, err, ErrConflict)
	}
	wins.Store(0)
	ready = make(chan struct{})
	results := make(chan *ExchangeResult, workers)
	errors = make(chan error, workers)
	for range workers {
		wg.Go(func() {
			<-ready
			result, err := s.Exchange(ctx, start.EnrollmentID, start.PollSecret)
			if err == nil {
				wins.Add(1)
				results <- result
			} else {
				errors <- err
			}
		})
	}
	close(ready)
	wg.Wait()
	close(results)
	close(errors)
	require.EqualValues(t, 1, wins.Load())
	for err := range errors {
		require.ErrorIs(t, err, ErrInvalid)
	}
	result := <-results
	p, err := s.Authenticate(ctx, result.Credential)
	require.NoError(t, err)
	require.NoError(t, s.Heartbeat(ctx, p))
	var count int64
	require.NoError(t, s.db.Model(&model.EdgeDeviceCredential{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
}

func TestPostgresUnknownDeviceConcurrentOwnersCannotReassign(t *testing.T) {
	s, first := postgresService(t)
	second := seedIdentity(t, s.db)
	ctx := context.Background()
	in := startInput()
	one, err := s.Start(ctx, in)
	require.NoError(t, err)
	two, err := s.Start(ctx, in)
	require.NoError(t, err)
	_, err = s.Confirm(ctx, first, one.UserCode)
	require.NoError(t, err)
	_, err = s.Confirm(ctx, second, two.UserCode)
	require.NoError(t, err)
	var wg sync.WaitGroup
	ready := make(chan struct{})
	results := make(chan *ExchangeResult, 2)
	errors := make(chan error, 2)
	for _, enrollment := range []*StartResult{one, two} {
		wg.Go(func() {
			<-ready
			result, err := s.Exchange(ctx, enrollment.EnrollmentID, enrollment.PollSecret)
			if err != nil {
				errors <- err
			} else {
				results <- result
			}
		})
	}
	close(ready)
	wg.Wait()
	close(results)
	close(errors)
	require.Len(t, results, 1)
	require.Len(t, errors, 1)
	require.ErrorIs(t, <-errors, ErrConflict)
	winner := <-results
	p, err := s.Authenticate(ctx, winner.Credential)
	require.NoError(t, err)
	var device model.Device
	require.NoError(t, s.db.Where("id = ?", in.DeviceID).Take(&device).Error)
	require.Equal(t, p.UserID, device.UserID)
}

func TestPostgresExchangeWaitsForEpochAndRejectsCommittedLogout(t *testing.T) {
	s, auth := postgresService(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	start, err := s.Start(ctx, startInput())
	require.NoError(t, err)
	_, err = s.Confirm(ctx, auth, start.UserCode)
	require.NoError(t, err)
	var identity model.UserIdentity
	require.NoError(t, s.db.Where("id = ?", auth.IdentityID).Take(&identity).Error)
	tx := s.db.Begin()
	require.NoError(t, tx.Error)
	defer tx.Rollback()
	var epoch model.OIDCSubjectEpoch
	require.NoError(t, tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("issuer = ? AND subject = ?", identity.Issuer, identity.Subject).Take(&epoch).Error)
	finished := make(chan error, 1)
	go func() {
		_, err := s.Exchange(ctx, start.EnrollmentID, start.PollSecret)
		finished <- err
	}()
	// Observe a genuine PostgreSQL lock waiter, rather than assuming a
	// goroutine has reached SQL after an arbitrary scheduling delay.
	require.Eventually(t, func() bool {
		var waiting int64
		return s.db.Raw("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%oidc_subject_epochs%'").Scan(&waiting).Error == nil && waiting > 0
	}, 5*time.Second, 10*time.Millisecond)
	require.NoError(t, tx.Model(&epoch).Update("generation", 1).Error)
	require.NoError(t, tx.Commit().Error)
	require.ErrorIs(t, <-finished, errcode.AuthInvalidToken)
	var count int64
	require.NoError(t, s.db.Model(&model.EdgeDeviceCredential{}).Count(&count).Error)
	require.Zero(t, count)
	var row model.EdgeEnrollment
	require.NoError(t, s.db.Where("id = ?", start.EnrollmentID).Take(&row).Error)
	require.Nil(t, row.ExchangedAt)
}

func TestPostgresLogoutInvalidatesIssuedCredentialAndMigrationRoundTrip(t *testing.T) {
	s, auth := postgresService(t)
	ctx := context.Background()
	in := startInput()
	_, exchange := pair(t, s, auth, in)
	p, err := s.Authenticate(ctx, exchange.Credential)
	require.NoError(t, err)
	var identity model.UserIdentity
	require.NoError(t, s.db.Where("id = ?", auth.IdentityID).Take(&identity).Error)
	_, generation, err := repository.ApplyAccountLogout(s.db, identity.Issuer, identity.Subject, uuid.NewString(), "logout-claims", time.Now().Unix(), time.Now().Add(time.Hour))
	require.NoError(t, err)
	require.EqualValues(t, 1, generation)
	require.ErrorIs(t, s.ValidatePrincipal(ctx, p), errcode.AuthInvalidToken)
	_, err = s.Authenticate(ctx, exchange.Credential)
	require.ErrorIs(t, err, errcode.AuthInvalidToken)
	down, err := os.ReadFile("../../../migrations/0080_edge_enrollment.down.sql")
	require.NoError(t, err)
	require.NoError(t, s.db.Exec(string(down)).Error)
	var credential model.EdgeDeviceCredential
	require.NoError(t, s.db.Where("device_id = ?", in.DeviceID).Take(&credential).Error)
	require.NotNil(t, credential.RevokedAt)
	up, err := os.ReadFile("../../../migrations/0080_edge_enrollment.up.sql")
	require.NoError(t, err)
	require.NoError(t, s.db.Exec(string(up)).Error)
	require.NoError(t, s.db.Where("device_id = ?", in.DeviceID).Take(&credential).Error)
	require.NotNil(t, credential.RevokedAt)
	var constraints int64
	require.NoError(t, s.db.Raw("SELECT count(*) FROM pg_constraint WHERE conrelid = 'edge_device_credentials'::regclass AND contype = 'f'").Scan(&constraints).Error)
	require.EqualValues(t, 4, constraints)
}

// Pause a real transaction immediately before its protected write, after its
// production locks have been acquired. Context cancellation releases a failed
// test without leaving either the connection or the goroutine blocked.
func pauseUpdate(t *testing.T, db *gorm.DB, table string) (<-chan struct{}, func()) {
	t.Helper()
	entered := make(chan struct{})
	resume := make(chan struct{})
	var pauseOnce, resumeOnce sync.Once
	name := "edge_enrollment_test_pause_" + table
	require.NoError(t, db.Callback().Update().Before("gorm:update").Register(name, func(tx *gorm.DB) {
		if tx.Statement.Table != table {
			return
		}
		pauseOnce.Do(func() {
			close(entered)
			select {
			case <-resume:
			case <-tx.Statement.Context.Done():
				tx.AddError(tx.Statement.Context.Err())
			}
		})
	}))
	unpause := func() { resumeOnce.Do(func() { close(resume) }) }
	t.Cleanup(func() {
		unpause()
		require.NoError(t, db.Callback().Update().Remove(name))
	})
	return entered, unpause
}

func waitForIdentityLock(t *testing.T, db *gorm.DB) {
	t.Helper()
	require.Eventually(t, func() bool {
		var waiting int64
		return db.Raw("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%user_identities%'").Scan(&waiting).Error == nil && waiting > 0
	}, 5*time.Second, 10*time.Millisecond)
}

func TestPostgresAccountLogoutAndIssuanceAreLinearized(t *testing.T) {
	for _, first := range []string{"logout", "issuance"} {
		t.Run(first+"_locks_first", func(t *testing.T) {
			s, auth := postgresService(t)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			start, err := s.Start(ctx, startInput())
			require.NoError(t, err)
			_, err = s.Confirm(ctx, auth, start.UserCode)
			require.NoError(t, err)
			var identity model.UserIdentity
			require.NoError(t, s.db.Where("id = ?", auth.IdentityID).Take(&identity).Error)
			table := "oidc_subject_epochs"
			if first == "issuance" {
				table = "edge_device_credentials"
			}
			entered, resume := pauseUpdate(t, s.db, table)
			defer resume()
			type exchangeOutcome struct {
				result *ExchangeResult
				err    error
			}
			exchanged := make(chan exchangeOutcome, 1)
			loggedOut := make(chan error, 1)
			exchange := func() {
				result, err := s.Exchange(ctx, start.EnrollmentID, start.PollSecret)
				exchanged <- exchangeOutcome{result, err}
			}
			logout := func() {
				_, _, err := repository.ApplyAccountLogout(s.db.WithContext(ctx), identity.Issuer, identity.Subject,
					uuid.NewString(), "test-logout-claims", time.Now().Unix(), time.Now().Add(time.Hour))
				loggedOut <- err
			}
			if first == "logout" {
				go logout()
			} else {
				go exchange()
			}
			select {
			case <-entered:
			case <-ctx.Done():
				t.Fatal("first transaction did not reach protected write")
			}
			if first == "logout" {
				go exchange()
			} else {
				go logout()
			}
			waitForIdentityLock(t, s.db)
			resume()
			require.NoError(t, <-loggedOut)
			outcome := <-exchanged
			if first == "logout" {
				require.ErrorIs(t, outcome.err, errcode.AuthInvalidToken)
				var count int64
				require.NoError(t, s.db.Model(&model.EdgeDeviceCredential{}).Count(&count).Error)
				require.Zero(t, count)
			} else {
				require.NoError(t, outcome.err)
				_, err = s.Authenticate(ctx, outcome.result.Credential)
				require.ErrorIs(t, err, errcode.AuthInvalidToken)
			}
		})
	}
}

func TestPostgresProtectedWriteWaitsForRevocationAndRejectsPrincipal(t *testing.T) {
	s, auth := postgresService(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	in := startInput()
	_, exchange := pair(t, s, auth, in)
	p, err := s.Authenticate(ctx, exchange.Credential)
	require.NoError(t, err)
	entered, resume := pauseUpdate(t, s.db, "edge_device_credentials")
	defer resume()
	revoked := make(chan error, 1)
	go func() { revoked <- s.Revoke(ctx, auth.UserID, in.DeviceID) }()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal("revocation did not acquire device lock")
	}
	validated := make(chan error, 1)
	go func() {
		validated <- s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			return s.ValidatePrincipalTx(tx, p)
		})
	}()
	require.Eventually(t, func() bool {
		var waiting int64
		return s.db.Raw("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%devices%'").Scan(&waiting).Error == nil && waiting > 0
	}, 5*time.Second, 10*time.Millisecond)
	resume()
	require.NoError(t, <-revoked)
	require.ErrorIs(t, <-validated, errcode.AuthInvalidToken)
}

func TestPostgresDistinctIdentityEnrollmentsCannotExceedOwnerQuota(t *testing.T) {
	t.Setenv("AGENTHUB_MAX_CLOUD_EDGE_DEVICES", "2")
	s, auth := postgresService(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	const workers = 8
	enrollments := make([]*StartResult, workers)
	for i := range workers {
		identity := seedIdentityForUser(t, s.db, auth.UserID)
		start, err := s.Start(ctx, startInput())
		require.NoError(t, err)
		_, err = s.Confirm(ctx, identity, start.UserCode)
		require.NoError(t, err)
		enrollments[i] = start
	}
	var wins atomic.Int32
	var wg sync.WaitGroup
	ready := make(chan struct{})
	errors := make(chan error, workers)
	for _, start := range enrollments {
		wg.Go(func() {
			<-ready
			_, err := s.Exchange(ctx, start.EnrollmentID, start.PollSecret)
			if err == nil {
				wins.Add(1)
			} else {
				errors <- err
			}
		})
	}
	close(ready)
	wg.Wait()
	close(errors)
	require.EqualValues(t, 2, wins.Load())
	for err := range errors {
		require.ErrorIs(t, err, errcode.DeviceLimitExceeded)
	}
	count, err := repository.CountDevicesByUserAndType(s.db, auth.UserID, "cloud_edge")
	require.NoError(t, err)
	require.EqualValues(t, 2, count)
}

func TestPostgresBoundedEnrollmentPruningKeepsRevokedCredentialMarkers(t *testing.T) {
	s, auth := postgresService(t)
	assertBoundedEnrollmentPruning(t, s, auth)
}

func TestPostgresLegacyAndPairedRegistrationsShareOwnerQuota(t *testing.T) {
	t.Setenv("AGENTHUB_MAX_CLOUD_EDGE_DEVICES", "2")
	s, auth := postgresService(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	legacy := device.NewService(s.db, nil)
	const workers = 8
	ready := make(chan struct{})
	errors := make(chan error, workers)
	var wg sync.WaitGroup
	for i := range workers {
		start, err := s.Start(ctx, startInput())
		require.NoError(t, err)
		_, err = s.Confirm(ctx, auth, start.UserCode)
		require.NoError(t, err)
		wg.Go(func() {
			<-ready
			var err error
			if i%2 == 0 {
				_, err = s.Exchange(ctx, start.EnrollmentID, start.PollSecret)
			} else {
				_, err = legacy.Register(ctx, uuid.NewString(), auth.UserID, "cloud_edge", "fixture", nil)
			}
			errors <- err
		})
	}
	close(ready)
	wg.Wait()
	close(errors)
	wins := 0
	for err := range errors {
		if err == nil {
			wins++
		} else {
			require.ErrorIs(t, err, errcode.DeviceLimitExceeded)
		}
	}
	require.Equal(t, 2, wins)
	count, err := repository.CountDevicesByUserAndType(s.db, auth.UserID, "cloud_edge")
	require.NoError(t, err)
	require.EqualValues(t, 2, count)
}
