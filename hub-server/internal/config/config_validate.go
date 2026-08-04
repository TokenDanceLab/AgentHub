package config

import (
	"errors"
	"fmt"
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

func (c *Config) validateJWT() error {
	// JWT: reject hardcoded defaults and known weak development secrets.
	// In production (default), any known hardcoded value is fatal.
	// In dev/test environments these are allowed for convenience.
	knownHardcodedSecrets := []string{
		"",
		"dev-secret-change-in-production",
		"dev-secret",
		"test-secret",
		"my-secret-key",
		"changeme",
		"secret",
		"default",
		"password",
		"1234567890123456",
		"aaaaaaaaaaaaaaaa",
	}
	if slices.Contains(knownHardcodedSecrets, c.JWT.Secret) {
		// Also check the env-var value against the blocklist to prevent
		// bypass by setting AGENTHUB_JWT_SECRET to the same weak value.
		envSecret := os.Getenv("AGENTHUB_JWT_SECRET")
		if envSecret == "" || slices.Contains(knownHardcodedSecrets, envSecret) {
			return errors.New("JWT secret must be set via AGENTHUB_JWT_SECRET environment variable with a strong, non-default value; hardcoded defaults are rejected")
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

func (c *Config) validateTokenDanceID() error {
	// TokenDance ID config is optional; validate only when explicitly configured
	if c.TokenDanceID.ClientID != "" {
		if c.TokenDanceID.IssuerURL == "" {
			return fmt.Errorf("tokendance_id.issuer_url is required when tokendance_id.client_id is set")
		}
		if c.TokenDanceID.ClientSecret == "" {
			return fmt.Errorf("tokendance_id.client_secret is required when tokendance_id.client_id is set")
		}
		if c.TokenDanceID.RedirectURI == "" {
			return fmt.Errorf("tokendance_id.redirect_uri is required when tokendance_id.client_id is set")
		}
	}
	return nil
}
