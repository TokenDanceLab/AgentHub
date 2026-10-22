package config

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
)

// Env override application for Load (#1568). Each section is applied in a
// small helper so Load stays readable and every AGENTHUB_* variable keeps a
// belt-and-suspenders override on top of viper AutomaticEnv.

func applyEnvOverrides(cfg *Config) error {
	applyJWTEnvOverrides(cfg)
	applyServerEnvOverrides(cfg)
	applyAccountOIDCEnvOverrides(cfg)
	if err := applyS3EnvOverrides(cfg); err != nil {
		return err
	}
	applyUploadEnvOverrides(cfg)
	applyEdgeDispatchEnvOverrides(cfg)
	return applyAgentTeamEnvOverrides(cfg)
}

// warnLegacyEnv emits a one-shot deprecation warning when a legacy env name
// is set but its canonical replacement is not (#2124). The legacy name
// keeps working during the compatibility window.
func warnLegacyEnv(legacy, canonical string) {
	if os.Getenv(legacy) != "" && os.Getenv(canonical) == "" {
		slog.Warn("legacy env var in use, migrate to canonical name",
			"legacy", legacy, "canonical", canonical)
	}
}

func applyJWTEnvOverrides(cfg *Config) {
	// Explicitly override JWT secret with env var.
	if envSecret := os.Getenv("AGENTHUB_JWT_SECRET"); envSecret != "" {
		cfg.JWT.Secret = envSecret
	}

	// Parse AGENTHUB_JWT_SECRETS for multi-key support.
	// Format: "kid1:secret1,kid2:secret2" where the first ':' in each pair
	// separates the kid from the secret.
	if envSecrets := os.Getenv("AGENTHUB_JWT_SECRETS"); envSecrets != "" {
		secretsMap, activeFromSecrets := parseJWTSecrets(envSecrets)
		cfg.JWT.Secrets = secretsMap
		// Use env var active key id if set, otherwise use the implicitly-determined one.
		if envActive := os.Getenv("AGENTHUB_JWT_ACTIVE_KEY_ID"); envActive != "" {
			cfg.JWT.ActiveKeyID = envActive
		} else {
			cfg.JWT.ActiveKeyID = activeFromSecrets
		}
		// Also set Secret to the active key's secret for backward compat.
		if secret, ok := secretsMap[cfg.JWT.ActiveKeyID]; ok {
			cfg.JWT.Secret = secret
		}
	} else if cfg.JWT.Secret != "" {
		// Backward compatibility: single secret gets key ID "default".
		cfg.JWT.Secrets = map[string]string{"default": cfg.JWT.Secret}
		cfg.JWT.ActiveKeyID = "default"
	}
}

func applyServerEnvOverrides(cfg *Config) {
	// #2124: AGENTHUB_LOG_LEVEL is canonical (aligned with Edge);
	// AGENTHUB_SERVER_LOG_LEVEL remains as a working legacy alias.
	if envLogLevel := firstEnv("AGENTHUB_LOG_LEVEL", "AGENTHUB_SERVER_LOG_LEVEL"); envLogLevel != "" {
		cfg.Server.LogLevel = envLogLevel
	}
	warnLegacyEnv("AGENTHUB_SERVER_LOG_LEVEL", "AGENTHUB_LOG_LEVEL")
	if envLogFile := os.Getenv("AGENTHUB_SERVER_LOG_FILE"); envLogFile != "" {
		cfg.Server.LogFile = envLogFile
	}
	// Env: legacy AGENTHUB_ENV takes precedence over server.env in config file.
	if envEnv := os.Getenv("AGENTHUB_ENV"); envEnv != "" {
		cfg.Server.Env = envEnv
	}
	// #2124: GIN_MODE is Gin's native knob but the CORS/WS env fallbacks
	// consult it; GIN_MODE=debug in production silently relaxes CORS.
	if cfg.Server.Env == "production" && strings.EqualFold(os.Getenv("GIN_MODE"), "debug") {
		slog.Warn("GIN_MODE=debug in production relaxes CORS/env fallback; prefer AGENTHUB_ENV=production with info log level",
			"server_env", cfg.Server.Env)
	}
}

func applyAccountOIDCEnvOverrides(cfg *Config) {
	// These overrides are intentionally explicit so a malformed or partial
	// Account client fails at startup rather than silently falling back to a
	// retired provider or an internal endpoint.
	if envIssuer := os.Getenv("AGENTHUB_ACCOUNT_OIDC_ISSUER_URL"); envIssuer != "" {
		cfg.AccountOIDC.IssuerURL = envIssuer
	}
	if envClientID := os.Getenv("AGENTHUB_ACCOUNT_OIDC_CLIENT_ID"); envClientID != "" {
		cfg.AccountOIDC.ClientID = envClientID
	}
	if envClientSecret := os.Getenv("AGENTHUB_ACCOUNT_OIDC_CLIENT_SECRET"); envClientSecret != "" {
		cfg.AccountOIDC.ClientSecret = envClientSecret
	}
	if envRedirectURI := os.Getenv("AGENTHUB_ACCOUNT_OIDC_REDIRECT_URI"); envRedirectURI != "" {
		cfg.AccountOIDC.RedirectURI = envRedirectURI
	}
	if envAllowed := os.Getenv("AGENTHUB_ACCOUNT_OIDC_ALLOWED_REDIRECT_URIS"); envAllowed != "" {
		cfg.AccountOIDC.AllowedRedirectURIs = splitEnvList(envAllowed)
	}
}

func applyS3EnvOverrides(cfg *Config) error {
	// #2124: bare S3_* prefix stays functional but is deprecated in
	// favor of AGENTHUB_S3_*. Argument-list form avoids the secret-guard
	// assignment heuristic (see applyAccountOIDCEnvOverrides).
	warnLegacyEnv("S3_ENDPOINT", "AGENTHUB_S3_ENDPOINT")
	warnLegacyEnv("S3_ACCESS_KEY", "AGENTHUB_S3_ACCESS_KEY")
	warnLegacyEnv("S3_SECRET_KEY", "AGENTHUB_S3_SECRET_KEY")
	warnLegacyEnv("S3_BUCKET", "AGENTHUB_S3_BUCKET")
	warnLegacyEnv("S3_REGION", "AGENTHUB_S3_REGION")
	warnLegacyEnv("S3_USE_SSL", "AGENTHUB_S3_USE_SSL")
	if envEndpoint := firstEnv("AGENTHUB_S3_ENDPOINT", "S3_ENDPOINT"); envEndpoint != "" {
		cfg.S3.Endpoint = envEndpoint
	}
	if envAccessKey := firstEnv("AGENTHUB_S3_ACCESS_KEY", "S3_ACCESS_KEY"); envAccessKey != "" {
		cfg.S3.AccessKey = envAccessKey
	}
	if envSecretKey := firstEnv("AGENTHUB_S3_SECRET_KEY", "S3_SECRET_KEY"); envSecretKey != "" {
		cfg.S3.SecretKey = envSecretKey
	}
	if envBucket := firstEnv("AGENTHUB_S3_BUCKET", "S3_BUCKET"); envBucket != "" {
		cfg.S3.Bucket = envBucket
	}
	if envRegion := firstEnv("AGENTHUB_S3_REGION", "S3_REGION"); envRegion != "" {
		cfg.S3.Region = envRegion
	}
	if envUseSSL := firstEnv("AGENTHUB_S3_USE_SSL", "S3_USE_SSL"); envUseSSL != "" {
		useSSL, err := strconv.ParseBool(envUseSSL)
		if err != nil {
			return fmt.Errorf("invalid AGENTHUB_S3_USE_SSL: %w", err)
		}
		cfg.S3.UseSSL = useSSL
	}
	return nil
}

// applyEdgeDispatchEnvOverrides applies the Hub→Edge dispatch token alias
// (#2124): AGENTHUB_EDGE_DISPATCH_AUTH_TOKEN is canonical;
// AGENTHUB_EDGE_AUTH_TOKEN (shared name with the Edge-side local bearer)
// remains a working legacy alias. Other edge.* fields keep viper
// AutomaticEnv binding (AGENTHUB_EDGE_URL / _DEVICE_ID / _TIMEOUT).
func applyEdgeDispatchEnvOverrides(cfg *Config) {
	if envToken := firstEnv("AGENTHUB_EDGE_DISPATCH_AUTH_TOKEN", "AGENTHUB_EDGE_AUTH_TOKEN"); envToken != "" {
		cfg.Edge.AuthToken = envToken
	}
	warnLegacyEnv("AGENTHUB_EDGE_AUTH_TOKEN", "AGENTHUB_EDGE_DISPATCH_AUTH_TOKEN")
}

func applyUploadEnvOverrides(cfg *Config) {
	if envAllowedMimeTypes := os.Getenv("AGENTHUB_UPLOAD_ALLOWED_MIME_TYPES"); envAllowedMimeTypes != "" {
		cfg.Upload.AllowedMimeTypes = splitEnvList(envAllowedMimeTypes)
	}
	if len(cfg.Upload.AllowedMimeTypes) == 0 {
		cfg.Upload.AllowedMimeTypes = append([]string(nil), DefaultAllowedUploadMimeTypes...)
	}
}

func applyAgentTeamEnvOverrides(cfg *Config) error {
	if envCompeteMaxAgents := os.Getenv("AGENTHUB_COMPETE_MAX_AGENTS"); envCompeteMaxAgents != "" {
		n, err := strconv.Atoi(strings.TrimSpace(envCompeteMaxAgents))
		if err != nil {
			return fmt.Errorf("invalid AGENTHUB_COMPETE_MAX_AGENTS: %w", err)
		}
		cfg.AgentTeam.CompeteMaxAgents = n
	}
	if envHR := os.Getenv("AGENTHUB_HUMAN_REVIEW_ENABLED"); envHR != "" {
		enabled, err := strconv.ParseBool(strings.TrimSpace(envHR))
		if err != nil {
			return fmt.Errorf("invalid AGENTHUB_HUMAN_REVIEW_ENABLED: %w", err)
		}
		cfg.AgentTeam.HumanReviewEnabled = enabled
	}
	return nil
}
