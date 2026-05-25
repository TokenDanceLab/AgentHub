package middleware

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func CORS() gin.HandlerFunc {
	raw := os.Getenv("AGENTHUB_CORS_ORIGINS")
	if raw == "" {
		raw = defaultCORSOrigins(corsEnvironment())
	}
	origins := splitAndTrim(raw)
	if err := validateCORSOriginsForEnvironment(corsEnvironment(), origins); err != nil {
		panic(err)
	}
	return cors.New(cors.Config{
		AllowOrigins:     origins,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "X-Request-ID"},
		ExposeHeaders:    []string{"X-Request-ID", "Retry-After", "X-API-Version"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	})
}

func defaultCORSOrigins(env string) string {
	if isProductionEnvironment(env) {
		return "https://hub.vectorcontrol.tech"
	}
	return "https://hub.vectorcontrol.tech,http://localhost:3000"
}

func corsEnvironment() string {
	if env := strings.TrimSpace(os.Getenv("AGENTHUB_ENV")); env != "" {
		return env
	}
	return os.Getenv("GIN_MODE")
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
