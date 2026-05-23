package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeTempConfig creates a temporary YAML config file and returns its path.
// The caller is responsible for cleaning up.
func writeTempConfig(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write temp config: %v", err)
	}
	return path
}

func TestLoadValidConfig(t *testing.T) {
	yaml := `
server:
  port: 8080
  log_level: info
db:
  host: localhost
  port: 5432
  user: agenthub
  password: secret
  name: agenthub
redis:
  host: localhost
  port: 6379
  password: ""
  db: 0
jwt:
  access_ttl: 15m
  refresh_ttl: 720h
upload:
  dir: ./uploads
  max_size: 10485760
`
	path := writeTempConfig(t, yaml)

	// Set the JWT secret via env var (required by validation).
	t.Setenv("AGENTHUB_JWT_SECRET", "test-jwt-secret-42")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.Server.Port != 8080 {
		t.Errorf("Server.Port = %d, want 8080", cfg.Server.Port)
	}
	if cfg.Server.LogLevel != "info" {
		t.Errorf("Server.LogLevel = %q, want %q", cfg.Server.LogLevel, "info")
	}
	if cfg.DB.Host != "localhost" {
		t.Errorf("DB.Host = %q, want %q", cfg.DB.Host, "localhost")
	}
	if cfg.DB.Port != 5432 {
		t.Errorf("DB.Port = %d, want 5432", cfg.DB.Port)
	}
	if cfg.Redis.Host != "localhost" {
		t.Errorf("Redis.Host = %q, want %q", cfg.Redis.Host, "localhost")
	}
	if cfg.JWT.Secret != "test-jwt-secret-42" {
		t.Errorf("JWT.Secret = %q, want %q", cfg.JWT.Secret, "test-jwt-secret-42")
	}
}

func TestLoadMissingFile(t *testing.T) {
	t.Setenv("AGENTHUB_JWT_SECRET", "some-secret")
	_, err := Load("/nonexistent/path/to/config.yaml")
	if err == nil {
		t.Fatal("expected error for missing config file, got nil")
	}
}

func TestJWTSecretEnvOverride(t *testing.T) {
	// Config file has a secret set, but env var should override it.
	yaml := `
jwt:
  secret: file-secret-should-be-overridden
  access_ttl: 15m
  refresh_ttl: 720h
`
	path := writeTempConfig(t, yaml)
	t.Setenv("AGENTHUB_JWT_SECRET", "env-secret-override")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.JWT.Secret != "env-secret-override" {
		t.Errorf("JWT.Secret = %q, want %q (env var should override file)", cfg.JWT.Secret, "env-secret-override")
	}
}

func TestJWTSecretEmptyRejected(t *testing.T) {
	yaml := `
jwt:
  access_ttl: 15m
  refresh_ttl: 720h
`
	path := writeTempConfig(t, yaml)

	// No env var set — JWT secret is empty.
	_, err := Load(path)
	if err == nil {
		t.Fatal("expected error for empty JWT secret, got nil")
	}
}

func TestJWTSecretHardcodedDefaultRejected(t *testing.T) {
	yaml := `
jwt:
  secret: dev-secret-change-in-production
  access_ttl: 15m
  refresh_ttl: 720h
`
	path := writeTempConfig(t, yaml)

	// Env var not set, config has the hardcoded default — must be rejected.
	_, err := Load(path)
	if err == nil {
		t.Fatal("expected error for hardcoded default JWT secret, got nil")
	}
}

func TestJWTSecretHardcodedDefaultWithEnvOverride(t *testing.T) {
	// Config file has the hardcoded default, but env var provides a real secret.
	yaml := `
jwt:
  secret: dev-secret-change-in-production
  access_ttl: 15m
  refresh_ttl: 720h
`
	path := writeTempConfig(t, yaml)
	t.Setenv("AGENTHUB_JWT_SECRET", "real-secret-from-env")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v, expected success when env var overrides hardcoded default", err)
	}
	if cfg.JWT.Secret != "real-secret-from-env" {
		t.Errorf("JWT.Secret = %q, want %q", cfg.JWT.Secret, "real-secret-from-env")
	}
}

func TestJWTSecretOnlyFromEnv(t *testing.T) {
	// Config file has no JWT secret at all; env var provides it.
	yaml := `
jwt:
  access_ttl: 15m
  refresh_ttl: 720h
`
	path := writeTempConfig(t, yaml)
	t.Setenv("AGENTHUB_JWT_SECRET", "env-only-secret")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.JWT.Secret != "env-only-secret" {
		t.Errorf("JWT.Secret = %q, want %q", cfg.JWT.Secret, "env-only-secret")
	}
}

func TestDBConfigDSN(t *testing.T) {
	db := DBConfig{
		Host:     "db.example.com",
		Port:     5432,
		User:     "admin",
		Password: "s3cret",
		Name:     "agenthub",
	}
	dsn := db.DSN()
	expected := "host=db.example.com port=5432 user=admin password=s3cret dbname=agenthub sslmode=disable"
	if dsn != expected {
		t.Errorf("DSN() = %q, want %q", dsn, expected)
	}
}

func TestRedisConfigAddr(t *testing.T) {
	r := RedisConfig{
		Host: "redis.local",
		Port: 6380,
	}
	addr := r.Addr()
	expected := "redis.local:6380"
	if addr != expected {
		t.Errorf("Addr() = %q, want %q", addr, expected)
	}
}

func TestLoadReturnsCorrectConfig(t *testing.T) {
	// Load() returns the parsed config; no global variable.
	yaml := `
jwt:
  access_ttl: 15m
  refresh_ttl: 720h
`
	path := writeTempConfig(t, yaml)
	t.Setenv("AGENTHUB_JWT_SECRET", "global-test-secret")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg == nil {
		t.Fatal("Load() returned nil config")
	}
	if cfg.JWT.Secret != "global-test-secret" {
		t.Errorf("JWT.Secret = %q, want %q", cfg.JWT.Secret, "global-test-secret")
	}
}

// --- Env var override for non-JWT config fields ---

const validJWTYAML = `
server:
  port: 8080
  log_level: info
db:
  host: yaml-db-host
  port: 5432
  user: yaml-user
  password: yaml-pass
  name: yaml-db
redis:
  host: yaml-redis-host
  port: 6379
  password: ""
  db: 0
jwt:
  secret: ""
upload:
  dir: ./uploads
  max_size: 10485760
`

func TestEnvOverrideServerPort(t *testing.T) {
	path := writeTempConfig(t, validJWTYAML)
	t.Setenv("AGENTHUB_JWT_SECRET", "override-secret")
	t.Setenv("AGENTHUB_SERVER_PORT", "9999")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Server.Port != 9999 {
		t.Errorf("Server.Port = %d, want 9999 (env override)", cfg.Server.Port)
	}
}

func TestEnvOverrideDBConfig(t *testing.T) {
	path := writeTempConfig(t, validJWTYAML)
	t.Setenv("AGENTHUB_JWT_SECRET", "db-override-secret")
	t.Setenv("AGENTHUB_DB_HOST", "env-db-host")
	t.Setenv("AGENTHUB_DB_USER", "env-db-user")
	t.Setenv("AGENTHUB_DB_NAME", "env-db-name")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.DB.Host != "env-db-host" {
		t.Errorf("DB.Host = %q, want env-db-host", cfg.DB.Host)
	}
	if cfg.DB.User != "env-db-user" {
		t.Errorf("DB.User = %q, want env-db-user", cfg.DB.User)
	}
	if cfg.DB.Name != "env-db-name" {
		t.Errorf("DB.Name = %q, want env-db-name", cfg.DB.Name)
	}
	// Password was NOT overridden via env — stays from YAML.
	if cfg.DB.Password != "yaml-pass" {
		t.Errorf("DB.Password = %q, want yaml-pass (not overridden)", cfg.DB.Password)
	}
}

func TestEnvOverrideRedisConfig(t *testing.T) {
	path := writeTempConfig(t, validJWTYAML)
	t.Setenv("AGENTHUB_JWT_SECRET", "redis-override-secret")
	t.Setenv("AGENTHUB_REDIS_HOST", "env-redis-host")
	t.Setenv("AGENTHUB_REDIS_PORT", "6390")
	t.Setenv("AGENTHUB_REDIS_DB", "2")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Redis.Host != "env-redis-host" {
		t.Errorf("Redis.Host = %q, want env-redis-host", cfg.Redis.Host)
	}
	if cfg.Redis.Port != 6390 {
		t.Errorf("Redis.Port = %d, want 6390", cfg.Redis.Port)
	}
	if cfg.Redis.DB != 2 {
		t.Errorf("Redis.DB = %d, want 2", cfg.Redis.DB)
	}
}

func TestEnvOverrideUploadConfig(t *testing.T) {
	path := writeTempConfig(t, validJWTYAML)
	t.Setenv("AGENTHUB_JWT_SECRET", "upload-override-secret")
	t.Setenv("AGENTHUB_UPLOAD_DIR", "/custom/uploads")
	t.Setenv("AGENTHUB_UPLOAD_MAX_SIZE", "20971520")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Upload.Dir != "/custom/uploads" {
		t.Errorf("Upload.Dir = %q, want /custom/uploads", cfg.Upload.Dir)
	}
	if cfg.Upload.MaxSize != 20971520 {
		t.Errorf("Upload.MaxSize = %d, want 20971520", cfg.Upload.MaxSize)
	}
}

// --- DSN / Addr edge cases ---

func TestDBConfigDSNZeroValues(t *testing.T) {
	db := DBConfig{}
	dsn := db.DSN()
	if dsn != "host= port=0 user= password= dbname= sslmode=disable" {
		t.Errorf("DSN() zero = %q, want all-empty fields", dsn)
	}
}

func TestDBConfigDSNSpecialCharacters(t *testing.T) {
	db := DBConfig{
		Host:     "host-with-dash.example.com",
		Port:     5432,
		User:     "user@domain",
		Password: "p@ss w0rd!",
		Name:     "db_with_underscore",
	}
	dsn := db.DSN()
	if !strings.Contains(dsn, "host=host-with-dash.example.com") {
		t.Errorf("DSN() = %q, missing host", dsn)
	}
	if !strings.Contains(dsn, "user=user@domain") {
		t.Errorf("DSN() = %q, missing user with @", dsn)
	}
	if !strings.Contains(dsn, "password=p@ss w0rd!") {
		t.Errorf("DSN() = %q, missing password with special chars", dsn)
	}
}

func TestRedisConfigAddrZero(t *testing.T) {
	r := RedisConfig{}
	addr := r.Addr()
	if addr != ":0" {
		t.Errorf("Addr() zero = %q, want :0", addr)
	}
}

func TestRedisConfigAddrIPv4(t *testing.T) {
	r := RedisConfig{Host: "10.0.0.5", Port: 6379}
	addr := r.Addr()
	if addr != "10.0.0.5:6379" {
		t.Errorf("Addr() = %q, want 10.0.0.5:6379", addr)
	}
}

// --- Edge cases for Load() ---

func TestLoadYAMLEmptyFile(t *testing.T) {
	path := writeTempConfig(t, "")
	t.Setenv("AGENTHUB_JWT_SECRET", "empty-file-secret")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error on empty YAML = %v", err)
	}
	if cfg.JWT.Secret != "empty-file-secret" {
		t.Errorf("JWT.Secret = %q, want empty-file-secret", cfg.JWT.Secret)
	}
}

func TestLoadYAMLBareMinimum(t *testing.T) {
	// Only server port configured; everything else is blank/zero.
	yaml := `
server:
  port: 3000
`
	path := writeTempConfig(t, yaml)
	t.Setenv("AGENTHUB_JWT_SECRET", "bare-min-secret")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Server.Port != 3000 {
		t.Errorf("Server.Port = %d, want 3000", cfg.Server.Port)
	}
	if cfg.DB.Host != "" {
		t.Errorf("DB.Host = %q, want empty (not in YAML)", cfg.DB.Host)
	}
}

func TestLoadYAMLEnvVarNotSetForNonSecretField(t *testing.T) {
	// Env var is not set for log_level — should use YAML value.
	path := writeTempConfig(t, validJWTYAML)
	t.Setenv("AGENTHUB_JWT_SECRET", "log-level-secret")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Server.LogLevel != "info" {
		t.Errorf("Server.LogLevel = %q, want info (from YAML, not env)", cfg.Server.LogLevel)
	}
}
