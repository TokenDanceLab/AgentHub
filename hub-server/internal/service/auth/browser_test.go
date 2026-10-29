package auth

import (
	"context"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/testkit"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestBrowserCutoverRejectsWebRefreshButUpgradesNativeBearer(t *testing.T) {
	db := testkit.NewAuthDB(t)
	cfg := config.JWTConfig{Secret: "fixture-session-signing-secret-long", AccessTTL: time.Hour, RefreshTTL: time.Hour}
	svc := NewService(db, cfg, cache.NoOpCache{})
	svc.SetBrowserSessionsEnabled(true)
	for _, deviceType := range []string{"web", "desktop"} {
		raw := "fixture-refresh-" + deviceType
		bound, err := repository.CreateBoundAccountSession(db, repository.BoundAccountSessionInput{AccountSessionInput: repository.AccountSessionInput{Issuer: "https://account.example", Subject: "sub", Name: "Test", DeviceType: deviceType, DeviceID: "fixture-device-" + deviceType, RefreshTokenHash: jwtutil.HashRefreshToken(raw), RefreshExpiresAt: time.Now().UTC().Add(time.Hour)}, ProofIssuedAt: time.Now().Unix()})
		require.NoError(t, err)
		old, err := jwtutil.GenerateAccessToken(bound.User.ID, deviceType, "fixture-device-"+deviceType, cfg.Secret, time.Hour)
		require.NoError(t, err)
		oldClaims, err := jwtutil.ParseToken(old, cfg.Secret)
		require.NoError(t, err)
		require.ErrorIs(t, svc.CheckAccessSession(context.Background(), oldClaims), errcode.AuthInvalidToken)
		response, err := svc.RefreshToken(context.Background(), raw)
		if deviceType == "web" {
			require.ErrorIs(t, err, errcode.AuthRefreshInvalid)
			continue
		}
		require.NoError(t, err)
		claims, err := jwtutil.ParseToken(response.AccessToken, cfg.Secret)
		require.NoError(t, err)
		require.Equal(t, bound.IdentityID, claims.IdentityID)
		require.NoError(t, svc.CheckAccessSession(context.Background(), claims))
	}
}

func TestAccountClientReplacementRequiresFreshBrowserAndNativeLogin(t *testing.T) {
	db := testkit.NewAuthDB(t)
	cfg := config.JWTConfig{Secret: "fixture-session-signing-secret-long", AccessTTL: time.Hour, RefreshTTL: time.Hour}
	svc := NewService(db, cfg, cache.NoOpCache{})
	svc.SetAccountClientID("replacement-client")
	ctx := context.Background()
	var userID, identityID string
	for _, clientID := range []string{"", "previous-client", "replacement-client"} {
		t.Run("client-"+clientID, func(t *testing.T) {
			now := time.Now().UTC()
			rawRefresh := "fixture-refresh-" + uuid.NewString()
			input := repository.BoundAccountSessionInput{AccountSessionInput: repository.AccountSessionInput{
				Issuer: "https://account.example", Subject: "same-account", Name: "Test", OIDCClientID: clientID,
				DeviceType: "desktop", DeviceID: uuid.NewString(), RefreshTokenHash: jwtutil.HashRefreshToken(rawRefresh), RefreshExpiresAt: now.Add(time.Hour),
			}, ProofIssuedAt: now.Unix()}
			bound, err := repository.CreateBoundAccountSession(db, input)
			require.NoError(t, err)
			if userID == "" {
				userID, identityID = bound.User.ID, bound.IdentityID
			}
			require.Equal(t, userID, bound.User.ID)
			require.Equal(t, identityID, bound.IdentityID)
			rawAccess, err := jwtutil.GenerateIdentityAccessToken(userID, "desktop", input.DeviceID, identityID, bound.Generation, cfg.Secret, cfg.AccessTTL, clientID)
			require.NoError(t, err)
			claims, err := jwtutil.ParseToken(rawAccess, cfg.Secret)
			require.NoError(t, err)
			cookie := "fixture-cookie-" + uuid.NewString()
			input.DeviceType, input.DeviceID = "web", uuid.NewString()
			input.Browser = &model.BrowserSession{TokenHash: jwtutil.HashRefreshToken(cookie), CSRFToken: "fixture-csrf", CreatedAt: now, ExpiresAt: now.Add(time.Hour)}
			_, err = repository.CreateBoundAccountSession(db, input)
			require.NoError(t, err)
			_, browserErr := svc.BrowserSession(ctx, cookie)
			accessErr := svc.CheckAccessSession(ctx, claims)
			response, refreshErr := svc.RefreshToken(ctx, rawRefresh)
			if clientID != "replacement-client" {
				require.ErrorIs(t, browserErr, errcode.AuthInvalidToken)
				require.ErrorIs(t, accessErr, errcode.AuthInvalidToken)
				require.ErrorIs(t, refreshErr, errcode.AuthRefreshInvalid)
				return
			}
			require.NoError(t, browserErr)
			require.NoError(t, accessErr)
			require.NoError(t, refreshErr)
			rotatedClaims, err := jwtutil.ParseToken(response.AccessToken, cfg.Secret)
			require.NoError(t, err)
			require.Equal(t, clientID, rotatedClaims.OIDCClientID)
			require.NoError(t, svc.CheckAccessSession(ctx, rotatedClaims))
			rotatedRefresh, err := repository.FindRefreshTokenForRotation(db, jwtutil.HashRefreshToken(response.RefreshToken))
			require.NoError(t, err)
			require.Equal(t, clientID, rotatedRefresh.OIDCClientID)
		})
	}
}
