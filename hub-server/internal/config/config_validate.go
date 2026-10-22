package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"slices"
	"strings"
)

// Domain validators for Config.Validate (#1568). Each section keeps its own
// small validator so the overall Validate glue stays a linear error chain.

func (c *Config) validateServerEnv() error {
	// Server: validate env value when explicitly set.
	if c.Server.Env != "" && !validServerEnv(c.Server.Env) {
		return fmt.Errorf("server.env has unknown value %q; accepted: production, prod, release, development, dev, staging, test, debug", c.Server.Env)
	}
	return nil
}

func (c *Config) validateDB() error {
	// DB: host and port must be plausible.
	if c.DB.Host == "" {
		return errors.New("db.host is required")
	}
	if c.DB.Port <= 0 || c.DB.Port > 65535 {
		return fmt.Errorf("db.port is invalid: %d", c.DB.Port)
	}
	if c.DB.User == "" {
		return errors.New("db.user is required")
	}
	if c.DB.Name == "" {
		return errors.New("db.name is required")
	}
	if c.DB.MaxOpenConns < 1 {
		return fmt.Errorf("db.max_open_conns must be positive; got %d", c.DB.MaxOpenConns)
	}
	if c.DB.MaxIdleConns < 0 || c.DB.MaxIdleConns > c.DB.MaxOpenConns {
		return fmt.Errorf("db.max_idle_conns must be between 0 and max_open_conns; got %d", c.DB.MaxIdleConns)
	}
	if c.DB.ConnMaxLifetime <= 0 {
		return fmt.Errorf("db.conn_max_lifetime must be positive; got %s", c.DB.ConnMaxLifetime)
	}
	if c.DB.ConnMaxIdleTime <= 0 {
		return fmt.Errorf("db.conn_max_idle_time must be positive; got %s", c.DB.ConnMaxIdleTime)
	}
	if strings.ContainsAny(c.DB.ApplicationName, " \t\r\n'\\") {
		return fmt.Errorf("db.application_name contains unsupported characters")
	}
	validSSL := map[string]bool{"disable": true, "require": true, "verify-ca": true, "verify-full": true}
	if c.DB.SSLMode != "" && !validSSL[c.DB.SSLMode] {
		return fmt.Errorf("db.sslmode must be one of disable, require, verify-ca, verify-full; got %q", c.DB.SSLMode)
	}
	return nil
}

func (c *Config) validateRedis() error {
	// Redis: host and port must be plausible.
	if c.Redis.Host == "" {
		return errors.New("redis.host is required")
	}
	if c.Redis.Port <= 0 || c.Redis.Port > 65535 {
		return fmt.Errorf("redis.port is invalid: %d", c.Redis.Port)
	}
	return nil
}

// knownHardcodedSecrets is the exact-match blocklist for short or trivially
// weak secrets. Prefix matching via weakSecretPrefixes catches the whole
// dev-secret-change-in-production* and change-me-production* families
// (including the documented .env.example values
// dev-secret-change-in-production-min-length-32 and
// change-me-production-min-length-32-chars, both 41 chars and long enough
// to pass the 32-char minimum length gate).
var knownHardcodedSecrets = []string{
	"",
	"dev-secret",
	"test-secret",
	"my-secret-key",
	"changeme",
	"secret",
	"default",
	"password",
	"1234567890123456",
	"aaaaaaaaaaaaaaaa",
	"agenthub-dev-secret-change-me",
}

// weakSecretPrefixes blocks the publicly-documented placeholder families.
// Any secret starting with one of these prefixes is treated as a known
// weak value regardless of length, so documented placeholders that are long
// enough to pass the 32-char minimum cannot bypass the length gate.
//
//   - "dev-secret-change-in-production": the documented dev placeholder
//     family (e.g. dev-secret-change-in-production-min-length-32, 41 chars).
//   - "change-me-production": the production .env.example placeholder
//     family (e.g. change-me-production-min-length-32-chars, 41 chars).
//     Both PG_PASSWORD and JWT_SECRET in .env.example used this prefix; the
//     JWT variant was long enough to pass the length gate before this entry.
//   - "agenthub-dev-secret": the seed SQL OIDC client_secret family
//     (agenthub-dev-secret-change-me and derivatives).
var weakSecretPrefixes = []string{
	"dev-secret-change-in-production",
	"change-me-production",
	"agenthub-dev-secret",
}

// isKnownWeakSecret reports whether the given secret is a hardcoded default
// or a publicly-documented placeholder. It uses prefix matching for the
// documented families and exact matching for the remaining blocklist, so
// derivatives of the documented secrets (e.g. with a suffix bolted on to
// satisfy the 32-char minimum) are still rejected.
func isKnownWeakSecret(secret string) bool {
	for _, prefix := range weakSecretPrefixes {
		if strings.HasPrefix(secret, prefix) {
			return true
		}
	}
	return slices.Contains(knownHardcodedSecrets, secret)
}

func (c *Config) validateJWT() error {
	// JWT: reject hardcoded defaults and known weak development secrets.
	// In production (default), any known hardcoded value is fatal.
	// In dev/test environments these are allowed for convenience.
	if isKnownWeakSecret(c.JWT.Secret) {
		// Also check the env-var value against the weak-secret check to
		// prevent bypass by setting AGENTHUB_JWT_SECRET to the same weak
		// value (covers the .env.example documented dev placeholder).
		envSecret := os.Getenv("AGENTHUB_JWT_SECRET")
		if envSecret == "" || isKnownWeakSecret(envSecret) {
			return errors.New("JWT secret must be set via AGENTHUB_JWT_SECRET environment variable with a strong, non-default value; hardcoded defaults and documented dev placeholders are rejected")
		}
	}

	// JWT: enforce minimum length (32 chars = 256 bits for HS256).
	if len(c.JWT.Secret) < 32 {
		return fmt.Errorf("JWT secret too short: minimum 32 characters required (got %d)", len(c.JWT.Secret))
	}

	// JWT: validate multi-key configuration when AGENTHUB_JWT_SECRETS is set.
	if len(c.JWT.Secrets) > 0 {
		if c.JWT.ActiveKeyID == "" {
			return fmt.Errorf("jwt.active_key_id is required when multi-key JWT secrets are configured")
		}
		if _, ok := c.JWT.Secrets[c.JWT.ActiveKeyID]; !ok {
			return fmt.Errorf("jwt.active_key_id %q not found in configured secrets", c.JWT.ActiveKeyID)
		}
		// Validate all secrets meet minimum length.
		for kid, secret := range c.JWT.Secrets {
			if len(secret) < 32 {
				return fmt.Errorf("JWT secret for key %q too short: minimum 32 characters required (got %d)", kid, len(secret))
			}
		}
	}
	return nil
}

func (c *Config) validateAccountOIDC() error {
	production := isProductionEnv(c.Server.Env)
	if err := rejectRetiredAccountProviderEnv(production); err != nil {
		return err
	}
	if !accountOIDCConfigured(c.AccountOIDC) {
		if production {
			return errors.New("account_oidc must be configured in production")
		}
		return nil
	}
	if err := validateAccountOIDCClient(c.AccountOIDC, production); err != nil {
		return err
	}
	return validateAccountOIDCRedirectURIs(c.AccountOIDC.RedirectURI, c.AccountOIDC.AllowedRedirectURIs)
}

func rejectRetiredAccountProviderEnv(production bool) error {
	if !production {
		return nil
	}
	for _, key := range os.Environ() {
		name, _, _ := strings.Cut(key, "=")
		if strings.HasPrefix(name, "AGENTHUB_TOKENDANCE_ID_") {
			return fmt.Errorf("retired %s must not be set in production; use AGENTHUB_ACCOUNT_OIDC_*", name)
		}
	}
	return nil
}

func accountOIDCConfigured(cfg AccountOIDCConfig) bool {
	return cfg.IssuerURL != "" ||
		cfg.ClientID != "" ||
		cfg.ClientSecret != "" ||
		cfg.RedirectURI != "" ||
		len(cfg.AllowedRedirectURIs) > 0
}

func validateAccountOIDCClient(cfg AccountOIDCConfig, production bool) error {
	if cfg.ClientID == "" {
		return errors.New("account_oidc.client_id is required when any Account OIDC field is set")
	}
	if cfg.IssuerURL == "" {
		return errors.New("account_oidc.issuer_url is required when account_oidc.client_id is set")
	}
	if err := validateAccountOIDCIssuer(cfg.IssuerURL, production); err != nil {
		return err
	}
	if cfg.ClientSecret == "" {
		return errors.New("account_oidc.client_secret is required when account_oidc.client_id is set")
	}
	if len(cfg.ClientSecret) < 32 {
		return fmt.Errorf("account_oidc.client_secret too short: minimum 32 characters required (got %d)", len(cfg.ClientSecret))
	}
	if isKnownWeakSecret(cfg.ClientSecret) {
		return errors.New("account_oidc.client_secret must be a strong, non-default value; documented placeholders are rejected")
	}
	if cfg.RedirectURI == "" {
		return errors.New("account_oidc.redirect_uri is required when account_oidc.client_id is set")
	}
	return nil
}

func validateAccountOIDCIssuer(rawURL string, production bool) error {
	issuer, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || issuer.Scheme == "" || issuer.Host == "" || issuer.User != nil || issuer.RawQuery != "" || issuer.Fragment != "" {
		return errors.New("account_oidc.issuer_url must be an absolute issuer URL without credentials, query or fragment")
	}
	if !isHTTPSOrLoopbackHTTP(issuer.Scheme, issuer.Hostname()) {
		return errors.New("account_oidc.issuer_url must use https outside loopback development")
	}
	if production && isNonPublicIssuerHostname(issuer.Hostname()) {
		return errors.New("account_oidc.issuer_url must be a public host in production")
	}
	return nil
}

func validateAccountOIDCRedirectURIs(primary string, additional []string) error {
	allowed := append([]string{primary}, additional...)
	seen := make(map[string]struct{}, len(allowed))
	for _, raw := range allowed {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		u, parseErr := url.Parse(raw)
		if parseErr != nil || u.Scheme == "" || u.Host == "" || u.User != nil || u.Fragment != "" {
			return fmt.Errorf("account_oidc redirect URI is invalid: %q", raw)
		}
		if !isHTTPSOrLoopbackHTTP(u.Scheme, u.Hostname()) {
			return fmt.Errorf("account_oidc redirect URI must use https outside loopback: %q", raw)
		}
		normalized := u.String()
		if _, exists := seen[normalized]; exists {
			return fmt.Errorf("account_oidc redirect URI is duplicated: %q", raw)
		}
		seen[normalized] = struct{}{}
	}
	return nil
}

func isLoopbackHostname(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func isHTTPSOrLoopbackHTTP(scheme, host string) bool {
	return scheme == "https" || (scheme == "http" && isLoopbackHostname(host))
}

func isNonPublicIssuerHostname(host string) bool {
	host = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
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

// isProductionEnv reports whether the given server.env value denotes a
// production deployment. The comparison is case-insensitive and tolerates
// surrounding whitespace so operators cannot accidentally bypass the guard
// with "Production" or " prod ". Empty string is NOT production — that is
// the unset/dev default and must remain zero-friction.
func isProductionEnv(env string) bool {
	switch strings.ToLower(strings.TrimSpace(env)) {
	case "production", "prod", "release":
		return true
	}
	return false
}

// validateProdGuard enforces #2124 production hardening: when running in
// production (server.env ∈ {production, prod, release}), safety-critical
// settings MUST be explicitly configured. Dev/test environments are
// unaffected so local development stays zero-friction.
//
// Checks:
//  1. AGENTHUB_AUTH_FAIL_CLOSED must be explicitly set (any value). Without
//     it the auth middleware fails open on Redis errors, letting revoked JWTs
//     back in after logout.
//  2. db.sslmode must not be "disable". Plaintext DB traffic in production
//     exposes credentials and query data to network observers.
//  3. Rate-limit fail-open is warned (not rejected) because blocking startup
//     on this knob has historically caused unnecessary outages; the warning
//     makes the risk visible in production logs.
func (c *Config) validateProdGuard() error {
	if !isProductionEnv(c.Server.Env) {
		return nil
	}

	// 1. AUTH_FAIL_CLOSED must be explicitly set.
	if _, ok := os.LookupEnv("AGENTHUB_AUTH_FAIL_CLOSED"); !ok {
		return errors.New("production environment requires AGENTHUB_AUTH_FAIL_CLOSED to be explicitly set (true recommended); without it, auth fails open on Redis errors and revoked JWTs may be accepted — set AGENTHUB_AUTH_FAIL_CLOSED=true to harden")
	}

	// 2. db.sslmode must not be disable.
	if strings.ToLower(strings.TrimSpace(c.DB.SSLMode)) == "disable" {
		return errors.New("production environment forbids db.sslmode=disable; use require, verify-ca, or verify-full to encrypt database traffic")
	}

	// 3. Rate-limit fail-open: warn but do not block.
	if RateLimitFailOpen() {
		slog.Warn("production environment: rate limiter is fail-open (AGENTHUB_RATE_LIMIT_FAIL_OPEN defaults to true); non-auth API requests will be allowed through during Redis outages — set AGENTHUB_RATE_LIMIT_FAIL_OPEN=false to fail closed")
	}

	return nil
}
