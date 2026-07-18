package config

import (
	"fmt"
	"log/slog"
	"strings"
)

// Residual pure-helper peel #1134: S3-compatible attachment storage config.

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
