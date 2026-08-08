package config

import (
	"fmt"
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
	applyTokenDanceIDEnvOverrides(cfg)
	if err := applyS3EnvOverrides(cfg); err != nil {
		return err
	}
	applyUploadEnvOverrides(cfg)
	return applyAgentTeamEnvOverrides(cfg)
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
	if envLogLevel := os.Getenv("AGENTHUB_SERVER_LOG_LEVEL"); envLogLevel != "" {
		cfg.Server.LogLevel = envLogLevel
	}
	if envLogFile := os.Getenv("AGENTHUB_SERVER_LOG_FILE"); envLogFile != "" {
		cfg.Server.LogFile = envLogFile
	}
	// Env: legacy AGENTHUB_ENV takes precedence over server.env in config file.
	if envEnv := os.Getenv("AGENTHUB_ENV"); envEnv != "" {
		cfg.Server.Env = envEnv
	}
}

func applyTokenDanceIDEnvOverrides(cfg *Config) {
	// Viper AutomaticEnv handles nesting with underscores but these
	// belt-and-suspenders overrides guarantee the env vars take precedence
	// regardless of config file content.
	if envIssuer := firstEnv("AGENTHUB_TOKENDANCE_ID_ISSUER_URL", "AGENTHUB_TOKENDANCE_ISSUER_URL"); envIssuer != "" {
		cfg.TokenDanceID.IssuerURL = envIssuer
	}
	if envJWKS := firstEnv("AGENTHUB_TOKENDANCE_ID_JWKS_URI", "AGENTHUB_TOKENDANCE_JWKS_URI"); envJWKS != "" {
		cfg.TokenDanceID.JWKSURI = envJWKS
	}
	if envClientID := firstEnv("AGENTHUB_TOKENDANCE_ID_CLIENT_ID", "AGENTHUB_TOKENDANCE_CLIENT_ID"); envClientID != "" {
		cfg.TokenDanceID.ClientID = envClientID
	}
	if envClientSecret := firstEnv("AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET", "AGENTHUB_TOKENDANCE_CLIENT_SECRET"); envClientSecret != "" {
		cfg.TokenDanceID.ClientSecret = envClientSecret
	}
	if envRedirectURI := firstEnv("AGENTHUB_TOKENDANCE_ID_REDIRECT_URI", "AGENTHUB_TOKENDANCE_REDIRECT_URI"); envRedirectURI != "" {
		cfg.TokenDanceID.RedirectURI = envRedirectURI
	}
	if envAllowedRedirectURIs := firstEnv("AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS", "AGENTHUB_TOKENDANCE_ALLOWED_REDIRECT_URIS"); envAllowedRedirectURIs != "" {
		cfg.TokenDanceID.AllowedRedirectURIs = splitEnvList(envAllowedRedirectURIs)
	}
	if envTokenURL := firstEnv("AGENTHUB_TOKENDANCE_ID_TOKEN_URL", "AGENTHUB_TOKENDANCE_TOKEN_URL"); envTokenURL != "" {
		cfg.TokenDanceID.TokenURL = envTokenURL
	}
}

func applyS3EnvOverrides(cfg *Config) error {
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
