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
	Server ServerConfig `mapstructure:"server"`
	DB     DBConfig     `mapstructure:"db"`
	Redis  RedisConfig  `mapstructure:"redis"`
	JWT    JWTConfig    `mapstructure:"jwt"`
	Upload UploadConfig `mapstructure:"upload"`
}

type ServerConfig struct {
	Port     int    `mapstructure:"port"`
	LogLevel string `mapstructure:"log_level"`
	LogFile  string `mapstructure:"log_file"`
	AdminPort int   `mapstructure:"admin_port"`
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
	Host        string `mapstructure:"host"`
	Port        int    `mapstructure:"port"`
	Password    string `mapstructure:"password"`
	DB          int    `mapstructure:"db"`
	PoolSize    int    `mapstructure:"pool_size"`
	MinIdleConns int   `mapstructure:"min_idle_conns"`
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

	// P0-1: Explicitly override JWT secret with env var (belt-and-suspenders on top of viper AutomaticEnv).
	if envSecret := os.Getenv("AGENTHUB_JWT_SECRET"); envSecret != "" {
		cfg.JWT.Secret = envSecret
	}

	// P0-1: Reject hardcoded default JWT secrets.
	if cfg.JWT.Secret == "" || cfg.JWT.Secret == "dev-secret-change-in-production" {
		if os.Getenv("AGENTHUB_JWT_SECRET") == "" {
			return nil, errors.New("JWT secret must be set via AGENTHUB_JWT_SECRET environment variable; hardcoded defaults are rejected")
		}
	}

	// Enforce minimum JWT secret length.
	if len(cfg.JWT.Secret) < 16 {
		return nil, fmt.Errorf("JWT secret too short: minimum 16 characters required (got %d)", len(cfg.JWT.Secret))
	}

	return &cfg, nil
}
