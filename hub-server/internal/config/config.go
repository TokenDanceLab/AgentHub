package config

import (
	"errors"
	"fmt"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/viper"
)

// Residual pure-helper peel #1134: Config root, Load, and Validate glue.
// Domain sections and env helpers live in companion files.

type Config struct {
	Server       ServerConfig       `mapstructure:"server"`
	DB           DBConfig           `mapstructure:"db"`
	Redis        RedisConfig        `mapstructure:"redis"`
	JWT          JWTConfig          `mapstructure:"jwt"`
	Upload       UploadConfig       `mapstructure:"upload"`
	S3           S3Config           `mapstructure:"s3"`
	TokenDanceID TokenDanceIDConfig `mapstructure:"tokendance_id"`
	AgentTeam    AgentTeamConfig    `mapstructure:"agent_team"`
	Egress       EgressConfig       `mapstructure:"egress"`
}

// EgressConfig is the outbound HTTP policy (#1540). Default-deny: an empty
// allowlist refuses every dial to loopback/private/link-local/metadata
// networks. Ping of user-supplied execution-target addresses therefore
// fails closed until an administrator explicitly allows the target ranges.
type EgressConfig struct {
	AllowCIDRs     []string      `mapstructure:"allow_cidrs"`
	AllowHostnames []string      `mapstructure:"allow_hostnames"`
	AllowPlainHTTP bool          `mapstructure:"allow_plain_http"`
	Timeout        time.Duration `mapstructure:"timeout"`
}

func Load(configPath string) (*Config, error) {
	v := viper.New()
	v.SetConfigFile(configPath)
	v.SetEnvPrefix("AGENTHUB")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()
	v.SetDefault("db.sslmode", "disable")
	v.SetDefault("db.application_name", "agenthub")
	v.SetDefault("db.max_open_conns", 2)
	v.SetDefault("db.max_idle_conns", 1)
	v.SetDefault("db.conn_max_lifetime", 30*time.Minute)
	v.SetDefault("db.conn_max_idle_time", 5*time.Minute)
	v.SetDefault("upload.allowed_mime_types", DefaultAllowedUploadMimeTypes)
	setAgentTeamDefaults(v)

	if err := v.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	// Explicitly override JWT secret with env var (belt-and-suspenders on top of viper AutomaticEnv).
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

	// Explicit env var overrides for Server settings.
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

	// Explicit env var overrides for TokenDance ID.
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

	// Explicit env var overrides for S3-compatible attachment storage.
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
			return nil, fmt.Errorf("invalid AGENTHUB_S3_USE_SSL: %w", err)
		}
		cfg.S3.UseSSL = useSSL
	}
	if envAllowedMimeTypes := os.Getenv("AGENTHUB_UPLOAD_ALLOWED_MIME_TYPES"); envAllowedMimeTypes != "" {
		cfg.Upload.AllowedMimeTypes = splitEnvList(envAllowedMimeTypes)
	}
	if len(cfg.Upload.AllowedMimeTypes) == 0 {
		cfg.Upload.AllowedMimeTypes = append([]string(nil), DefaultAllowedUploadMimeTypes...)
	}

	// Explicit env var override for compete max agents.
	if envCompeteMaxAgents := os.Getenv("AGENTHUB_COMPETE_MAX_AGENTS"); envCompeteMaxAgents != "" {
		n, err := strconv.Atoi(strings.TrimSpace(envCompeteMaxAgents))
		if err != nil {
			return nil, fmt.Errorf("invalid AGENTHUB_COMPETE_MAX_AGENTS: %w", err)
		}
		cfg.AgentTeam.CompeteMaxAgents = n
	}

	// Explicit env var override for human review enabled.
	if envHR := os.Getenv("AGENTHUB_HUMAN_REVIEW_ENABLED"); envHR != "" {
		enabled, err := strconv.ParseBool(strings.TrimSpace(envHR))
		if err != nil {
			return nil, fmt.Errorf("invalid AGENTHUB_HUMAN_REVIEW_ENABLED: %w", err)
		}
		cfg.AgentTeam.HumanReviewEnabled = enabled
	}

	// Auto-derive JWKS URI from issuer URL when not explicitly set.
	if cfg.TokenDanceID.JWKSURI == "" && cfg.TokenDanceID.IssuerURL != "" {
		cfg.TokenDanceID.JWKSURI = cfg.TokenDanceID.IssuerURL + "/oidc/jwks"
	}
	cfg.AgentTeam = cfg.AgentTeam.withDefaults()

	return &cfg, nil
}

// Validate checks that the loaded configuration is usable at startup.
// It rejects insecure defaults, missing infrastructure addresses, and
// missing directories that the server depends on.
func (c *Config) Validate() error {
	// Server: validate env value when explicitly set.
	if c.Server.Env != "" {
		if !validServerEnv(c.Server.Env) {
			return fmt.Errorf("server.env has unknown value %q; accepted: production, prod, release, development, dev, staging, test, debug", c.Server.Env)
		}
	}

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

	// Redis: host and port must be plausible.
	if c.Redis.Host == "" {
		return errors.New("redis.host is required")
	}
	if c.Redis.Port <= 0 || c.Redis.Port > 65535 {
		return fmt.Errorf("redis.port is invalid: %d", c.Redis.Port)
	}

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

	c.AgentTeam = c.AgentTeam.withDefaults()
	if err := c.AgentTeam.Validate(); err != nil {
		return err
	}

	if err := c.S3.Validate(); err != nil {
		return err
	}

	// Upload: if local storage is used and a directory is configured, it must exist.
	if !c.S3.IsConfigured() && c.Upload.Dir != "" {
		if _, err := os.Stat(c.Upload.Dir); os.IsNotExist(err) {
			return fmt.Errorf("upload directory does not exist: %s", c.Upload.Dir)
		}
	}

	return nil
}
