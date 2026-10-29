//go:build integration

package integration

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/auth"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestBrowserSessionsRealPGRevocationFencesRefreshAndLogin(t *testing.T) {
	database, cleanup := openTempMigratedDB(t)
	t.Cleanup(cleanup)
	cfg := config.JWTConfig{Secret: "test-browser-session-signing-secret", AccessTTL: time.Hour, RefreshTTL: time.Hour}
	checker := auth.NewService(database, cfg, cache.NoOpCache{})
	for iteration := 0; iteration < 8; iteration++ {
		t.Run(fmt.Sprintf("race-%d", iteration), func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			db := database.WithContext(ctx)
			now := time.Now().UTC()
			issuer, subject := "https://account.example", uuid.NewString()
			rawRefresh := "test-refresh-" + uuid.NewString()
			nativeInput := repository.BoundAccountSessionInput{AccountSessionInput: repository.AccountSessionInput{Issuer: issuer, Subject: subject, Name: "Test", DeviceType: "desktop", DeviceID: uuid.NewString(), RefreshTokenHash: jwtutil.HashRefreshToken(rawRefresh), RefreshExpiresAt: now.Add(time.Hour)}, ProofIssuedAt: now.Add(-time.Second).Unix()}
			native, err := repository.CreateBoundAccountSession(db, nativeInput)
			require.NoError(t, err)
			cookie := "test-cookie-" + uuid.NewString()
			browserInput := repository.BoundAccountSessionInput{AccountSessionInput: repository.AccountSessionInput{Issuer: issuer, Subject: subject, Name: "Test", DeviceType: "web", DeviceID: uuid.NewString()}, ProofIssuedAt: now.Add(-time.Second).Unix(), Browser: &model.BrowserSession{TokenHash: jwtutil.HashRefreshToken(cookie), CSRFToken: "test-csrf", CreatedAt: now, ExpiresAt: now.Add(time.Hour)}}
			_, err = repository.CreateBoundAccountSession(db, browserInput)
			require.NoError(t, err)
			start := make(chan struct{})
			type refreshResult struct {
				Response *auth.LoginResponse
				Err      error
			}
			refreshed := make(chan refreshResult, 1)
			loggedOut := make(chan error, 1)
			loggedIn := make(chan error, 1)
			go func() {
				<-start
				response, err := checker.RefreshToken(ctx, rawRefresh)
				refreshed <- refreshResult{response, err}
			}()
			go func() {
				<-start
				_, _, err := repository.ApplyAccountLogout(db, issuer, subject, "event-"+subject, "claims-"+subject, now.Unix(), now.Add(time.Hour))
				loggedOut <- err
			}()
			go func() { <-start; _, err := repository.CreateBoundAccountSession(db, nativeInput); loggedIn <- err }()
			close(start)
			require.NoError(t, <-loggedOut)
			loginErr := <-loggedIn
			require.True(t, loginErr == nil || errors.Is(loginErr, repository.ErrSessionRevoked), "login race: %v", loginErr)
			refresh := <-refreshed
			require.True(t, refresh.Err == nil || errors.Is(refresh.Err, errcode.AuthRefreshInvalid), "refresh race: %v", refresh.Err)
			if refresh.Response != nil {
				claims, err := jwtutil.ParseToken(refresh.Response.AccessToken, cfg.Secret)
				require.NoError(t, err)
				require.ErrorIs(t, checker.CheckAccessSession(ctx, claims), errcode.AuthInvalidToken)
			}
			valid, err := repository.CheckIdentityGeneration(db, native.IdentityID, native.User.ID, 0)
			require.NoError(t, err)
			require.False(t, valid)
			_, err = checker.BrowserSession(ctx, cookie)
			require.ErrorIs(t, err, errcode.AuthInvalidToken)
			_, generation, err := repository.ApplyAccountLogout(db, issuer, subject, "event-"+subject, "claims-"+subject, now.Unix(), now.Add(time.Hour))
			require.NoError(t, err)
			require.Equal(t, int64(1), generation)
		})
	}
}

func TestBrowserSessionMigrationPreservesEpochAcrossDownUp(t *testing.T) {
	m, database := openTempMigrateDB(t)
	_, _, err := repository.ApplyAccountLogout(database, "https://account.example", "unknown-sub", "event", "claims", time.Now().Unix(), time.Now().Add(time.Hour))
	require.NoError(t, err)
	require.NoError(t, m.Steps(-1))
	var epoch model.OIDCSubjectEpoch
	require.NoError(t, database.First(&epoch).Error)
	require.Equal(t, int64(1), epoch.Generation)
	require.NoError(t, m.Steps(1))
	_, generation, err := repository.ApplyAccountLogout(database, "https://account.example", "unknown-sub", "event", "claims", time.Now().Unix(), time.Now().Add(time.Hour))
	require.NoError(t, err)
	require.Equal(t, int64(1), generation)
}
