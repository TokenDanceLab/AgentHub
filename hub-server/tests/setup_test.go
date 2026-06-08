package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/log"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/router"
	"github.com/agenthub/hub-server/internal/service"
	"github.com/agenthub/hub-server/internal/ws"
)

var (
	ts              *httptest.Server
	client          *http.Client
	mgr             *ws.Manager
	bus             *service.Bus
	db              *gorm.DB // hold reference for cleanDB
	testCacheClient *cache.Client
	testJWT         config.JWTConfig
)

type testMessageServiceWithReactions struct {
	*service.MessageService
	reactions *service.MessageReactionService
}

func (s testMessageServiceWithReactions) AddMessageReaction(ctx context.Context, userID, sessionID, msgID, reaction string) (*service.MessageReactionResponse, error) {
	return s.reactions.AddMessageReaction(ctx, userID, sessionID, msgID, reaction)
}

func (s testMessageServiceWithReactions) RemoveMessageReaction(ctx context.Context, userID, sessionID, msgID, reaction string) (*service.MessageReactionResponse, error) {
	return s.reactions.RemoveMessageReaction(ctx, userID, sessionID, msgID, reaction)
}

func (s testMessageServiceWithReactions) ListMessageReactions(ctx context.Context, userID, sessionID, msgID string) ([]service.MessageReactionResponse, error) {
	return s.reactions.ListMessageReactions(ctx, userID, sessionID, msgID)
}

func TestMain(m *testing.M) {
	flag.Parse()
	if testing.Short() {
		os.Exit(0)
	}

	gin.SetMode(gin.TestMode)
	metrics.Register()

	cfg, err := config.Load("../configs/config.yaml")
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
	if err := repository.RunMigrationsFrom(&cfg.DB, "file://../migrations"); err != nil {
		panic(fmt.Sprintf("failed to run migrations: %v", err))
	}
	rdb, err := cache.InitRedis(&cfg.Redis)
	if err != nil {
		panic(fmt.Sprintf("failed to init redis: %v", err))
	}
	cacheClient := cache.NewClient(rdb)
	testCacheClient = cacheClient

	mgr = ws.NewManager()
	mgr.StartHeartbeat()

	bus = service.NewBus()
	wsHandler := handler.NewWebSocketHandler(mgr, cfg.JWT.Secret)
	authService := service.NewAuthService(db, cfg.JWT, cacheClient)
	authHandler := handler.NewAuthHandler(authService)
	deviceService := service.NewDeviceService(db)
	deviceHandler := handler.NewDeviceHandler(deviceService)
	contactService := service.NewContactService(db, bus, cacheClient)
	contactHandler := handler.NewContactHandler(contactService)
	sessionService := service.NewSessionService(db, cacheClient)
	sessionHandler := handler.NewSessionHandler(sessionService)
	messageService := service.NewMessageService(db, bus, cacheClient)
	messageReactionService := service.NewMessageReactionService(db, bus)
	messageHandler := handler.NewMessageHandler(testMessageServiceWithReactions{
		MessageService: messageService,
		reactions:      messageReactionService,
	})
	agentService := service.NewAgentService(db, bus, mgr, cacheClient)
	agentHandler := handler.NewAgentHandler(agentService)
	customAgentHandler := handler.NewCustomAgentHandler(agentService)
	attachmentService := service.NewAttachmentService(db, cfg.Upload, service.NewLocalStorage(cfg.Upload.Dir))
	attachmentHandler := handler.NewAttachmentHandler(attachmentService)
	notificationService := service.NewNotificationService(db, mgr)
	notificationHandler := handler.NewNotificationHandler(notificationService)
	healthHandler := handler.NewHealthHandler(db, cacheClient, &cfg.DB, time.Now(), "test")
	publicHandler := handler.NewPublicHandler(db, time.Now())

	// Phase 1-7 handlers
	oidcService := service.NewOIDCService(db, cfg.TokenDanceID, cfg.JWT, cacheClient)
	oidcHandler := handler.NewOIDCHandler(oidcService)
	profileService := service.NewAgentProfileService(db)
	agentProfileHandler := handler.NewAgentProfileHandler(profileService)
	skillService := service.NewSkillService(db)
	skillHandler := handler.NewSkillHandler(skillService)
	mcpService := service.NewMCPService(db)
	mcpHandler := handler.NewMCPServerHandler(mcpService)
	marketHandler := handler.NewMarketHandler(profileService) // uses AgentProfileService
	pbService := service.NewProviderBindingService(db)
	pbHandler := handler.NewProviderBindingHandler(pbService)
	targetService := service.NewExecutionTargetService(db)
	targetHandler := handler.NewExecutionTargetHandler(targetService)
	auditService := service.NewAuditService(db, nil)
	auditHandler := handler.NewAuditHandler(auditService)
	relayService := service.NewRelayService(cacheClient, mgr)
	relayHandler := handler.NewRelayHandler(relayService)
	agentTeamService := service.NewAgentTeamService(db, agentService, cacheClient)
	agentTeamHandler := handler.NewAgentTeamHandler(agentTeamService)

	r := gin.New()
	r.Use(gin.Recovery())
	router.SetupRoutes(r, cfg, cfg.JWT.Secret, cacheClient, authHandler, wsHandler, deviceHandler, contactHandler, sessionHandler, messageHandler, agentHandler, customAgentHandler, attachmentHandler, notificationHandler, healthHandler, publicHandler, oidcHandler, agentProfileHandler, skillHandler, mcpHandler, marketHandler, pbHandler, targetHandler, auditHandler, relayHandler, agentTeamHandler)

	ts = httptest.NewServer(r)
	client = ts.Client()

	cleanDBTables(db)
	if err := clearRateLimitKeys(); err != nil {
		panic(fmt.Sprintf("failed to clear test rate limits: %v", err))
	}

	os.Exit(m.Run())
}

// CleanDB truncates all tables between tests for isolation.
// Tables are deleted in FK-safe order (children before parents).
func CleanDB(t *testing.T, db *gorm.DB) {
	t.Helper()
	cleanDBTables(db)
	if err := clearRateLimitKeys(); err != nil {
		t.Fatalf("clear test rate limits: %v", err)
	}
}

func cleanDBTables(database *gorm.DB) {
	database.Exec("DELETE FROM message_attachments")
	database.Exec("DELETE FROM message_pins")
	database.Exec("DELETE FROM message_reads")
	database.Exec("DELETE FROM pending_agent_tasks")
	database.Exec("DELETE FROM agent_instances")
	database.Exec("DELETE FROM messages")
	database.Exec("DELETE FROM session_members")
	database.Exec("DELETE FROM sessions")
	database.Exec("DELETE FROM notifications")
	database.Exec("DELETE FROM friendships")
	database.Exec("DELETE FROM attachments")
	database.Exec("DELETE FROM custom_agents")
	database.Exec("DELETE FROM workspaces")
	deleteAuditEvents(database)
	database.Exec("DELETE FROM provider_bindings")
	database.Exec("DELETE FROM mcp_servers")
	database.Exec("DELETE FROM skills")
	database.Exec("DELETE FROM execution_targets")
	database.Exec("DELETE FROM agent_profiles")
	database.Exec("DELETE FROM refresh_tokens")
	database.Exec("DELETE FROM devices")
	database.Exec("DELETE FROM users")
}

func deleteAuditEvents(database *gorm.DB) {
	if database.Dialector.Name() != "postgres" {
		database.Exec("DELETE FROM audit_events")
		return
	}

	if err := database.Exec("ALTER TABLE audit_events DISABLE TRIGGER USER").Error; err != nil {
		database.Exec("DELETE FROM audit_events")
		return
	}
	defer database.Exec("ALTER TABLE audit_events ENABLE TRIGGER USER")

	database.Exec("DELETE FROM audit_events")
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

type apiResp struct {
	Code    string          `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
	Error   *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		TraceID string `json:"traceId"`
	} `json:"error"`
}

// GetCode returns the response code from either success or error envelope.
func (r apiResp) GetCode() string {
	if r.Error != nil {
		return r.Error.Code
	}
	return r.Code
}

// GetMsg returns the message from either success or error envelope.
func (r apiResp) GetMsg() string {
	if r.Error != nil {
		return r.Error.Message
	}
	return r.Message
}

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
	token, err := jwtutil.GenerateAccessToken(user.ID, "web", deviceID, testJWT.Secret, testJWT.AccessTTL)
	if err != nil {
		t.Fatalf("generate token for %s: %v", username, err)
	}

	return testUser{Username: username, Password: password, Token: token, ID: user.ID}
}

func TestSetupRegisterCreatesHubSession(t *testing.T) {
	CleanDB(t, db)

	u := register(t, "tsetup_user", "pass1234", "SetupUser")

	w := get("/client/auth/me", u.Token)
	r := parse(w)
	if r.GetCode() != "OK" {
		t.Fatalf("me %s failed: %s", u.Username, r.GetCode())
	}
	id := extract(r.Data, "id")
	if id != u.ID {
		t.Fatalf("me returned id %s, want %s", id, u.ID)
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
	if r.GetCode() != "OK" {
		t.Fatalf("%s: expected OK got %s: %s", msg, r.GetCode(), r.GetMsg())
	}
}

func mustCode(t *testing.T, r apiResp, code, msg string) {
	t.Helper()
	if r.GetCode() != code {
		t.Fatalf("%s: expected %s got %s: %s", msg, code, r.GetCode(), r.GetMsg())
	}
}
