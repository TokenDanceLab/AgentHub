package config

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	Server      ServerConfig      `mapstructure:"server"`
	DB          DBConfig          `mapstructure:"db"`
	Redis       RedisConfig       `mapstructure:"redis"`
	JWT         JWTConfig         `mapstructure:"jwt"`
	Upload      UploadConfig      `mapstructure:"upload"`
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

type JWTConfig struct {
	Secret     string        `mapstructure:"secret"`
	AccessTTL  time.Duration `mapstructure:"access_ttl"`
	RefreshTTL time.Duration `mapstructure:"refresh_ttl"`
}

type UploadConfig struct {
	Dir     string `mapstructure:"dir"`
	MaxSize int64  `mapstructure:"max_size"`
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

	// JWT: reject hardcoded defaults.
	if c.JWT.Secret == "" || c.JWT.Secret == "dev-secret-change-in-production" {
		if os.Getenv("AGENTHUB_JWT_SECRET") == "" {
			return errors.New("JWT secret must be set via AGENTHUB_JWT_SECRET environment variable; hardcoded defaults are rejected")
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
