package repository_test

import (
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/testkit"
	"github.com/stretchr/testify/require"
)

func boundSession(issuer, subject, device string, issuedAt int64) repository.BoundAccountSessionInput {
	return repository.BoundAccountSessionInput{AccountSessionInput: repository.AccountSessionInput{Issuer: issuer, Subject: subject, Name: "Test User", DeviceType: "web", DeviceID: device}, ProofIssuedAt: issuedAt, Browser: &model.BrowserSession{TokenHash: device + "hash", CSRFToken: "csrf", CreatedAt: time.Now(), ExpiresAt: time.Now().Add(time.Hour)}}
}

func TestBrowserEpochFencesUnknownSubjectAndKeepsIssuerIsolation(t *testing.T) {
	db := testkit.NewAuthDB(t)
	now := time.Now()
	identity, epoch, err := repository.ApplyAccountLogout(db, "https://account.example", "sub", "logout-1", "hash-1", now.Unix(), now.Add(time.Hour))
	require.NoError(t, err)
	require.Empty(t, identity)
	require.Equal(t, int64(1), epoch)
	_, err = repository.CreateBoundAccountSession(db, boundSession("https://account.example", "sub", "device-1", now.Unix()))
	require.ErrorIs(t, err, repository.ErrSessionRevoked)
	var users int64
	require.NoError(t, db.Model(&model.User{}).Count(&users).Error)
	require.Zero(t, users, "stale proof must roll back the candidate user and identity")
	good, err := repository.CreateBoundAccountSession(db, boundSession("https://account.example", "sub", "device-1", now.Unix()+1))
	require.NoError(t, err)
	require.Equal(t, int64(1), good.Generation)
	other, err := repository.CreateBoundAccountSession(db, boundSession("https://other.example", "sub", "device-2", now.Unix()))
	require.NoError(t, err)
	require.NotEqual(t, good.User.ID, other.User.ID)
	_, _, err = repository.ApplyAccountLogout(db, "https://account.example", "sub", "logout-2", "hash-2", now.Unix()+1, now.Add(time.Hour))
	require.NoError(t, err)
	valid, err := repository.CheckIdentityGeneration(db, good.IdentityID, good.User.ID, good.Generation)
	require.NoError(t, err)
	require.False(t, valid)
	valid, err = repository.CheckIdentityGeneration(db, other.IdentityID, other.User.ID, other.Generation)
	require.NoError(t, err)
	require.True(t, valid)
}

func TestLogoutPersistenceRollsBackAndExpiryCannotBeRestored(t *testing.T) {
	db := testkit.NewAuthDB(t)
	now := time.Now()
	in := boundSession("https://account.example", "sub", "device-1", now.Unix())
	created, err := repository.CreateBoundAccountSession(db, in)
	require.NoError(t, err)
	require.NoError(t, db.Exec(`CREATE TRIGGER reject_browser_revoke BEFORE UPDATE ON browser_sessions BEGIN SELECT RAISE(ABORT, 'injected transaction failure'); END`).Error)
	_, _, err = repository.ApplyAccountLogout(db, in.Issuer, in.Subject, "jti-1", "hash-1", now.Unix(), now.Add(time.Hour))
	require.Error(t, err)
	valid, err := repository.CheckIdentityGeneration(db, created.IdentityID, created.User.ID, 0)
	require.NoError(t, err)
	require.True(t, valid)
	var events int64
	require.NoError(t, db.Model(&model.OIDCLogoutEvent{}).Count(&events).Error)
	require.Zero(t, events)
	require.NoError(t, db.Exec(`DROP TRIGGER reject_browser_revoke`).Error)
	_, _, err = repository.ApplyAccountLogout(db, in.Issuer, in.Subject, "jti-1", "hash-1", now.Unix(), now.Add(time.Hour))
	require.NoError(t, err)
	_, err = repository.FindBrowserSession(db, in.Browser.TokenHash, now)
	require.Error(t, err)
	_, err = repository.FindBrowserSession(db, in.Browser.TokenHash, now.Add(2*time.Hour))
	require.Error(t, err)
}
