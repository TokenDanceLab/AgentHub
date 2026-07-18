package config

import (
	"log/slog"
	"time"
)

// Residual pure-helper peel #1134: JWT and upload config sections.

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
