package config

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/viper"

	"github.com/agenthub/hub-server/internal/model"
)

type Config struct {
	Server       ServerConfig       `mapstructure:"server"`
	DB           DBConfig           `mapstructure:"db"`
	Redis        RedisConfig        `mapstructure:"redis"`
	JWT          JWTConfig          `mapstructure:"jwt"`
	Upload       UploadConfig       `mapstructure:"upload"`
	S3           S3Config           `mapstructure:"s3"`
	TokenDanceID TokenDanceIDConfig `mapstructure:"tokendance_id"`
	AgentTeam    AgentTeamConfig    `mapstructure:"agent_team"`
}

// TokenDanceIDConfig holds OIDC/OAuth2 configuration for TokenDance ID integration.
type TokenDanceIDConfig struct {
	// IssuerURL is the TokenDance ID issuer base URL (e.g. https://id.vectorcontrol.tech).
	IssuerURL string `mapstructure:"issuer_url"`
	// JWKSURI overrides the JWKS endpoint. Derived from issuer_url/oidc/jwks when empty.
	JWKSURI string `mapstructure:"jwks_uri"`
	// ClientID is the OIDC client ID registered with TokenDance ID for AgentHub.
	ClientID string `mapstructure:"client_id"`
	// ClientSecret is the OIDC client secret. Must be set via environment variable, never in config YAML.
	ClientSecret string `mapstructure:"client_secret"`
	// RedirectURI is the Hub-owned OIDC callback URL.
	RedirectURI string `mapstructure:"redirect_uri"`
	// AllowedRedirectURIs lists additional browser/native callbacks accepted for one OIDC round trip.
	AllowedRedirectURIs []string `mapstructure:"allowed_redirect_uris"`
}

// LogValue implements slog.LogValuer to redact secrets when config is logged.
func (t TokenDanceIDConfig) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("issuer_url", t.IssuerURL),
		slog.String("jwks_uri", t.JWKSURI),
		slog.String("client_id", t.ClientID),
		slog.String("client_secret", "[REDACTED]"),
		slog.String("redirect_uri", t.RedirectURI),
		slog.Any("allowed_redirect_uris", t.AllowedRedirectURIs),
	)
}

type ServerConfig struct {
	Port         int    `mapstructure:"port"`
	LogLevel     string `mapstructure:"log_level"`
	LogFile      string `mapstructure:"log_file"`
	AdminPort    int    `mapstructure:"admin_port"`
	AuditLogFile string `mapstructure:"audit_log_file"`
	Env          string `mapstructure:"env"`
}

type DBConfig struct {
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	User     string `mapstructure:"user"`
	Password string `mapstructure:"password"`
	Name     string `mapstructure:"name"`
	SSLMode  string `mapstructure:"sslmode"`
}

func (d DBConfig) DSN() string {
	sslmode := d.SSLMode
	if sslmode == "" {
		sslmode = "disable"
	}
	return fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		d.Host, d.Port, d.User, d.Password, d.Name, sslmode)
}

// LogValue implements slog.LogValuer to redact secrets when config is logged.
func (d DBConfig) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("host", d.Host),
		slog.Int("port", d.Port),
		slog.String("user", d.User),
		slog.String("password", "[REDACTED]"),
		slog.String("name", d.Name),
		slog.String("sslmode", d.SSLMode),
	)
}

type RedisConfig struct {
	Host         string `mapstructure:"host"`
	Port         int    `mapstructure:"port"`
	Password     string `mapstructure:"password"`
	DB           int    `mapstructure:"db"`
	PoolSize     int    `mapstructure:"pool_size"`
	MinIdleConns int    `mapstructure:"min_idle_conns"`
}

func (r RedisConfig) Addr() string {
	return fmt.Sprintf("%s:%d", r.Host, r.Port)
}

// LogValue implements slog.LogValuer to redact secrets when config is logged.
func (r RedisConfig) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("host", r.Host),
		slog.Int("port", r.Port),
		slog.String("password", "[REDACTED]"),
		slog.Int("db", r.DB),
		slog.Int("pool_size", r.PoolSize),
		slog.Int("min_idle_conns", r.MinIdleConns),
	)
}

type JWTConfig struct {
	Secret      string            `mapstructure:"secret"`
	Secrets     map[string]string `mapstructure:"-"` // parsed from AGENTHUB_JWT_SECRETS env var
	ActiveKeyID string            `mapstructure:"-"` // parsed from AGENTHUB_JWT_ACTIVE_KEY_ID env var
	AccessTTL   time.Duration     `mapstructure:"access_ttl"`
	RefreshTTL  time.Duration     `mapstructure:"refresh_ttl"`
}

// LogValue implements slog.LogValuer to redact secrets when config is logged.
func (j JWTConfig) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("secret", "[REDACTED]"),
		slog.Any("secrets_count", len(j.Secrets)),
		slog.String("active_key_id", j.ActiveKeyID),
		slog.Duration("access_ttl", j.AccessTTL),
		slog.Duration("refresh_ttl", j.RefreshTTL),
	)
}

type UploadConfig struct {
	Dir              string   `mapstructure:"dir"`
	MaxSize          int64    `mapstructure:"max_size"`
	AllowedMimeTypes []string `mapstructure:"allowed_mime_types"`
}

type AgentTeamConfig struct {
	MaxDelegationDepth       int           `mapstructure:"max_delegation_depth"`
	MaxActiveSubAgentsPerRun int           `mapstructure:"max_active_subagents_per_run"`
	MaxRouteRepeats          int           `mapstructure:"max_route_repeats"`
	MaxTasksPerTeamRun       int           `mapstructure:"max_tasks_per_team_run"`
	AssignmentTimeout        time.Duration `mapstructure:"assignment_timeout"`
	MaxTeamRunBudgetTokens   int64         `mapstructure:"max_team_run_budget_tokens"`
	MaxTeamRunBudgetUsagePct float64       `mapstructure:"max_team_run_budget_usage_pct"`
}

func setAgentTeamDefaults(v *viper.Viper) {
	defaults := DefaultAgentTeamConfig()
	v.SetDefault("agent_team.max_delegation_depth", defaults.MaxDelegationDepth)
	v.SetDefault("agent_team.max_active_subagents_per_run", defaults.MaxActiveSubAgentsPerRun)
	v.SetDefault("agent_team.max_route_repeats", defaults.MaxRouteRepeats)
	v.SetDefault("agent_team.max_tasks_per_team_run", defaults.MaxTasksPerTeamRun)
	v.SetDefault("agent_team.assignment_timeout", defaults.AssignmentTimeout)
	v.SetDefault("agent_team.max_team_run_budget_tokens", defaults.MaxTeamRunBudgetTokens)
	v.SetDefault("agent_team.max_team_run_budget_usage_pct", defaults.MaxTeamRunBudgetUsagePct)
}

func DefaultAgentTeamConfig() AgentTeamConfig {
	return AgentTeamConfig{
		MaxDelegationDepth:       model.MaxDelegationDepth,
		MaxActiveSubAgentsPerRun: model.MaxActiveSubAgentsPerRun,
		MaxRouteRepeats:          model.MaxRouteRepeats,
		MaxTasksPerTeamRun:       model.MaxTasksPerTeamRun,
		AssignmentTimeout:        model.DefaultAssignmentTimeout,
		MaxTeamRunBudgetTokens:   model.MaxTeamRunBudgetTokens,
		MaxTeamRunBudgetUsagePct: model.MaxTeamRunBudgetUsagePct,
	}
}

func (a AgentTeamConfig) withDefaults() AgentTeamConfig {
	defaults := DefaultAgentTeamConfig()
	if a.MaxDelegationDepth == 0 {
		a.MaxDelegationDepth = defaults.MaxDelegationDepth
	}
	if a.MaxActiveSubAgentsPerRun == 0 {
		a.MaxActiveSubAgentsPerRun = defaults.MaxActiveSubAgentsPerRun
	}
	if a.MaxRouteRepeats == 0 {
		a.MaxRouteRepeats = defaults.MaxRouteRepeats
	}
	if a.MaxTasksPerTeamRun == 0 {
		a.MaxTasksPerTeamRun = defaults.MaxTasksPerTeamRun
	}
	if a.AssignmentTimeout == 0 {
		a.AssignmentTimeout = defaults.AssignmentTimeout
	}
	if a.MaxTeamRunBudgetTokens == 0 {
		a.MaxTeamRunBudgetTokens = defaults.MaxTeamRunBudgetTokens
	}
	if a.MaxTeamRunBudgetUsagePct == 0 {
		a.MaxTeamRunBudgetUsagePct = defaults.MaxTeamRunBudgetUsagePct
	}
	return a
}

func (a AgentTeamConfig) Validate() error {
	if a.MaxDelegationDepth < 0 {
		return fmt.Errorf("agent_team.max_delegation_depth must be non-negative")
	}
	if a.MaxActiveSubAgentsPerRun < 0 {
		return fmt.Errorf("agent_team.max_active_subagents_per_run must be non-negative")
	}
	if a.MaxRouteRepeats < 0 {
		return fmt.Errorf("agent_team.max_route_repeats must be non-negative")
	}
	if a.MaxTasksPerTeamRun < 0 {
		return fmt.Errorf("agent_team.max_tasks_per_team_run must be non-negative")
	}
	if a.AssignmentTimeout < 0 {
		return fmt.Errorf("agent_team.assignment_timeout must be non-negative")
	}
	if a.MaxTeamRunBudgetTokens < 0 {
		return fmt.Errorf("agent_team.max_team_run_budget_tokens must be non-negative")
	}
	if a.MaxTeamRunBudgetUsagePct < 0 || a.MaxTeamRunBudgetUsagePct > 100 {
		return fmt.Errorf("agent_team.max_team_run_budget_usage_pct must be between 0 and 100")
	}
	return nil
}

// S3Config holds S3-compatible object storage settings for attachments.
// When Endpoint/Bucket are empty, the server falls back to local filesystem storage.
type S3Config struct {
	Endpoint  string `mapstructure:"endpoint"`
	AccessKey string `mapstructure:"access_key"`
	SecretKey string `mapstructure:"secret_key"`
	Bucket    string `mapstructure:"bucket"`
	Region    string `mapstructure:"region"`
	UseSSL    bool   `mapstructure:"use_ssl"`
}

// IsConfigured returns true when enough S3 settings are present to attempt
// S3-backed attachment storage.
func (s S3Config) IsConfigured() bool {
	return strings.TrimSpace(s.Endpoint) != "" && strings.TrimSpace(s.Bucket) != ""
}

func (s S3Config) hasAnySetting() bool {
	return strings.TrimSpace(s.Endpoint) != "" ||
		strings.TrimSpace(s.AccessKey) != "" ||
		strings.TrimSpace(s.SecretKey) != "" ||
		strings.TrimSpace(s.Bucket) != "" ||
		strings.TrimSpace(s.Region) != ""
}

func (s S3Config) Validate() error {
	if !s.hasAnySetting() {
		return nil
	}
	if strings.TrimSpace(s.Endpoint) == "" {
		return fmt.Errorf("s3.endpoint is required when S3 attachment storage is configured")
	}
	if strings.TrimSpace(s.Bucket) == "" {
		return fmt.Errorf("s3.bucket is required when S3 attachment storage is configured")
	}
	if strings.TrimSpace(s.AccessKey) == "" {
		return fmt.Errorf("s3.access_key is required when S3 attachment storage is configured")
	}
	if strings.TrimSpace(s.SecretKey) == "" {
		return fmt.Errorf("s3.secret_key is required when S3 attachment storage is configured")
	}
	if strings.Contains(s.Endpoint, "://") &&
		!strings.HasPrefix(s.Endpoint, "http://") &&
		!strings.HasPrefix(s.Endpoint, "https://") {
		return fmt.Errorf("s3.endpoint must use http or https when a scheme is provided")
	}
	return nil
}

// LogValue implements slog.LogValuer to redact secrets when config is logged.
func (s S3Config) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("endpoint", s.Endpoint),
		slog.String("access_key", "[REDACTED]"),
		slog.String("secret_key", "[REDACTED]"),
		slog.String("bucket", s.Bucket),
		slog.String("region", s.Region),
		slog.Bool("use_ssl", s.UseSSL),
	)
}

func Load(configPath string) (*Config, error) {
	v := viper.New()
	v.SetConfigFile(configPath)
	v.SetEnvPrefix("AGENTHUB")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()
	v.SetDefault("db.sslmode", "disable")
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

	// Auto-derive JWKS URI from issuer URL when not explicitly set.
	if cfg.TokenDanceID.JWKSURI == "" && cfg.TokenDanceID.IssuerURL != "" {
		cfg.TokenDanceID.JWKSURI = cfg.TokenDanceID.IssuerURL + "/oidc/jwks"
	}
	cfg.AgentTeam = cfg.AgentTeam.withDefaults()

	return &cfg, nil
}

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
