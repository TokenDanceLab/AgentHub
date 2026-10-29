package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/edgedevice"
	"github.com/agenthub/hub-server/internal/service/edgeenrollment"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

type emptyEdgeChannel struct {
	enrollment *edgeenrollment.Service
	channel    *edgedevice.Service
}

func (ch emptyEdgeChannel) IsPairedDevice(ctx context.Context, deviceID string) (bool, error) {
	return ch.channel.IsPairedDevice(ctx, deviceID)
}

func (ch emptyEdgeChannel) Poll(ctx context.Context, p *edgeenrollment.Principal) (*edgedevice.PollResult, error) {
	if err := ch.enrollment.ValidatePrincipal(ctx, p); err != nil {
		return nil, err
	}
	return &edgedevice.PollResult{Deliveries: []edgedevice.Delivery{}, Controls: []edgedevice.Control{}}, nil
}
func (ch emptyEdgeChannel) AuthorizeTask(context.Context, *edgeenrollment.Principal, string) error {
	return errcode.AgentTaskNotFound
}
func (ch emptyEdgeChannel) AckControl(context.Context, *edgeenrollment.Principal, string, edgedevice.ControlAck) error {
	return errcode.AgentTaskNotFound
}

func pairedHTTPFixture(t *testing.T) (*browserHTTPFixture, *edgeenrollment.Service) {
	t.Helper()
	f := newBrowserHTTPFixture(t)
	require.NoError(t, f.db.AutoMigrate(&model.EdgeEnrollment{}, &model.EdgeDeviceCredential{}))
	require.NoError(t, f.db.Exec(`CREATE TABLE execution_targets (
		id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, device_id TEXT, name TEXT NOT NULL,
		target_type TEXT, host TEXT, port INTEGER, workspace_root TEXT, workspace_allowlist TEXT,
		trust_level TEXT, health_state TEXT, auth_method TEXT, is_online BOOLEAN,
		last_seen_at DATETIME, capabilities TEXT, metadata TEXT, created_at DATETIME,
		updated_at DATETIME, deleted_at DATETIME)`).Error)
	require.NoError(t, f.db.Exec(`CREATE TABLE execution_target_evidence (
		id TEXT PRIMARY KEY, target_id TEXT NOT NULL UNIQUE, source TEXT, status TEXT,
		failure_category TEXT, observed_target_id TEXT, route_key TEXT, observed_at DATETIME,
		expires_at DATETIME, created_at DATETIME, updated_at DATETIME)`).Error)
	svc := edgeenrollment.New(f.db, "hub-fixture")
	h := NewEdgeEnrollmentHandler(svc, emptyEdgeChannel{svc, edgedevice.New(f.db, svc)}, "hub-fixture")
	cfg := &config.Config{BrowserSession: f.handler.cfg, JWT: f.jwt}
	mw := middleware.NewAuthMiddleware(cfg, middleware.AuthDependencies{Sessions: f.handler.auth})
	f.router.POST("/edge/enrollments/start", h.Start)
	f.router.POST("/edge/enrollments/exchange", h.Exchange)
	web := f.router.Group("/web", mw.Handler(), mw.RequireHubSession())
	web.POST("/edge-enrollments/preview", h.Preview)
	web.POST("/edge-enrollments/confirm", h.Confirm)
	web.POST("/edge-devices/:device_id/revoke", h.Revoke)
	device := f.router.Group("/edge/device", h.DeviceAuth)
	device.POST("/heartbeat", h.Heartbeat)
	device.GET("/poll", h.Poll)
	device.POST("/tasks/:id/ack", h.TaskAuthorization, func(c *gin.Context) { t.Error("foreign task reached callback"); OK(c, nil) })
	legacy := f.router.Group("/edge/agent-tasks", mw.Handler(), mw.RequireHubSession(), middleware.DeviceTypeCheck("desktop"), h.LegacyCallback)
	legacy.POST("/:id/ack", func(c *gin.Context) { OK(c, nil) })
	return f, svc
}

func edgeHTTP(t *testing.T, f *browserHTTPFixture, method, path string, body any, bearer string) *httptest.ResponseRecorder {
	t.Helper()
	var encoded []byte
	if body != nil {
		var err error
		encoded, err = json.Marshal(body)
		require.NoError(t, err)
	}
	req := httptest.NewRequest(method, f.handler.cfg.Origin+path, bytes.NewReader(encoded))
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	w := httptest.NewRecorder()
	f.router.ServeHTTP(w, req)
	return w
}

func decodeEdgeData[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	var envelope struct {
		Data T `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &envelope))
	return envelope.Data
}

func beginHTTPEdge(t *testing.T, f *browserHTTPFixture) edgeenrollment.StartResult {
	t.Helper()
	w := edgeHTTP(t, f, "POST", "/edge/enrollments/start", edgeenrollment.StartInput{DeviceID: uuid.NewString(), Name: "Owned test Edge", RuntimeID: "openai-sdk", WorkspaceRoot: "/workspace/test"}, "")
	require.Equal(t, 200, w.Code)
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	return decodeEdgeData[edgeenrollment.StartResult](t, w)
}

func TestEdgeEnrollmentBrowserFlowAndTokenSeparation(t *testing.T) {
	f, _ := pairedHTTPFixture(t)
	cookie, session := f.login(t)
	start := beginHTTPEdge(t, f)
	exchangeBody := map[string]string{"enrollment_id": start.EnrollmentID, "poll_secret": start.PollSecret}
	w := edgeHTTP(t, f, "POST", "/edge/enrollments/exchange", exchangeBody, "")
	require.Equal(t, 202, w.Code)
	require.NotContains(t, w.Body.String(), "credential")
	previewPath := "/web/edge-enrollments/preview"
	confirmBody := map[string]string{"user_code": start.UserCode}
	w = f.request("POST", previewPath, confirmBody, nil, "")
	require.Equal(t, 401, w.Code)
	w = f.request("POST", previewPath, confirmBody, cookie, "")
	require.Equal(t, 403, w.Code)
	w = f.request("POST", previewPath, confirmBody, cookie, session.CSRFToken)
	require.Equal(t, 200, w.Code)
	for _, forbidden := range []string{start.PollSecret, "credential", "identity", "user_id"} {
		require.NotContains(t, w.Body.String(), forbidden)
	}
	w = f.request("POST", "/web/edge-enrollments/confirm", confirmBody, cookie, "")
	require.Equal(t, 403, w.Code)
	w = f.request("POST", "/web/edge-enrollments/confirm", confirmBody, cookie, session.CSRFToken)
	require.Equal(t, 200, w.Code)
	require.NotContains(t, w.Body.String(), "credential")
	require.NotContains(t, w.Body.String(), start.PollSecret)
	w = f.request("POST", "/web/edge-enrollments/confirm", confirmBody, cookie, session.CSRFToken)
	require.Equal(t, 409, w.Code)
	w = edgeHTTP(t, f, "POST", "/edge/enrollments/exchange", exchangeBody, "")
	require.Equal(t, 200, w.Code)
	exchanged := decodeEdgeData[edgeenrollment.ExchangeResult](t, w)
	require.NotEmpty(t, exchanged.Credential)
	w = edgeHTTP(t, f, "POST", "/edge/enrollments/exchange", exchangeBody, "")
	require.Equal(t, 400, w.Code)
	w = edgeHTTP(t, f, "POST", "/edge/device/heartbeat", nil, exchanged.Credential)
	require.Equal(t, 200, w.Code)
	w = edgeHTTP(t, f, "GET", "/edge/device/poll?wait_seconds=0", nil, exchanged.Credential)
	require.Equal(t, 200, w.Code)
	require.JSONEq(t, `{"code":"ok","data":{"deliveries":[],"controls":[]}}`, w.Body.String())
	w = f.request("POST", "/edge/device/heartbeat", nil, cookie, session.CSRFToken)
	require.Equal(t, 401, w.Code, "product cookie must not authenticate device channel")
	w = edgeHTTP(t, f, "POST", previewPath, confirmBody, exchanged.Credential)
	require.Equal(t, 401, w.Code, "device credential must not authenticate product route")
	for _, query := range []string{"wait_seconds=-1", "wait_seconds=21", "wait_seconds=0&wait_seconds=1", "wait_seconds=x"} {
		w = edgeHTTP(t, f, "GET", "/edge/device/poll?"+query, nil, exchanged.Credential)
		require.Equal(t, 400, w.Code)
	}
	w = edgeHTTP(t, f, "GET", "/edge/device/poll?wait_seconds=0&access_token=not-accepted", nil, exchanged.Credential)
	require.Equal(t, 401, w.Code)
	w = edgeHTTP(t, f, "POST", "/edge/device/tasks/"+uuid.NewString()+"/ack", map[string]string{"run_id": "run-1"}, exchanged.Credential)
	require.Equal(t, 404, w.Code)
	w = f.request("POST", "/web/edge-devices/"+exchanged.DeviceID+"/revoke", nil, cookie, session.CSRFToken)
	require.Equal(t, 200, w.Code)
	w = edgeHTTP(t, f, "POST", "/edge/device/heartbeat", nil, exchanged.Credential)
	require.Equal(t, 401, w.Code)
}

func TestEdgeEnrollmentNativeIdentityAndLogoutGeneration(t *testing.T) {
	f, _ := pairedHTTPFixture(t)
	_, session := f.login(t)
	var identity model.UserIdentity
	require.NoError(t, f.db.Where("user_id = ?", session.User.ID).Take(&identity).Error)
	var epoch model.OIDCSubjectEpoch
	require.NoError(t, f.db.Where("issuer = ? AND subject = ?", identity.Issuer, identity.Subject).Take(&epoch).Error)
	token, err := jwtutil.GenerateIdentityAccessToken(session.User.ID, "desktop", uuid.NewString(), identity.ID, epoch.Generation, f.jwt.Secret, time.Hour, "hub-fixture")
	require.NoError(t, err)
	start := beginHTTPEdge(t, f)
	w := edgeHTTP(t, f, "POST", "/web/edge-enrollments/confirm", map[string]string{"user_code": start.UserCode}, token)
	require.Equal(t, 200, w.Code)
	w = edgeHTTP(t, f, "POST", "/edge/enrollments/exchange", map[string]string{"enrollment_id": start.EnrollmentID, "poll_secret": start.PollSecret}, "")
	require.Equal(t, 200, w.Code)
	exchanged := decodeEdgeData[edgeenrollment.ExchangeResult](t, w)
	w = edgeHTTP(t, f, "POST", "/edge/device/heartbeat", nil, token)
	require.Equal(t, 401, w.Code, "native product JWT is not a device credential")
	edgeToken, err := jwtutil.GenerateEdgeToken(session.User.ID, exchanged.DeviceID, f.jwt.Secret, time.Hour)
	require.NoError(t, err)
	w = edgeHTTP(t, f, "POST", "/edge/device/heartbeat", nil, edgeToken)
	require.Equal(t, 401, w.Code, "Edge API JWT is not a paired device credential")
	claimedDeviceToken, err := jwtutil.GenerateIdentityAccessToken(session.User.ID, "desktop", exchanged.DeviceID, identity.ID, epoch.Generation, f.jwt.Secret, time.Hour, "hub-fixture")
	require.NoError(t, err)
	w = edgeHTTP(t, f, "POST", "/edge/agent-tasks/"+uuid.NewString()+"/ack", map[string]string{"run_id": "run-1"}, claimedDeviceToken)
	require.Equal(t, 403, w.Code, "product session cannot bypass paired credential by claiming the same device UUID")
	w = edgeHTTP(t, f, "POST", "/edge/agent-tasks/"+uuid.NewString()+"/ack", map[string]string{"run_id": "run-1"}, token)
	require.Equal(t, 200, w.Code, "unpaired Desktop callback route remains available")
	require.NoError(t, f.db.Model(&epoch).Where("issuer = ? AND subject = ?", epoch.Issuer, epoch.Subject).Update("generation", epoch.Generation+1).Error)
	w = edgeHTTP(t, f, "GET", "/edge/device/poll?wait_seconds=0", nil, exchanged.Credential)
	require.Equal(t, 401, w.Code)
	start = beginHTTPEdge(t, f)
	w = edgeHTTP(t, f, "POST", "/web/edge-enrollments/confirm", map[string]string{"user_code": start.UserCode}, token)
	require.Equal(t, 401, w.Code)
}
