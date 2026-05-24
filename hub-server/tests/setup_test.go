package tests

import (
	"bytes"
	"encoding/json"
<<<<<<< HEAD
=======
	"flag"
>>>>>>> origin/master
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
<<<<<<< HEAD

	"github.com/gin-gonic/gin"

	"github.com/agenthub/server-hub/internal/cache"
	"github.com/agenthub/server-hub/internal/config"
	"github.com/agenthub/server-hub/internal/handler"
	"github.com/agenthub/server-hub/internal/log"
	"github.com/agenthub/server-hub/internal/metrics"
	"github.com/agenthub/server-hub/internal/repository"
	"github.com/agenthub/server-hub/internal/router"
	"github.com/agenthub/server-hub/internal/service"
	"github.com/agenthub/server-hub/internal/ws"
=======
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/log"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/router"
	"github.com/agenthub/hub-server/internal/service"
	"github.com/agenthub/hub-server/internal/ws"
>>>>>>> origin/master
)

var (
	ts     *httptest.Server
	client *http.Client
	mgr    *ws.Manager
	bus    *service.Bus
<<<<<<< HEAD
)

func TestMain(m *testing.M) {
=======
	db     *gorm.DB // hold reference for cleanDB
)

func TestMain(m *testing.M) {
	flag.Parse()
	if testing.Short() {
		os.Exit(0)
	}

>>>>>>> origin/master
	gin.SetMode(gin.TestMode)
	metrics.Register()

	cfg, err := config.Load("../configs/config.yaml")
	if err != nil {
		panic(fmt.Sprintf("failed to load config: %v", err))
	}
	log.Init(&cfg.Server)

<<<<<<< HEAD
	if err := repository.InitDB(&cfg.DB); err != nil {
		panic(fmt.Sprintf("failed to init db: %v", err))
	}
	if err := repository.RunMigrationsFrom(&cfg.DB, "file://../migrations"); err != nil {
		panic(fmt.Sprintf("failed to run migrations: %v", err))
	}
	if err := cache.InitRedis(&cfg.Redis); err != nil {
		panic(fmt.Sprintf("failed to init redis: %v", err))
	}
=======
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
>>>>>>> origin/master

	mgr = ws.NewManager()
	mgr.StartHeartbeat()

	bus = service.NewBus()
	wsHandler := handler.NewWebSocketHandler(mgr, cfg.JWT.Secret)
<<<<<<< HEAD
	authService := service.NewAuthService(repository.DB)
	authHandler := handler.NewAuthHandler(authService)
	deviceHandler := handler.NewDeviceHandler(repository.DB)
	contactService := service.NewContactService(repository.DB, bus)
	contactHandler := handler.NewContactHandler(contactService)
	sessionService := service.NewSessionService(repository.DB)
	sessionHandler := handler.NewSessionHandler(sessionService)
	messageService := service.NewMessageService(repository.DB, bus)
	messageHandler := handler.NewMessageHandler(messageService)
	agentService := service.NewAgentService(repository.DB, bus, mgr)
	agentHandler := handler.NewAgentHandler(agentService)
	customAgentHandler := handler.NewCustomAgentHandler(agentService)
	attachmentService := service.NewAttachmentService(repository.DB)
	attachmentHandler := handler.NewAttachmentHandler(attachmentService)
	notificationService := service.NewNotificationService(repository.DB, mgr)
	notificationHandler := handler.NewNotificationHandler(notificationService)

	r := gin.New()
	r.Use(gin.Recovery())
	router.SetupRoutes(r, authHandler, wsHandler, deviceHandler, contactHandler, sessionHandler, messageHandler, agentHandler, customAgentHandler, attachmentHandler, notificationHandler)
=======
	authService := service.NewAuthService(db, cfg.JWT, cacheClient)
	authHandler := handler.NewAuthHandler(authService)
	deviceService := service.NewDeviceService(db)
	deviceHandler := handler.NewDeviceHandler(deviceService)
	contactService := service.NewContactService(db, bus, cacheClient)
	contactHandler := handler.NewContactHandler(contactService)
	sessionService := service.NewSessionService(db, cacheClient)
	sessionHandler := handler.NewSessionHandler(sessionService)
	messageService := service.NewMessageService(db, bus, cacheClient)
	messageHandler := handler.NewMessageHandler(messageService)
	agentService := service.NewAgentService(db, bus, mgr, cacheClient)
	agentHandler := handler.NewAgentHandler(agentService)
	customAgentHandler := handler.NewCustomAgentHandler(agentService)
	attachmentService := service.NewAttachmentService(db, cfg.Upload)
	attachmentHandler := handler.NewAttachmentHandler(attachmentService)
	notificationService := service.NewNotificationService(db, mgr)
	notificationHandler := handler.NewNotificationHandler(notificationService)
	healthHandler := handler.NewHealthHandler(db, cacheClient, &cfg.DB, time.Now(), "test")
	publicHandler := handler.NewPublicHandler(db, time.Now())

	r := gin.New()
	r.Use(gin.Recovery())
	router.SetupRoutes(r, cfg.JWT.Secret, cacheClient, authHandler, wsHandler, deviceHandler, contactHandler, sessionHandler, messageHandler, agentHandler, customAgentHandler, attachmentHandler, notificationHandler, healthHandler, publicHandler)
>>>>>>> origin/master

	ts = httptest.NewServer(r)
	client = ts.Client()

<<<<<<< HEAD
	cleanDB()
=======
	cleanDBTables(db)
>>>>>>> origin/master

	os.Exit(m.Run())
}

<<<<<<< HEAD
func cleanDB() {
	db := repository.DB
	db.Exec("DELETE FROM message_pins")
	db.Exec("DELETE FROM message_reads")
	db.Exec("DELETE FROM pending_agent_tasks")
	db.Exec("DELETE FROM agent_instances")
	db.Exec("DELETE FROM messages")
	db.Exec("DELETE FROM session_members")
	db.Exec("DELETE FROM sessions")
	db.Exec("DELETE FROM notifications")
	db.Exec("DELETE FROM friendships")
	db.Exec("DELETE FROM attachments")
	db.Exec("DELETE FROM custom_agents")
	db.Exec("DELETE FROM workspaces")
	db.Exec("DELETE FROM refresh_tokens")
	db.Exec("DELETE FROM devices")
	db.Exec("DELETE FROM users")
=======
// CleanDB truncates all tables between tests for isolation.
// Tables are deleted in FK-safe order (children before parents).
func CleanDB(t *testing.T, db *gorm.DB) {
	t.Helper()
	cleanDBTables(db)
}

func cleanDBTables(database *gorm.DB) {
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
	database.Exec("DELETE FROM refresh_tokens")
	database.Exec("DELETE FROM devices")
	database.Exec("DELETE FROM users")
>>>>>>> origin/master
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

	w := post("/client/auth/register", map[string]string{
		"username": username, "password": password, "nickname": nickname,
	})
	r := parse(w)
	if r.Code == "USER_USERNAME_TAKEN" {
		return loginAndGetUser(t, username, password)
	}
	if r.Code != "OK" {
		t.Fatalf("register %s failed: %s", username, r.Code)
	}
	return loginAndGetUser(t, username, password)
}

func loginAndGetUser(t *testing.T, username, password string) testUser {
	t.Helper()
	w := post("/client/auth/login", map[string]interface{}{
		"username": username, "password": password,
		"device_type": "web", "device_id": "dddddddd-dddd-dddd-dddd-dddddddddd01",
	})
	r := parse(w)
	if r.Code != "OK" {
		t.Fatalf("login %s failed: %s", username, r.Code)
	}
	tok := extract(r.Data, "access_token")

	w = get("/client/auth/me", tok)
	r = parse(w)
	if r.Code != "OK" {
		t.Fatalf("me %s failed: %s", username, r.Code)
	}
	id := extract(r.Data, "id")
	return testUser{Username: username, Password: password, Token: tok, ID: id}
}

func mustOK(t *testing.T, r apiResp, msg string) {
	t.Helper()
	if r.Code != "OK" {
		t.Fatalf("%s: expected OK got %s: %s", msg, r.Code, r.Message)
	}
}

func mustCode(t *testing.T, r apiResp, code, msg string) {
	t.Helper()
	if r.Code != code {
		t.Fatalf("%s: expected %s got %s: %s", msg, code, r.Code, r.Message)
	}
}
