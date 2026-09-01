package config

import (
	"log/slog"
	"os"
	"strconv"
	"strings"
)

// Residual pure-helper peel #1134: env parse helpers and rate-limit fail-open.

// parseJWTSecrets parses the AGENTHUB_JWT_SECRETS env var value.
// Format: "kid1:secret1,kid2:secret2"
// The first ':' in each pair separates the kid from the secret.
// Returns the secrets map and the first kid (as default active).
func parseJWTSecrets(value string) (map[string]string, string) {
	pairs := strings.Split(value, ",")
	result := make(map[string]string, len(pairs))
	var firstKID string
	for _, pair := range pairs {
		pair = strings.TrimSpace(pair)
		if pair == "" {
			continue
		}
		// Split on first ':' only — secrets may contain colons.
		idx := strings.Index(pair, ":")
		if idx < 0 {
			continue
		}
		kid := strings.TrimSpace(pair[:idx])
		secret := pair[idx+1:] // preserve all chars after first ':'
		if kid == "" || secret == "" {
			continue
		}
		result[kid] = secret
		if firstKID == "" {
			firstKID = kid
		}
	}
	return result, firstKID
}

func firstEnv(names ...string) string {
	for _, name := range names {
		if value := os.Getenv(name); value != "" {
			return value
		}
	}
	return ""
}

func splitEnvList(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

// knownServerEnvs is the set of recognized AGENTHUB_ENV / server.env values.
var knownServerEnvs = map[string]bool{
	"production":  true,
	"prod":        true,
	"release":     true,
	"development": true,
	"dev":         true,
	"staging":     true,
	"test":        true,
	"debug":       true,
}

// validServerEnv reports whether env is a recognized environment name.
// The empty string is not validated here — it means "not explicitly set"
// and falls back to GIN_MODE at the call site.
func validServerEnv(env string) bool {
	return knownServerEnvs[strings.ToLower(strings.TrimSpace(env))]
}

// RateLimitFailOpen returns whether rate limiters should fail-open (allow requests)
// when Redis is unavailable for non-auth paths. Auth paths always fail-closed.
// Controlled by the AGENTHUB_RATE_LIMIT_FAIL_OPEN environment variable.
// Defaults to true when the variable is not set or not a recognized truthy value.
func RateLimitFailOpen() bool {
	switch strings.ToLower(os.Getenv("AGENTHUB_RATE_LIMIT_FAIL_OPEN")) {
	case "false", "0", "no", "off":
		return false
	default:
		return RateLimitFailOpenDefault // true
	}
}

// AuthFailClosed returns whether access-token blacklist checks must fail closed
// (reject the request) when the backing store (Redis) returns an error.
// Controlled by the AGENTHUB_AUTH_FAIL_CLOSED environment variable.
// Defaults to false when the variable is not set or not a recognized truthy
// value, preserving the historical fail-open behavior for backward
// compatibility. Operators hardening production set AGENTHUB_AUTH_FAIL_CLOSED=true
// so a Redis outage cannot let a revoked (logged-out) access JWT back in.
func AuthFailClosed() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("AGENTHUB_AUTH_FAIL_CLOSED"))) {
	case "true", "1", "yes", "on":
		return true
	default:
		return AuthFailClosedDefault // false
	}
}

// MaxCloudEdgeDevicesPerUser returns the per-user cap on cloud_edge device
// registrations enforced by the device service. Controlled by the
// AGENTHUB_MAX_CLOUD_EDGE_DEVICES environment variable; unset, empty, or
// unparsable values fall back to DefaultMaxCloudEdgeDevicesPerUser (with a
// warning log for unparsable values). A value <= 0 disables the cap.
func MaxCloudEdgeDevicesPerUser() int {
	value := strings.TrimSpace(os.Getenv("AGENTHUB_MAX_CLOUD_EDGE_DEVICES"))
	if value == "" {
		return DefaultMaxCloudEdgeDevicesPerUser
	}
	n, err := strconv.Atoi(value)
	if err != nil {
		slog.Warn("invalid AGENTHUB_MAX_CLOUD_EDGE_DEVICES, using default",
			"value", value, "default", DefaultMaxCloudEdgeDevicesPerUser)
		return DefaultMaxCloudEdgeDevicesPerUser
	}
	return n
}
