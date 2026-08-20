//go:build integration

package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/egress"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/log"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/router"
	"github.com/agenthub/hub-server/internal/service"
	"github.com/agenthub/hub-server/internal/service/agentprofile"
	"github.com/agenthub/hub-server/internal/service/agentteam"
	"github.com/agenthub/hub-server/internal/service/attachment"
	"github.com/agenthub/hub-server/internal/service/audit"
	"github.com/agenthub/hub-server/internal/service/auth"
	"github.com/agenthub/hub-server/internal/service/contact"
	"github.com/agenthub/hub-server/internal/service/device"
	"github.com/agenthub/hub-server/internal/service/executiontarget"
	"github.com/agenthub/hub-server/internal/service/mcpserver"
	"github.com/agenthub/hub-server/internal/service/message"
	"github.com/agenthub/hub-server/internal/service/messagereaction"
	"github.com/agenthub/hub-server/internal/service/notification"
	"github.com/agenthub/hub-server/internal/service/oidc"
	"github.com/agenthub/hub-server/internal/service/providerbinding"
	"github.com/agenthub/hub-server/internal/service/publicstats"
	"github.com/agenthub/hub-server/internal/service/relay"
	"github.com/agenthub/hub-server/internal/service/session"
	"github.com/agenthub/hub-server/internal/service/skill"
	"github.com/agenthub/hub-server/internal/testkit"
	"github.com/agenthub/hub-server/internal/ws"
)

var (
	ts              *httptest.Server
	client          *http.Client
	mgr             *ws.Manager
	eventBus        *bus.Bus
	db              *gorm.DB // hold reference for cleanDB
	testCacheClient *cache.Client
	testJWT         config.JWTConfig
)

type testMessageServiceWithReactions struct {
	*message.Service
	reactions *messagereaction.Service
}

func (s testMessageServiceWithReactions) AddMessageReaction(ctx context.Context, userID, sessionID, msgID, reaction string) (*messagereaction.MessageReactionResponse, error) {
	return s.reactions.AddMessageReaction(ctx, userID, sessionID, msgID, reaction)
}

func (s testMessageServiceWithReactions) RemoveMessageReaction(ctx context.Context, userID, sessionID, msgID, reaction string) (*messagereaction.MessageReactionResponse, error) {
	return s.reactions.RemoveMessageReaction(ctx, userID, sessionID, msgID, reaction)
}

func (s testMessageServiceWithReactions) ListMessageReactions(ctx context.Context, userID, sessionID, msgID string) ([]messagereaction.MessageReactionResponse, error) {
	return s.reactions.ListMessageReactions(ctx, userID, sessionID, msgID)
}

func TestMain(m *testing.M) {
	// No -short escape hatch: this package is `//go:build integration` and only
	// compiles/runs under `-tags integration` (backend-integration CI job with
	// real PostgreSQL + Redis containers). The default/coverage/race lanes
	// never compile it, so the package cannot silently vanish from a lane.
	// Dependencies are explicit: repository.InitDB + RunMigrationsFrom require
	// PostgreSQL, cache.InitRedis requires Redis; failures below are loud.

	gin.SetMode(gin.TestMode)
	metrics.Register()

	// Pre-declare one admin user so admin-gated endpoints (publish, audit)
	// can be exercised by integration tests. RequireAdmin reads
	// AGENTHUB_ADMIN_USERS once at first use, so this must happen before any
	// request; TestMain runs before every test.
	os.Setenv("AGENTHUB_ADMIN_USERS", testAdminUserID)

	cfg, err := config.Load("../../configs/config.yaml")
	if err != nil {
		panic(fmt.Sprintf("failed to load config: %v", err))
	}
	if cfg.JWT.Secret == "" {
		cfg.JWT.Secret = "test-jwt-secret-for-integration-tests"
	}
	testJWT = cfg.JWT
	log.Init(&cfg.Server)

	database, err := repository.InitDB(&cfg.DB)
	if err != nil {
		panic(fmt.Sprintf("failed to init db: %v", err))
	}
	db = database
	if err := repository.RunMigrationsFrom(&cfg.DB, "file://../../migrations"); err != nil {
		panic(fmt.Sprintf("failed to run migrations: %v", err))
	}
	rdb, err := cache.InitRedis(&cfg.Redis)
	if err != nil {
		panic(fmt.Sprintf("failed to init redis: %v", err))
	}
	cacheClient := cache.NewClient(rdb)
	testCacheClient = cacheClient

	mgr = ws.NewManager()
	mgr.StartHeartbeat(context.Background())

	b, err := bus.New()
	if err != nil {
		panic(fmt.Sprintf("NewBus failed: %v", err))
	}
	eventBus = b
	wsHandler := handler.NewWebSocketHandler(mgr, cfg.Server.Env)
	authService := auth.NewService(db, cfg.JWT, cacheClient)
	authHandler := handler.NewAuthHandler(authService)
	deviceService := device.NewService(db, nil)
	deviceHandler := handler.NewDeviceHandler(deviceService)
	contactService := contact.NewService(db, eventBus, cacheClient)
	contactHandler := handler.NewContactHandler(contactService)
	sessionService := session.NewService(db, cacheClient)
	sessionHandler := handler.NewSessionHandler(sessionService)
	messageService := message.NewService(db, eventBus, cacheClient)
	messageReactionService := messagereaction.NewService(db, eventBus)
	messageHandler := handler.NewMessageHandler(testMessageServiceWithReactions{
		Service:   messageService,
		reactions: messageReactionService,
	})
	agentService := service.NewAgentService(db, eventBus, mgr, cacheClient, nil, config.EdgeDispatchConfig{}, nil, "")
	agentHandler := handler.NewAgentHandler(agentService)
	customAgentHandler := handler.NewCustomAgentHandler(agentService)
	attachmentService := attachment.NewService(db, cfg.Upload, attachment.NewLocalStorage(cfg.Upload.Dir))
	attachmentHandler := handler.NewAttachmentHandler(attachmentService)
	notificationService := notification.NewService(db, mgr)
	notificationHandler := handler.NewNotificationHandler(notificationService)
	healthHandler := handler.NewHealthHandler(db, cacheClient, &cfg.DB, time.Now(), "test")
	publicHandler := handler.NewPublicHandler(publicstats.NewPublicStatsService(db), time.Now())

	// Phase 1-7 handlers
	// config.yaml ships production-empty TokenDance ID values (client_id "",
	// redirect_uri "", allowed_redirect_uris []), which makes the OIDC
	// authorize success path unreachable in tests. Inject a deterministic
	// test redirect URI so authorize/callback flows are exercisable.
	if cfg.TokenDanceID.RedirectURI == "" {
		cfg.TokenDanceID.RedirectURI = "http://127.0.0.1:54321/callback"
	}
	if len(cfg.TokenDanceID.AllowedRedirectURIs) == 0 {
		cfg.TokenDanceID.AllowedRedirectURIs = []string{"http://127.0.0.1:54321/callback"}
	}

	oidcService := oidc.NewService(db, cfg.TokenDanceID, cfg.JWT, cacheClient)
	oidcHandler := handler.NewOIDCHandler(oidcService)
	profileService := agentprofile.NewService(db)
	agentProfileHandler := handler.NewAgentProfileHandler(profileService)
	skillService := skill.NewService(db)
	skillHandler := handler.NewSkillHandler(skillService)
	mcpService := mcpserver.NewService(db)
	mcpHandler := handler.NewMCPServerHandler(mcpService)
	marketHandler := handler.NewMarketHandler(profileService) // reuses agentprofile.Service
	pbService := providerbinding.NewService(db)
	pbHandler := handler.NewProviderBindingHandler(pbService)
	targetService, _ := executiontarget.NewService(db, egress.Config{AllowCIDRs: []string{"127.0.0.0/8"}, AllowPlainHTTP: true})
	targetHandler := handler.NewExecutionTargetHandler(targetService)
	auditService := audit.NewService(db, nil)
	auditHandler := handler.NewAuditHandler(auditService)
	relayService := relay.NewService(cacheClient, mgr)
	relayHandler := handler.NewRelayHandler(relayService)
	agentTeamService := agentteam.NewAgentTeamService(db, agentService, cacheClient)
	agentTeamHandler := handler.NewAgentTeamHandler(agentTeamService)

	r := gin.New()
	r.Use(gin.Recovery())
	if err := router.SetupRoutes(r, cfg, middleware.NewAuthMiddleware(cfg, middleware.AuthDependencies{}, nil), cfg.JWT.Secret, cacheClient, authHandler, wsHandler, deviceHandler, contactHandler, sessionHandler, messageHandler, agentHandler, customAgentHandler, attachmentHandler, notificationHandler, healthHandler, publicHandler, oidcHandler, agentProfileHandler, skillHandler, mcpHandler, marketHandler, pbHandler, targetHandler, auditHandler, relayHandler, agentTeamHandler, nil, nil); err != nil {
		panic(fmt.Sprintf("SetupRoutes failed: %v", err))
	}

	ts = httptest.NewServer(r)
	client = ts.Client()

	if err := cleanDBTables(db); err != nil {
		panic(fmt.Sprintf("failed to clean integration database: %v", err))
	}
	if err := clearRateLimitKeys(); err != nil {
		panic(fmt.Sprintf("failed to clear test rate limits: %v", err))
	}

	os.Exit(m.Run())
}

// CleanDB truncates all business tables between tests for isolation.
func CleanDB(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := cleanDBTables(db); err != nil {
		t.Fatalf("clean integration database: %v", err)
	}
	if err := clearRateLimitKeys(); err != nil {
		t.Fatalf("clear test rate limits: %v", err)
	}
}

func cleanDBTables(database *gorm.DB) error {
	if database.Dialector.Name() != "postgres" {
		return fmt.Errorf("integration database cleanup requires PostgreSQL, got %s", database.Dialector.Name())
	}

	rows, err := database.Raw(`
		SELECT tablename
		FROM pg_catalog.pg_tables
		WHERE schemaname = current_schema()
		  AND tablename <> 'schema_migrations'
		ORDER BY tablename
	`).Rows()
	if err != nil {
		return fmt.Errorf("list integration tables: %w", err)
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var table string
		if err := rows.Scan(&table); err != nil {
			return fmt.Errorf("scan integration table: %w", err)
		}
		tables = append(tables, table)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate integration tables: %w", err)
	}
	if len(tables) == 0 {
		return nil
	}

	quoted := make([]string, 0, len(tables))
	hasAuditEvents := false
	for _, table := range tables {
		quoted = append(quoted, `"`+strings.ReplaceAll(table, `"`, `""`)+`"`)
		hasAuditEvents = hasAuditEvents || table == "audit_events"
	}

	if hasAuditEvents {
		if err := database.Exec("ALTER TABLE audit_events DISABLE TRIGGER USER").Error; err != nil {
			return fmt.Errorf("disable audit_events cleanup trigger: %w", err)
		}
	}

	truncateErr := database.Exec("TRUNCATE TABLE " + strings.Join(quoted, ", ") + " RESTART IDENTITY CASCADE").Error
	var enableErr error
	if hasAuditEvents {
		enableErr = database.Exec("ALTER TABLE audit_events ENABLE TRIGGER USER").Error
	}
	if truncateErr != nil {
		return fmt.Errorf("truncate integration tables: %w", truncateErr)
	}
	if enableErr != nil {
		return fmt.Errorf("enable audit_events cleanup trigger: %w", enableErr)
	}
	return nil
}

func TestCleanDBDiscoversNewTables(t *testing.T) {
	CleanDB(t, db)
	if err := db.Exec("DROP TABLE IF EXISTS cleanup_probe").Error; err != nil {
		t.Fatalf("drop stale cleanup probe: %v", err)
	}
	if err := db.Exec("CREATE TABLE cleanup_probe (id integer PRIMARY KEY)").Error; err != nil {
		t.Fatalf("create cleanup probe: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Exec("DROP TABLE IF EXISTS cleanup_probe").Error; err != nil {
			t.Errorf("drop cleanup probe: %v", err)
		}
	})
	if err := db.Exec("INSERT INTO cleanup_probe (id) VALUES (1)").Error; err != nil {
		t.Fatalf("seed cleanup probe: %v", err)
	}

	if err := cleanDBTables(db); err != nil {
		t.Fatalf("clean integration database: %v", err)
	}
	var count int64
	if err := db.Table("cleanup_probe").Count(&count).Error; err != nil {
		t.Fatalf("count cleanup probe: %v", err)
	}
	if count != 0 {
		t.Fatalf("cleanup probe retained %d rows; new tables must be discovered automatically", count)
	}
}

func clearRateLimitKeys() error {
	if testCacheClient == nil {
		return nil
	}
	ctx := context.Background()
	var keys []string
	for _, pattern := range []string{"rate_limit:*", "ratelimit:*"} {
		matched, err := testCacheClient.GetRDB().Keys(ctx, pattern).Result()
		if err != nil {
			return err
		}
		keys = append(keys, matched...)
	}
	if len(keys) == 0 {
		return nil
	}
	return testCacheClient.GetRDB().Del(ctx, keys...).Err()
}

func post(path string, body interface{}) *http.Response {
	return do("POST", path, body, "")
}

func postAuth(path string, token string, body interface{}) *http.Response {
	return do("POST", path, body, token)
}

func patchAuth(path string, token string, body interface{}) *http.Response {
	return do("PATCH", path, body, token)
}

func get(path string, token string) *http.Response {
	return do("GET", path, nil, token)
}

func put(path string, token string, body interface{}) *http.Response {
	return do("PUT", path, body, token)
}

func del(path string, token string) *http.Response {
	return do("DELETE", path, nil, token)
}

func do(method, path string, body interface{}, token string) *http.Response {
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, ts.URL+path, r)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := client.Do(req)
	if err != nil {
		panic(fmt.Sprintf("request failed: %v", err))
	}
	return resp
}

// apiResp is the shared Hub response envelope (internal/testkit.APIResponse).
type apiResp = testkit.APIResponse

func parse(resp *http.Response) apiResp {
	defer resp.Body.Close()
	var r apiResp
	json.NewDecoder(resp.Body).Decode(&r)
	return r
}

func extract(data json.RawMessage, field string) string {
	var m map[string]json.RawMessage
	json.Unmarshal(data, &m)
	var s string
	json.Unmarshal(m[field], &s)
	return s
}

type testUser struct {
	Username string
	Password string
	Token    string
	ID       string
}

func register(t *testing.T, username, password, nickname string) testUser {
	t.Helper()

	user := model.User{
		Username: username,
		Nickname: nickname,
	}
	if err := db.Create(&user).Error; err != nil {
		existing, findErr := repository.GetUserByUsername(db, username)
		if findErr != nil {
			t.Fatalf("create test user %s failed: %v", username, err)
		}
		user = *existing
	}

	deviceID := testDeviceID(username, "web")
	seedTestDevice(t, user.ID, "web", deviceID)
	token, err := jwtutil.GenerateAccessToken(user.ID, "web", deviceID, testJWT.Secret, testJWT.AccessTTL)
	if err != nil {
		t.Fatalf("generate token for %s: %v", username, err)
	}

	return testUser{Username: username, Password: password, Token: token, ID: user.ID}
}

// testAdminUserID is pre-declared in AGENTHUB_ADMIN_USERS (see TestMain), so
// registerAsAdmin users pass middleware.RequireAdmin for admin-gated
// endpoints (profile/skill publish, audit list, market publish).
const testAdminUserID = "11111111-1111-4111-8111-111111111111"

func registerAsAdmin(t *testing.T, username, password, nickname string) testUser {
	t.Helper()

	user := model.User{
		ID:       testAdminUserID,
		Username: username,
		Nickname: nickname,
	}
	// SkipHooks bypasses User.BeforeCreate (which always generates a UUIDv7
	// ID), keeping the pre-declared admin ID.
	if err := db.Session(&gorm.Session{SkipHooks: true}).Create(&user).Error; err != nil {
		t.Fatalf("create admin test user %s failed: %v", username, err)
	}

	deviceID := testDeviceID(username, "web")
	token, err := jwtutil.GenerateAccessToken(user.ID, "web", deviceID, testJWT.Secret, testJWT.AccessTTL)
	if err != nil {
		t.Fatalf("generate token for %s: %v", username, err)
	}

	return testUser{Username: username, Password: password, Token: token, ID: user.ID}
}

// seedRefreshToken stores a refresh token for the given user/device directly
// in the DB — the same shape the OIDC callback persists (hash-only, TTL from
// config) — and returns the raw token for use against /client/auth/refresh.
// Password login used to be how tests obtained refresh tokens; it was removed
// with the OIDC migration (#1367), so tests seed the row directly (#1369).
// refresh_tokens.device_id has an FK to devices.id, so the device row is
// seeded first (a real login registers it via device registration).
func seedRefreshToken(t *testing.T, userID, deviceType, deviceID string) string {
	t.Helper()
	seedTestDevice(t, userID, deviceType, deviceID)

	device := &model.Device{
		ID:           deviceID,
		UserID:       userID,
		DeviceType:   deviceType,
		Capabilities: "[]",
	}
	if err := db.Clauses(clause.OnConflict{DoNothing: true}).Create(device).Error; err != nil {
		t.Fatalf("seed device %s for refresh token: %v", deviceID, err)
	}

	raw, err := jwtutil.GenerateRefreshToken()
	if err != nil {
		t.Fatalf("generate refresh token: %v", err)
	}
	rt := &model.RefreshToken{
		UserID:     userID,
		DeviceType: deviceType,
		DeviceID:   deviceID,
		TokenHash:  jwtutil.HashRefreshToken(raw),
		ExpiresAt:  time.Now().Add(testJWT.RefreshTTL),
	}
	if err := repository.UpsertRefreshToken(db, rt); err != nil {
		t.Fatalf("seed refresh token for user %s device %s: %v", userID, deviceID, err)
	}
	return raw
}

// seedTestDevice persists the device identity carried by test access and
// refresh tokens. Production OIDC login always upserts the device before it
// issues tokens, and the refresh_tokens.device_id foreign key requires tests
// to preserve that ordering as well.
func seedTestDevice(t *testing.T, userID, deviceType, deviceID string) {
	t.Helper()
	if err := repository.UpsertDevice(db, &model.Device{
		ID:           deviceID,
		UserID:       userID,
		DeviceType:   deviceType,
		AppVersion:   "integration-test",
		Capabilities: "[]",
		LastActiveAt: time.Now(),
	}); err != nil {
		t.Fatalf("seed device %s for user %s: %v", deviceID, userID, err)
	}
}

func TestSetupRegisterCreatesHubSession(t *testing.T) {
	CleanDB(t, db)

	u := register(t, "tsetup_user", "pass1234", "SetupUser")

	w := get("/client/auth/me", u.Token)
	r := parse(w)
	if r.GetCode() != errcode.OK.Code {
		t.Fatalf("me %s failed: %s", u.Username, r.GetCode())
	}
	id := extract(r.Data, "id")
	if id != u.ID {
		t.Fatalf("me returned id %s, want %s", id, u.ID)
	}

	device, err := repository.GetDeviceByID(db, testDeviceID(u.Username, "web"))
	if err != nil {
		t.Fatalf("registered test session must persist its device: %v", err)
	}
	if device.UserID != u.ID || device.DeviceType != "web" {
		t.Fatalf("registered device owner/type = %s/%s, want %s/web", device.UserID, device.DeviceType, u.ID)
	}
}

func testDeviceID(username, deviceType string) string {
	h := uint64(1469598103934665603)
	for _, b := range []byte(username + ":" + deviceType) {
		h ^= uint64(b)
		h *= 1099511628211
	}
	return fmt.Sprintf("dddddddd-dddd-4ddd-8ddd-%012x", h&0xffffffffffff)
}

func mustOK(t *testing.T, r apiResp, msg string) {
	t.Helper()
	if r.GetCode() != errcode.OK.Code {
		t.Fatalf("%s: expected OK got %s: %s", msg, r.GetCode(), r.GetMsg())
	}
}

func mustCode(t *testing.T, r apiResp, code, msg string) {
	t.Helper()
	if r.GetCode() != code {
		t.Fatalf("%s: expected %s got %s: %s", msg, code, r.GetCode(), r.GetMsg())
	}
}
