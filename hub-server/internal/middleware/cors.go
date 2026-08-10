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
		// Product hub (same-origin) + legacy host during cutover + Tauri
		return "https://hub.tokendancelab.com,https://hub.vectorcontrol.tech,https://tauri.localhost"
	}
	// Dev: product hub + local Vite + Tauri Desktop
	return "https://hub.tokendancelab.com,https://hub.vectorcontrol.tech,http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,https://tauri.localhost"
}

func validateCORSOriginsForEnvironment(env string, origins []string) error {
	if !isProductionEnvironment(env) {
		return nil
	}
	for _, origin := range origins {
		if isLoopbackOrigin(origin) {
			return fmt.Errorf("production CORS origin must not be loopback or localhost: %s", origin)
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
