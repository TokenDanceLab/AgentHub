package httpserver

import (
	"github.com/agenthub/edge-server/internal/api"
	debugpkg "github.com/agenthub/pkg/debug"
)

func edgeConfigDumper(cfg Config) debugpkg.ConfigDumper {
	return func() map[string]any {
		return map[string]any{
			"addr":                cfg.Addr,
			"remote_mode":         cfg.RemoteMode,
			"allowed_origins":     cfg.AllowedOrigins,
			"dev":                 cfg.Dev,
			"workspace_allowlist": cfg.WorkspaceAllowlist,
			"hub_url":             cfg.HubURL,
			"local_auth_token":    redactSecret(cfg.LocalAuthToken),
			"hub_jwt_secret":      redactSecret(cfg.HubJWTSecret),
			"hub_token":           redactSecret(cfg.HubToken),
		}
	}
}

func redactSecret(secret string) string {
	if secret == "" {
		return ""
	}
	return "[REDACTED]"
}

func edgeStateDumper(h *api.Handler) debugpkg.StateDumper {
	return func() map[string]any {
		state := map[string]any{}
		if h.Store != nil {
			state["store"] = map[string]any{
				"projects": len(h.Store.ListProjects()),
			}
		}
		if h.Bus != nil {
			state["bus"] = map[string]any{
				"history_len": h.Bus.HistoryLen(),
			}
		}
		return state
	}
}
