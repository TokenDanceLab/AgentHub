package config

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	Server       ServerConfig       `mapstructure:"server"`
	DB           DBConfig           `mapstructure:"db"`
	Redis        RedisConfig        `mapstructure:"redis"`
	JWT          JWTConfig          `mapstructure:"jwt"`
	Upload       UploadConfig       `mapstructure:"upload"`
	S3           S3Config           `mapstructure:"s3"`
	TokenDanceID TokenDanceIDConfig `mapstructure:"tokendance_id"`
}

// TokenDanceIDConfig holds OIDC/OAuth2 configuration for TokenDance ID integration.
type TokenDanceIDConfig struct {
	// IssuerURL is the TokenDance ID issuer base URL (e.g. https://id.vectorcontrol.tech).
	IssuerURL string `mapstructure:"issuer_url"`
	// JWKSURI overrides the JWKS endpoint. Derived from issuer_url/.well-known if empty.
	JWKSURI string `mapstructure:"jwks_uri"`
	// ClientID is the OIDC client ID registered with TokenDance ID for AgentHub.
	ClientID string `mapstructure:"client_id"`
	// ClientSecret is the OIDC client secret. Must be set via environment variable, never in config YAML.
	ClientSecret string `mapstructure:"client_secret"`
	// RedirectURI is the Hub-owned OIDC callback URL.
	RedirectURI string `mapstructure:"redirect_uri"`
}

// LogValue implements slog.LogValuer to redact secrets when config is logged.
func (t TokenDanceIDConfig) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("issuer_url", t.IssuerURL),
		slog.String("jwks_uri", t.JWKSURI),
		slog.String("client_id", t.ClientID),
		slog.String("client_secret", "[REDACTED]"),
		slog.String("redirect_uri", t.RedirectURI),
	)
}

type ServerConfig struct {
	Port      int    `mapstructure:"port"`
	LogLevel  string `mapstructure:"log_level"`
	LogFile   string `mapstructure:"log_file"`
	AdminPort int    `mapstructure:"admin_port"`
}

type DBConfig struct {
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	User     string `mapstructure:"user"`
	Password string `mapstructure:"password"`
	Name     string `mapstructure:"name"`
}

func (d DBConfig) DSN() string {
	return fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=disable",
		d.Host, d.Port, d.User, d.Password, d.Name)
}

// LogValue implements slog.LogValuer to redact secrets when config is logged.
func (d DBConfig) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("host", d.Host),
		slog.Int("port", d.Port),
		slog.String("user", d.User),
		slog.String("password", "[REDACTED]"),
		slog.String("name", d.Name),
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
	Secret     string        `mapstructure:"secret"`
	AccessTTL  time.Duration `mapstructure:"access_ttl"`
	RefreshTTL time.Duration `mapstructure:"refresh_ttl"`
}

// LogValue implements slog.LogValuer to redact secrets when config is logged.
func (j JWTConfig) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("secret", "[REDACTED]"),
		slog.Duration("access_ttl", j.AccessTTL),
		slog.Duration("refresh_ttl", j.RefreshTTL),
	)
}

type UploadConfig struct {
	Dir     string `mapstructure:"dir"`
	MaxSize int64  `mapstructure:"max_size"`
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
	return s.Endpoint != "" && s.Bucket != ""
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

	// Explicit env var overrides for TokenDance ID.
	// Viper AutomaticEnv handles nesting with underscores but these
	// belt-and-suspenders overrides guarantee the env vars take precedence
	// regardless of config file content.
	if envIssuer := os.Getenv("AGENTHUB_TOKENDANCE_ISSUER_URL"); envIssuer != "" {
		cfg.TokenDanceID.IssuerURL = envIssuer
	}
	if envJWKS := os.Getenv("AGENTHUB_TOKENDANCE_JWKS_URI"); envJWKS != "" {
		cfg.TokenDanceID.JWKSURI = envJWKS
	}
	if envClientID := os.Getenv("AGENTHUB_TOKENDANCE_CLIENT_ID"); envClientID != "" {
		cfg.TokenDanceID.ClientID = envClientID
	}
	if envClientSecret := os.Getenv("AGENTHUB_TOKENDANCE_CLIENT_SECRET"); envClientSecret != "" {
		cfg.TokenDanceID.ClientSecret = envClientSecret
	}
	if envRedirectURI := os.Getenv("AGENTHUB_TOKENDANCE_REDIRECT_URI"); envRedirectURI != "" {
		cfg.TokenDanceID.RedirectURI = envRedirectURI
	}

	// Auto-derive JWKS URI from issuer URL when not explicitly set.
	if cfg.TokenDanceID.JWKSURI == "" && cfg.TokenDanceID.IssuerURL != "" {
		cfg.TokenDanceID.JWKSURI = cfg.TokenDanceID.IssuerURL + "/.well-known/jwks.json"
	}

	return &cfg, nil
}

// Validate checks that the loaded configuration is usable at startup.
// It rejects insecure defaults, missing infrastructure addresses, and
// missing directories that the server depends on.
func (c *Config) Validate() error {
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

	// JWT: enforce minimum length.
	if len(c.JWT.Secret) < 16 {
		return fmt.Errorf("JWT secret too short: minimum 16 characters required (got %d)", len(c.JWT.Secret))
	}

	// TokenDance ID config is optional; validate only when explicitly configured
	if c.TokenDanceID.ClientID != "" {
		if c.TokenDanceID.IssuerURL == "" {
			return fmt.Errorf("tokendance_id.issuer_url is required when tokendance_id.client_id is set")
		}
		if c.TokenDanceID.ClientSecret == "" {
			return fmt.Errorf("tokendance_id.client_secret is required when tokendance_id.client_id is set")
		}
	}

	// Upload: if a directory is configured, it must exist.
	if c.Upload.Dir != "" {
		if _, err := os.Stat(c.Upload.Dir); os.IsNotExist(err) {
			return fmt.Errorf("upload directory does not exist: %s", c.Upload.Dir)
		}
	}

	return nil
}
