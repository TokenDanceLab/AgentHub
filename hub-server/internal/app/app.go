package app

import (
	"context"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/outboundhttp"
	"github.com/agenthub/hub-server/internal/service"
	"github.com/agenthub/hub-server/internal/service/agentteam"
	"github.com/agenthub/hub-server/internal/service/attachment"
	"github.com/agenthub/hub-server/internal/service/audit"
	"github.com/agenthub/hub-server/internal/service/contact"
	"github.com/agenthub/hub-server/internal/service/device"
	"github.com/agenthub/hub-server/internal/service/message"
	"github.com/agenthub/hub-server/internal/service/messagereaction"
	"github.com/agenthub/hub-server/internal/service/oidc"
	"github.com/agenthub/hub-server/internal/service/session"
	"github.com/agenthub/hub-server/internal/ws"
)

// App is the top-level DI container for the Hub Server.
// All dependencies are assembled here and passed to the components that need them.
type App struct {
	Config      *config.Config
	DB          *gorm.DB
	CacheClient *cache.Client
	HTTPServer  *http.Server
	AdminServer *http.Server

	// adminServeDone closes only after the admin Serve goroutine has exited and
	// its listener is no longer owned by net/http. Shutdown waits for it so a
	// successful return is a real lifecycle boundary, not only a signal.
	adminServeDone <-chan struct{}
	// adminListen is a narrow test seam; nil uses net.Listen in production.
	adminListen func(network, address string) (net.Listener, error)

	// Internal runtime state
	mgr       *ws.Manager
	bus       *bus.Bus
	startTime time.Time

	// Version is the build version, settable via -ldflags. Defaults to "dev".
	Version string

	// Service layer
	AuthService            *service.AuthService
	ContactService         *contact.Service
	SessionService         *session.Service
	MessageService         *message.Service
	MessageReactionService *messagereaction.Service
	AgentService           *service.AgentService
	AgentControlService    *service.AgentControlService
	AttachmentService      *attachment.Service
	NotificationService    *service.NotificationService
	DeviceService          *device.Service
	DocumentService        *service.DocumentService

	// OIDC (optional — only when TokenDance ID is configured)
	OIDCService *oidc.Service
	OIDCHandler *handler.OIDCHandler

	// Handler layer
	AuthHandler            *handler.AuthHandler
	WebSocketHandler       *handler.WebSocketHandler
	DeviceHandler          *handler.DeviceHandler
	ContactHandler         *handler.ContactHandler
	SessionHandler         *handler.SessionHandler
	MessageHandler         *handler.MessageHandler
	AgentHandler           *handler.AgentHandler
	CustomAgentHandler     *handler.CustomAgentHandler
	AttachmentHandler      *handler.AttachmentHandler
	NotificationHandler    *handler.NotificationHandler
	HealthHandler          *handler.HealthHandler
	PublicHandler          *handler.PublicHandler
	AgentProfileHandler    *handler.AgentProfileHandler
	SkillHandler           *handler.SkillHandler
	MCPServerHandler       *handler.MCPServerHandler
	MarketHandler          *handler.MarketHandler
	ProviderBindingHandler *handler.ProviderBindingHandler
	ExecutionTargetHandler *handler.ExecutionTargetHandler
	WorkspaceHandler       *handler.WorkspaceHandler
	AuditHandler           *handler.AuditHandler
	AgentTeamHandler       *handler.AgentTeamHandler
	DocumentHandler        *handler.DocumentHandler

	// AgentTeam
	AgentTeamService *agentteam.AgentTeamService

	// Relay
	RelayService *service.RelayService
	RelayHandler *handler.RelayHandler

	// Audit
	AuditService *audit.Service

	// Settings
	UserSettingsHandler *handler.UserSettingsHandler

	// Goroutine lifecycle (#1542)
	bg           *BackgroundGroup
	shutdownOnce sync.Once
	shutdownErr  error
}

// New creates a new App with the given infrastructure dependencies.
// cfg, db, and cacheClient are expected to be fully initialized by the caller.
func New(cfg *config.Config, db *gorm.DB, cacheClient *cache.Client) *App {
	return &App{
		Config:      cfg,
		DB:          db,
		CacheClient: cacheClient,
		bg:          newBackgroundGroup(context.Background()),
	}
}

// tdVerifier returns the instance-owned TokenDance ID JWKS verifier (#1551),
// constructed from config — never a process-global. The transport/cache
// policy (client, timeout, body cap) is injected from config (#1564). nil
// when TokenDance ID is not configured (the auth middleware skips the RS256
// path).
func (a *App) tdVerifier() *jwtutil.TokenDanceVerifier {
	jwksURI := a.Config.TokenDanceID.JWKSURI
	if jwksURI == "" && a.Config.TokenDanceID.IssuerURL != "" {
		jwksURI = strings.TrimRight(a.Config.TokenDanceID.IssuerURL, "/") + "/oidc/jwks"
	}
	if jwksURI == "" {
		return nil
	}
	return jwtutil.NewTokenDanceVerifier(jwksURI, jwtutil.VerifierConfig{
		HTTPClient:   outboundhttp.NewClient(a.Config.TokenDanceID.HTTPTimeout),
		MaxBodyBytes: a.Config.TokenDanceID.MaxResponseBodyBytes,
	})
}

// auditPermissionDecision adapts audit.Service.RecordPermissionDecision for
// the AuthMiddleware permission-audit callback (#1551). No-op when the audit
// service is not yet constructed.
func (a *App) auditPermissionDecision(ctx context.Context, userID string, decision string, allowed bool, details map[string]interface{}, clientIP string) {
	if a.AuditService == nil {
		return
	}
	a.AuditService.RecordPermissionDecision(ctx, userID, decision, allowed, details, clientIP)
}
