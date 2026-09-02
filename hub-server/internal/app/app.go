package app

import (
	"context"
	"net"
	"net/http"
	"runtime/debug"
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
	"github.com/agenthub/hub-server/internal/service/agent"
	"github.com/agenthub/hub-server/internal/service/agentcontrol"
	"github.com/agenthub/hub-server/internal/service/agentteam"
	"github.com/agenthub/hub-server/internal/service/attachment"
	"github.com/agenthub/hub-server/internal/service/audit"
	"github.com/agenthub/hub-server/internal/service/auth"
	"github.com/agenthub/hub-server/internal/service/contact"
	"github.com/agenthub/hub-server/internal/service/device"
	"github.com/agenthub/hub-server/internal/service/document"
	"github.com/agenthub/hub-server/internal/service/message"
	"github.com/agenthub/hub-server/internal/service/messagereaction"
	"github.com/agenthub/hub-server/internal/service/notification"
	"github.com/agenthub/hub-server/internal/service/oidc"
	"github.com/agenthub/hub-server/internal/service/relay"
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

	// Version is the build version this instance reports on /health,
	// /health/live and the admin endpoint. New resolves it once per App from the
	// package-level Version symbol (the one -ldflags -X writes to) with VCS
	// stamping and "dev" fallbacks, so it is never empty.
	Version string

	// Service layer
	AuthService            *auth.Service
	ContactService         *contact.Service
	SessionService         *session.Service
	MessageService         *message.Service
	MessageReactionService *messagereaction.Service
	AgentService           *agent.Service
	AgentControlService    *agentcontrol.Service
	AttachmentService      *attachment.Service
	NotificationService    *notification.Service
	DeviceService          *device.Service
	DocumentService        *document.Service

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
	RelayService *relay.Service
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
		Version:     resolveVersion(Version),
		bg:          newBackgroundGroup(context.Background()),
	}
}

// Version carries the build version stamped into the binary at link time:
//
//	go build -ldflags "-X github.com/agenthub/hub-server/internal/app.Version=v0.6.1"
//
// This is a package-level string variable because that is the only thing the Go
// linker can assign to: while the version lived solely as the App.Version struct
// field, no -X flag could ever reach it, so every build — release, CI, local —
// reported "dev" and an incident could not be traced back to a commit.
//
// Write-once by contract: the linker sets it before main runs and nothing in
// this package assigns to it afterwards. Resolution is a pure function of its
// argument (resolveVersion), so tests pass explicit values instead of mutating
// package state and parallel tests cannot pollute each other.
var Version string

// versionFallback is reported when neither -X nor VCS stamping produced a value.
const versionFallback = "dev"

// shortRevisionLen is the vcs.revision prefix reported when a build carries no
// tag: long enough to stay unique, short enough to read inside a JSON payload.
const shortRevisionLen = 12

// resolveVersion picks the version to report, most specific first: an explicit
// value (link-time -X, or one supplied by a caller), then the VCS stamping the
// go command embeds in module builds, then versionFallback.
//
// It never returns an empty string. An empty version is worse than "dev": it
// vanishes from JSON payloads, so an operator cannot even tell that the field
// was meant to carry a build identity.
//
// Honest limit: in a git *linked worktree* the stamping track can name the wrong
// commit — cmd/go/internal/vcs/vcs.go requires the root marker to satisfy
// {filename: ".git", isDir: true} via isVCSRoot()'s fi.IsDir() check, but a
// worktree's .git is a *file*, so go stamps the main checkout's HEAD (measured:
// worktree HEAD 106e9819 → e77808bf, vcs.modified false while dirty). Trust it
// only for clones / CI checkouts; in a worktree inject -X …app.Version=
// $(git rev-parse --short=12 HEAD); a plausible wrong commit misleads worse than "dev".
func resolveVersion(explicit string) string {
	if v := strings.TrimSpace(explicit); v != "" {
		return v
	}
	if v := buildInfoVersion(); v != "" {
		return v
	}
	return versionFallback
}

// buildInfoVersion reads the VCS stamping the go command embeds in every module
// build made inside a VCS tree: vcs.version when the checkout sits on a tag,
// otherwise the short vcs.revision, suffixed "-dirty" when the tree had
// uncommitted changes. This is the fallback that keeps ordinary-clone builds
// honest when whoever built the binary forgot to pass -X — a plain
// `docker build` from a real checkout included. It does NOT cover linked
// worktrees: see the "Honest limit" paragraph on resolveVersion, where the
// same stamping names the main checkout's commit instead of the worktree's.
//
// It returns "" only when the binary carries no stamping at all, which is what
// makes resolveVersion fall back instead of reporting an empty version.
func buildInfoVersion() string {
	info, ok := debug.ReadBuildInfo()
	if !ok || info == nil {
		return ""
	}

	settings := make(map[string]string, len(info.Settings))
	for _, setting := range info.Settings {
		settings[setting.Key] = setting.Value
	}

	version := settings["vcs.version"]
	if version == "" {
		version = settings["vcs.revision"]
		if len(version) > shortRevisionLen {
			version = version[:shortRevisionLen]
		}
	}
	if version == "" {
		return ""
	}
	if settings["vcs.modified"] == "true" {
		version += "-dirty"
	}
	return version
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
