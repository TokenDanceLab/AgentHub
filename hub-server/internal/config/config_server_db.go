package config

import (
	"fmt"
	"log/slog"
	"time"
)

// Residual pure-helper peel #1134: server, database, and Redis config sections.

type ServerConfig struct {
	Port         int    `mapstructure:"port"`
	LogLevel     string `mapstructure:"log_level"`
	LogFile      string `mapstructure:"log_file"`
	AdminPort    int    `mapstructure:"admin_port"`
	AuditLogFile string `mapstructure:"audit_log_file"`
	Env          string `mapstructure:"env"`
}

type DBConfig struct {
	Host            string        `mapstructure:"host"`
	Port            int           `mapstructure:"port"`
	User            string        `mapstructure:"user"`
	Password        string        `mapstructure:"password"`
	Name            string        `mapstructure:"name"`
	SSLMode         string        `mapstructure:"sslmode"`
	ApplicationName string        `mapstructure:"application_name"`
	MaxOpenConns    int           `mapstructure:"max_open_conns"`
	MaxIdleConns    int           `mapstructure:"max_idle_conns"`
	ConnMaxLifetime time.Duration `mapstructure:"conn_max_lifetime"`
	ConnMaxIdleTime time.Duration `mapstructure:"conn_max_idle_time"`
}

func (d DBConfig) DSN() string {
	sslmode := d.SSLMode
	if sslmode == "" {
		sslmode = "disable"
	}
	dsn := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		d.Host, d.Port, d.User, d.Password, d.Name, sslmode)
	if d.ApplicationName != "" {
		dsn += " application_name=" + d.ApplicationName
	}
	return dsn
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
		slog.String("application_name", d.ApplicationName),
		slog.Int("max_open_conns", d.MaxOpenConns),
		slog.Int("max_idle_conns", d.MaxIdleConns),
		slog.Duration("conn_max_lifetime", d.ConnMaxLifetime),
		slog.Duration("conn_max_idle_time", d.ConnMaxIdleTime),
	)
}

type RedisConfig struct {
	Host            string `mapstructure:"host"`
	Port            int    `mapstructure:"port"`
	Password        string `mapstructure:"password"`
	DB              int    `mapstructure:"db"`
	PoolSize        int    `mapstructure:"pool_size"`
	MinIdleConns    int    `mapstructure:"min_idle_conns"`
	ReadTimeoutSec  int    `mapstructure:"read_timeout_sec"`
	WriteTimeoutSec int    `mapstructure:"write_timeout_sec"`
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
		slog.Int("read_timeout_sec", r.ReadTimeoutSec),
		slog.Int("write_timeout_sec", r.WriteTimeoutSec),
	)
}
