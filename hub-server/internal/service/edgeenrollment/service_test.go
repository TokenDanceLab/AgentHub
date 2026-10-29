package edgeenrollment

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/dispatch"
	"github.com/agenthub/hub-server/internal/testkit"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func testService(t *testing.T) (*Service, Authorizer) {
	t.Helper()
	db := testkit.NewAuthDB(t)
	require.NoError(t, db.AutoMigrate(&model.EdgeEnrollment{}, &model.EdgeDeviceCredential{}))
	// SQLite needs DATETIME for scanned timestamps; the real-PG lane below
	// uses the unmodified production migrations and timestamptz columns.
	require.NoError(t, db.Exec(`CREATE TABLE execution_targets (
		id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, device_id TEXT, name TEXT NOT NULL,
		target_type TEXT, host TEXT, port INTEGER, workspace_root TEXT, workspace_allowlist TEXT,
		trust_level TEXT, health_state TEXT, auth_method TEXT, is_online BOOLEAN,
		last_seen_at DATETIME, capabilities TEXT, metadata TEXT, created_at DATETIME,
		updated_at DATETIME, deleted_at DATETIME)`).Error)
	require.NoError(t, db.Exec(`CREATE TABLE execution_target_evidence (
		id TEXT PRIMARY KEY, target_id TEXT NOT NULL UNIQUE, source TEXT, status TEXT,
		failure_category TEXT, observed_target_id TEXT, route_key TEXT, observed_at DATETIME,
		expires_at DATETIME, created_at DATETIME, updated_at DATETIME)`).Error)
	s := New(db, "hub-test-client")
	return s, seedIdentity(t, db)
}

func seedIdentity(t *testing.T, db *gorm.DB) Authorizer {
	t.Helper()
	user := model.User{Username: uuid.NewString(), Nickname: "Pairing test"}
	require.NoError(t, db.Create(&user).Error)
	id := model.UserIdentity{UserID: user.ID, Provider: model.IdentityProviderAccount, Issuer: "https://account.test", Subject: uuid.NewString(), Status: model.IdentityStatusActive, LinkedAt: time.Now()}
	require.NoError(t, db.Create(&id).Error)
	require.NoError(t, db.Create(&model.OIDCSubjectEpoch{Issuer: id.Issuer, Subject: id.Subject}).Error)
	return Authorizer{UserID: user.ID, IdentityID: id.ID, OIDCClientID: "hub-test-client"}
}

func startInput() StartInput {
	return StartInput{DeviceID: uuid.NewString(), Name: "Test Edge " + uuid.NewString(), RuntimeID: "openai-sdk", WorkspaceRoot: "/workspace/project"}
}

func pair(t *testing.T, s *Service, auth Authorizer, in StartInput) (*StartResult, *ExchangeResult) {
	t.Helper()
	start, err := s.Start(context.Background(), in)
	require.NoError(t, err)
	_, err = s.Confirm(context.Background(), auth, start.UserCode)
	require.NoError(t, err)
	exchange, err := s.Exchange(context.Background(), start.EnrollmentID, start.PollSecret)
	require.NoError(t, err)
	return start, exchange
}

func TestPairingKeepsSecretsSeparateAndConsumesOnce(t *testing.T) {
	s, auth := testService(t)
	ctx := context.Background()
	in := startInput()
	start, err := s.Start(ctx, in)
	require.NoError(t, err)
	require.Len(t, start.UserCode, 11)
	require.True(t, validSecret(start.PollSecret))
	preview, err := s.Preview(ctx, strings.ToLower(start.UserCode))
	require.NoError(t, err)
	require.Equal(t, "pending", preview.Status)
	require.Equal(t, in.WorkspaceRoot, preview.WorkspaceRoot)
	encoded, err := json.Marshal(preview)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "secret")
	require.NotContains(t, string(encoded), "hash")
	pending, err := s.Exchange(ctx, start.EnrollmentID, start.PollSecret)
	require.NoError(t, err)
	require.Equal(t, "pending", pending.Status)
	require.Empty(t, pending.Credential)
	wrong, err := secret()
	require.NoError(t, err)
	_, err = s.Exchange(ctx, start.EnrollmentID, wrong)
	require.ErrorIs(t, err, ErrInvalid)
	confirmed, err := s.Confirm(ctx, auth, start.UserCode)
	require.NoError(t, err)
	require.Equal(t, "confirmed", confirmed.Status)
	_, err = s.Confirm(ctx, auth, start.UserCode)
	require.ErrorIs(t, err, ErrConflict)
	exchange, err := s.Exchange(ctx, start.EnrollmentID, start.PollSecret)
	require.NoError(t, err)
	require.Equal(t, "enrolled", exchange.Status)
	require.NotEqual(t, start.PollSecret, exchange.Credential)
	require.WithinDuration(t, time.Now().Add(CredentialTTL), exchange.ExpiresAt, time.Second)
	_, err = s.Authenticate(ctx, start.PollSecret)
	require.ErrorIs(t, err, errcode.AuthInvalidToken)
	p, err := s.Authenticate(ctx, exchange.Credential)
	require.NoError(t, err)
	require.Equal(t, auth.IdentityID, p.IdentityID)
	require.Equal(t, in.DeviceID, p.DeviceID)
	require.NoError(t, s.ValidatePrincipal(ctx, p))
	var stored model.EdgeDeviceCredential
	require.NoError(t, s.db.First(&stored).Error)
	require.Equal(t, digest(exchange.Credential), stored.CredentialHash)
	_, err = s.Exchange(ctx, start.EnrollmentID, start.PollSecret)
	require.ErrorIs(t, err, ErrInvalid)
	_, err = s.Preview(ctx, start.UserCode)
	require.ErrorIs(t, err, ErrInvalid)
	require.NoError(t, s.Heartbeat(ctx, p))
	var target model.ExecutionTarget
	var evidence model.ExecutionTargetEvidence
	require.NoError(t, s.db.First(&target).Error)
	require.NoError(t, s.db.First(&evidence).Error)
	require.Equal(t, "paired_device", evidence.Source)
	require.Equal(t, target.ID, evidence.ObservedTargetID)
	require.Equal(t, auth.UserID+":edge:"+in.DeviceID, evidence.RouteKey)
	require.Equal(t, "online", dispatch.ResolveExecutionTargetHealthState(&target, &evidence, time.Now()))
	require.Equal(t, "stale", dispatch.ResolveExecutionTargetHealthState(&target, &evidence, time.Now().Add(HeartbeatTTL+time.Second)))
	require.JSONEq(t, `{"pairedDevice":true,"runtimeId":"openai-sdk","multiTurn":true,"toolExecution":false}`, target.Capabilities)
	require.NoError(t, s.Revoke(ctx, auth.UserID, in.DeviceID))
	require.NoError(t, s.Revoke(ctx, auth.UserID, in.DeviceID))
	require.ErrorIs(t, s.ValidatePrincipal(ctx, p), errcode.AuthInvalidToken)
	require.ErrorIs(t, s.Heartbeat(ctx, p), errcode.AuthInvalidToken)
	_, err = s.Authenticate(ctx, exchange.Credential)
	require.ErrorIs(t, err, errcode.AuthInvalidToken)
	var retained int64
	require.NoError(t, s.db.Model(&model.EdgeDeviceCredential{}).Count(&retained).Error)
	require.EqualValues(t, 1, retained)
}

func TestInvalidStartAndCodesDoNotCreateEnrollment(t *testing.T) {
	s, _ := testService(t)
	for _, change := range []func(*StartInput){
		func(i *StartInput) { i.DeviceID = "bad" },
		func(i *StartInput) { i.DeviceID = uuid.Nil.String() },
		func(i *StartInput) { i.Name = "" },
		func(i *StartInput) { i.Name = "bad\nname" },
		func(i *StartInput) { i.RuntimeID = "codex" },
		func(i *StartInput) { i.WorkspaceRoot = "project" },
		func(i *StartInput) { i.WorkspaceRoot = "/" },
		func(i *StartInput) { i.WorkspaceRoot = "/workspace/../etc" },
		func(i *StartInput) { i.WorkspaceRoot = "/workspace/\x00" },
	} {
		in := startInput()
		change(&in)
		_, err := s.Start(context.Background(), in)
		require.ErrorIs(t, err, ErrInvalid)
	}
	for _, code := range []string{"", "ABC-DEF-GHIJ", "ABCDEFGHI0", "ABCDEFGHI1", "AAAAA_AAAAA", "ＡＢＣＤＥＦＧＨＩＪ", strings.Repeat("A", 1000)} {
		_, err := s.Preview(context.Background(), code)
		require.ErrorIs(t, err, ErrInvalid)
	}
	var count int64
	require.NoError(t, s.db.Model(&model.EdgeEnrollment{}).Count(&count).Error)
	require.Zero(t, count)
}

func TestCredentialRejectsIdentityAndBindingChanges(t *testing.T) {
	for _, scenario := range []string{"logout", "retired", "other_provider", "other_identity", "client_change", "user_missing", "device_owner", "device_type", "target_owner", "target_device", "target_deleted", "workspace_changed", "expired"} {
		t.Run(scenario, func(t *testing.T) {
			s, auth := testService(t)
			_, exchange := pair(t, s, auth, startInput())
			p, err := s.Authenticate(context.Background(), exchange.Credential)
			require.NoError(t, err)
			switch scenario {
			case "logout":
				require.NoError(t, s.db.Model(&model.OIDCSubjectEpoch{}).Where("1 = 1").Update("generation", 1).Error)
			case "retired":
				require.NoError(t, s.db.Model(&model.UserIdentity{}).Where("id = ?", auth.IdentityID).Update("status", "retired").Error)
			case "other_provider":
				require.NoError(t, s.db.Model(&model.UserIdentity{}).Where("id = ?", auth.IdentityID).Update("provider", "legacy").Error)
			case "other_identity":
				require.NoError(t, s.db.Model(&model.EdgeDeviceCredential{}).Where("device_id = ?", p.DeviceID).Update("user_identity_id", uuid.NewString()).Error)
			case "client_change":
				s.clientID = "replacement-client"
			case "user_missing":
				require.NoError(t, s.db.Delete(&model.User{}, "id = ?", auth.UserID).Error)
			case "device_owner":
				require.NoError(t, s.db.Model(&model.Device{}).Where("id = ?", p.DeviceID).Update("user_id", uuid.NewString()).Error)
			case "device_type":
				require.NoError(t, s.db.Model(&model.Device{}).Where("id = ?", p.DeviceID).Update("device_type", "desktop").Error)
			case "target_owner":
				require.NoError(t, s.db.Model(&model.ExecutionTarget{}).Where("id = ?", p.TargetID).Update("owner_id", uuid.NewString()).Error)
			case "target_device":
				require.NoError(t, s.db.Model(&model.ExecutionTarget{}).Where("id = ?", p.TargetID).Update("device_id", uuid.NewString()).Error)
			case "target_deleted":
				require.NoError(t, s.db.Model(&model.ExecutionTarget{}).Where("id = ?", p.TargetID).Update("deleted_at", time.Now()).Error)
			case "workspace_changed":
				require.NoError(t, s.db.Model(&model.ExecutionTarget{}).Where("id = ?", p.TargetID).Update("workspace_root", "/elsewhere").Error)
			case "expired":
				s.now = func() time.Time { return exchange.ExpiresAt }
			}
			_, err = s.Authenticate(context.Background(), exchange.Credential)
			require.ErrorIs(t, err, errcode.AuthInvalidToken)
			require.ErrorIs(t, s.ValidatePrincipal(context.Background(), p), errcode.AuthInvalidToken)
		})
	}
}

func TestConfirmAndExchangeRecheckIdentity(t *testing.T) {
	for _, when := range []string{"confirm", "exchange"} {
		for _, change := range []string{"generation", "retired", "client"} {
			t.Run(when+"_"+change, func(t *testing.T) {
				s, auth := testService(t)
				ctx := context.Background()
				start, err := s.Start(ctx, startInput())
				require.NoError(t, err)
				if when == "exchange" {
					_, err = s.Confirm(ctx, auth, start.UserCode)
					require.NoError(t, err)
				}
				switch change {
				case "generation":
					require.NoError(t, s.db.Model(&model.OIDCSubjectEpoch{}).Where("1 = 1").Update("generation", 1).Error)
				case "retired":
					require.NoError(t, s.db.Model(&model.UserIdentity{}).Where("id = ?", auth.IdentityID).Update("status", "retired").Error)
				case "client":
					s.clientID = "replacement-client"
				}
				if when == "confirm" {
					_, err = s.Confirm(ctx, auth, start.UserCode)
				} else {
					_, err = s.Exchange(ctx, start.EnrollmentID, start.PollSecret)
				}
				require.ErrorIs(t, err, errcode.AuthInvalidToken)
				var count int64
				require.NoError(t, s.db.Model(&model.EdgeDeviceCredential{}).Count(&count).Error)
				require.Zero(t, count)
			})
		}
	}
}

func TestReenrollmentPreservesOwnerWorkspaceAndInvalidatesOldCredential(t *testing.T) {
	s, auth := testService(t)
	ctx := context.Background()
	in := startInput()
	_, original := pair(t, s, auth, in)
	p, err := s.Authenticate(ctx, original.Credential)
	require.NoError(t, err)
	other := seedIdentity(t, s.db)
	start, err := s.Start(ctx, in)
	require.NoError(t, err)
	_, err = s.Confirm(ctx, other, start.UserCode)
	require.ErrorIs(t, err, ErrConflict)
	require.ErrorIs(t, s.Revoke(ctx, other.UserID, in.DeviceID), ErrInvalid)
	_, next := pair(t, s, auth, in)
	require.Equal(t, original.TargetID, next.TargetID)
	require.ErrorIs(t, s.ValidatePrincipal(ctx, p), errcode.AuthInvalidToken)
	_, err = s.Authenticate(ctx, original.Credential)
	require.ErrorIs(t, err, errcode.AuthInvalidToken)
	in.WorkspaceRoot = "/different"
	start, err = s.Start(ctx, in)
	require.NoError(t, err)
	_, err = s.Confirm(ctx, auth, start.UserCode)
	require.NoError(t, err)
	_, err = s.Exchange(ctx, start.EnrollmentID, start.PollSecret)
	require.ErrorIs(t, err, ErrConflict)
	_, err = s.Authenticate(ctx, next.Credential)
	require.NoError(t, err)
}

func TestOldConfirmationCannotUndoRevocation(t *testing.T) {
	s, auth := testService(t)
	ctx := context.Background()
	in := startInput()
	pair(t, s, auth, in)
	start, err := s.Start(ctx, in)
	require.NoError(t, err)
	_, err = s.Confirm(ctx, auth, start.UserCode)
	require.NoError(t, err)
	require.NoError(t, s.Revoke(ctx, auth.UserID, in.DeviceID))
	_, err = s.Exchange(ctx, start.EnrollmentID, start.PollSecret)
	require.ErrorIs(t, err, ErrConflict)
	_, restored := pair(t, s, auth, in)
	_, err = s.Authenticate(ctx, restored.Credential)
	require.NoError(t, err)
}

func TestEnrollmentExpiryAndUnavailableDatabase(t *testing.T) {
	s, auth := testService(t)
	ctx := context.Background()
	start, err := s.Start(ctx, startInput())
	require.NoError(t, err)
	s.now = func() time.Time { return start.ExpiresAt }
	_, err = s.Preview(ctx, start.UserCode)
	require.ErrorIs(t, err, ErrInvalid)
	_, err = s.Confirm(ctx, auth, start.UserCode)
	require.ErrorIs(t, err, ErrInvalid)
	_, err = s.Exchange(ctx, start.EnrollmentID, start.PollSecret)
	require.ErrorIs(t, err, ErrInvalid)
	db, err := s.db.DB()
	require.NoError(t, err)
	require.NoError(t, db.Close())
	_, err = s.Authenticate(ctx, start.PollSecret)
	require.ErrorIs(t, err, errcode.AuthUnavailable)
}

func TestTransactionalValidationRejectsForgedOrRotatedScope(t *testing.T) {
	s, auth := testService(t)
	ctx := context.Background()
	in := startInput()
	_, exchange := pair(t, s, auth, in)
	p, err := s.Authenticate(ctx, exchange.Credential)
	require.NoError(t, err)
	validate := func(p *Principal) error {
		return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			return s.ValidatePrincipalTx(tx, p)
		})
	}
	require.NoError(t, validate(p))
	require.ErrorIs(t, validate(nil), errcode.AuthInvalidToken)
	for _, change := range []func(*Principal){
		func(p *Principal) { p.UserID = uuid.NewString() },
		func(p *Principal) { p.DeviceID = uuid.NewString() },
		func(p *Principal) { p.TargetID = uuid.NewString() },
		func(p *Principal) { p.IdentityID = uuid.NewString() },
		func(p *Principal) { p.Generation++ },
		func(p *Principal) { p.OIDCClientID = "another-client" },
		func(p *Principal) { p.RuntimeID = "codex" },
		func(p *Principal) { p.WorkspaceRoot = "/different" },
		func(p *Principal) { p.ExpiresAt = p.ExpiresAt.Add(time.Hour) },
	} {
		forged := *p
		change(&forged)
		require.ErrorIs(t, validate(&forged), errcode.AuthInvalidToken)
	}
	_, next := pair(t, s, auth, in)
	require.ErrorIs(t, validate(p), errcode.AuthInvalidToken)
	current, err := s.Authenticate(ctx, next.Credential)
	require.NoError(t, err)
	require.NoError(t, validate(current))
}
