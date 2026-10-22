package middleware

import (
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func CORS(env string) (gin.HandlerFunc, error) {
	resolvedEnv := resolveCORSEnv(env)
	raw := os.Getenv("AGENTHUB_CORS_ORIGINS")
	if raw == "" {
		raw = defaultCORSOrigins(resolvedEnv)
	}
	origins := splitAndTrim(raw)
	if err := validateCORSOriginsForEnvironment(resolvedEnv, origins); err != nil {
		slog.Error("invalid CORS configuration", "error", err)
		return nil, fmt.Errorf("CORS configuration error: %w", err)
	}
	return cors.New(cors.Config{
		AllowOrigins:     origins,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Content-Type", "Authorization", "X-Request-ID"},
		ExposeHeaders:    []string{"X-Request-ID", "Retry-After", "X-API-Version"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
	}), nil
}

// resolveCORSEnv returns the effective environment for CORS decisions.
// It uses the config-managed env when set; otherwise falls back to GIN_MODE.
func resolveCORSEnv(env string) string {
	if env != "" {
		return env
	}
	return os.Getenv("GIN_MODE")
}

func defaultCORSOrigins(env string) string {
	if isProductionEnvironment(env) {
		// Tauri Desktop is the only known cross-origin caller by default.
		// Web deployments must list their own origins in AGENTHUB_CORS_ORIGINS.
		return "https://tauri.localhost"
	}
	// Dev: local Vite + Tauri Desktop.
	return "http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,https://tauri.localhost"
}

func validateCORSOriginsForEnvironment(env string, origins []string) error {
	production := isProductionEnvironment(env)
	seen := make(map[string]struct{}, len(origins))
	for _, raw := range origins {
		origin := strings.TrimSpace(raw)
		if origin == "" || origin == "*" {
			return fmt.Errorf("CORS origin must be an exact HTTP(S) origin, not wildcard or empty")
		}
		parsed, err := url.Parse(origin)
		if err != nil || parsed.Host == "" || parsed.User != nil ||
			(parsed.Scheme != "http" && parsed.Scheme != "https") ||
			parsed.Path != "" ||
			parsed.RawQuery != "" || parsed.Fragment != "" {
			return fmt.Errorf("CORS origin must be an exact HTTP(S) origin without credentials, path, query or fragment: %s", origin)
		}
		normalized := parsed.Scheme + "://" + parsed.Host
		if _, exists := seen[normalized]; exists {
			return fmt.Errorf("CORS origin is duplicated: %s", origin)
		}
		seen[normalized] = struct{}{}
		if production {
			if parsed.Scheme != "https" {
				return fmt.Errorf("production CORS origin must use https: %s", origin)
			}
			if isLoopbackOrigin(origin) || isPrivateOriginHost(parsed.Hostname()) {
				return fmt.Errorf("production CORS origin must be public and must not be loopback or private: %s", origin)
			}
		}
	}
	return nil
}

func isProductionEnvironment(env string) bool {
	switch strings.ToLower(strings.TrimSpace(env)) {
	case "production", "prod", "release":
		return true
	default:
		return false
	}
}

func isLoopbackOrigin(origin string) bool {
	u, err := url.Parse(strings.TrimSpace(origin))
	if err != nil {
		return false
	}
	host := u.Hostname()
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func isPrivateOriginHost(host string) bool {
	host = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
	// Tauri's packaged webview uses this reserved custom-protocol origin. It
	// does not resolve to a network service, so it is the one allowed
	// *.localhost origin in production.
	if host == "tauri.localhost" {
		return false
	}
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() ||
		ip.IsLinkLocalUnicast() || ip.IsUnspecified() || ip.IsMulticast()
}

func splitAndTrim(s string) []string {
	parts := strings.Split(s, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}
