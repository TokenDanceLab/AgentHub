//nolint:gosec // 测试 fixture：凭据模式字符串用于构造测试用例，非真实凭据
package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// writeTempConfig creates a temporary YAML config file and returns its path.
// The caller is responsible for cleaning up.
func writeTempConfig(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
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
	t.Setenv("AGENTHUB_JWT_SECRET", "test-jwt-secret-42-padded-to-32-chars")

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
	if cfg.JWT.Secret != "test-jwt-secret-42-padded-to-32-chars" {
		t.Errorf("JWT.Secret = %q, want %q", cfg.JWT.Secret, "test-jwt-secret-42-padded-to-32-chars")
	}
}

func TestLoadMissingFile(t *testing.T) {
	t.Setenv("AGENTHUB_JWT_SECRET", "some-secret-value-padded-to-32-chars")
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
	t.Setenv("AGENTHUB_JWT_SECRET", "env-secret-override-padded-to-32-chars")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.JWT.Secret != "env-secret-override-padded-to-32-chars" {
		t.Errorf("JWT.Secret = %q, want %q (env var should override file)", cfg.JWT.Secret, "env-secret-override-padded-to-32-chars")
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
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if err := cfg.Validate(); err == nil {
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
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected error for hardcoded default JWT secret, got nil")
	}
}

// TestJWTSecretDocumentedDevPlaceholderRejected covers the publicly-known
// dev placeholder shipped in .env.example
// ("dev-secret-change-in-production-min-length-32", 41 chars). It previously
// bypassed the exact-match blocklist while passing the 32-char minimum,
// letting a public-known secret into production. Prefix matching now rejects
// the whole dev-secret-change-in-production* family.
func TestJWTSecretDocumentedDevPlaceholderRejected(t *testing.T) {
	yaml := `
jwt:
  access_ttl: 15m
  refresh_ttl: 720h
`
	path := writeTempConfig(t, yaml)

	// The exact value documented in .env.example — a public-known secret.
	t.Setenv("AGENTHUB_JWT_SECRET", "dev-secret-change-in-production-min-length-32")
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected error for documented dev placeholder JWT secret (prefix match), got nil")
	}
}

// TestJWTSecretDevPrefixVariantRejected ensures derivatives of the documented
// dev secret (e.g. with an extra suffix to look unique) are still blocked by
// prefix matching.
func TestJWTSecretDevPrefixVariantRejected(t *testing.T) {
	yaml := `
jwt:
  access_ttl: 15m
  refresh_ttl: 720h
`
	path := writeTempConfig(t, yaml)

	t.Setenv("AGENTHUB_JWT_SECRET", "dev-secret-change-in-production-please-rotate-me-now")
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected error for dev-prefixed JWT secret variant, got nil")
	}
}

// TestJWTSecretProdPlaceholderRejected covers the production .env.example
// placeholder "change-me-production-min-length-32-chars" (41 chars). It
// previously bypassed the exact-match blocklist while passing the 32-char
// minimum, letting a public-known secret into production. Prefix matching
// on the change-me-production* family now rejects it.
func TestJWTSecretProdPlaceholderRejected(t *testing.T) {
	yaml := `
jwt:
  access_ttl: 15m
  refresh_ttl: 720h
`
	path := writeTempConfig(t, yaml)

	// The exact value documented in .env.example — a public-known secret.
	t.Setenv("AGENTHUB_JWT_SECRET", "change-me-production-min-length-32-chars")
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected error for production placeholder JWT secret (prefix match), got nil")
	}
}

// TestJWTSecretProdPrefixVariantRejected ensures derivatives of the
// production placeholder (e.g. with an extra suffix to look unique) are
// still blocked by prefix matching.
func TestJWTSecretProdPrefixVariantRejected(t *testing.T) {
	yaml := `
jwt:
  access_ttl: 15m
  refresh_ttl: 720h
`
	path := writeTempConfig(t, yaml)

	t.Setenv("AGENTHUB_JWT_SECRET", "change-me-production-please-rotate-this-now!!")
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected error for prod-prefixed JWT secret variant, got nil")
	}
}

func TestJWTSecretTooShortRejected(t *testing.T) {
	yaml := `
jwt:
  access_ttl: 15m
  refresh_ttl: 720h
`
	path := writeTempConfig(t, yaml)

	// Env var set but too short — must be rejected.
	t.Setenv("AGENTHUB_JWT_SECRET", "too-short-25-chars-test!!")
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected error for JWT secret shorter than 32 chars, got nil")
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
	t.Setenv("AGENTHUB_JWT_SECRET", "real-secret-from-env-padded-to-32-chars")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v, expected success when env var overrides hardcoded default", err)
	}
	if cfg.JWT.Secret != "real-secret-from-env-padded-to-32-chars" {
		t.Errorf("JWT.Secret = %q, want %q", cfg.JWT.Secret, "real-secret-from-env-padded-to-32-chars")
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
	t.Setenv("AGENTHUB_JWT_SECRET", "env-only-secret!!-padded-to-minimum-32-chars..")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.JWT.Secret != "env-only-secret!!-padded-to-minimum-32-chars.." {
		t.Errorf("JWT.Secret = %q, want %q", cfg.JWT.Secret, "env-only-secret!!-padded-to-minimum-32-chars..")
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
	t.Setenv("AGENTHUB_JWT_SECRET", "global-test-secret-padded-to-minimum-32-chars..")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg == nil {
		t.Fatal("Load() returned nil config")
	}
	if cfg.JWT.Secret != "global-test-secret-padded-to-minimum-32-chars.." {
		t.Errorf("JWT.Secret = %q, want %q", cfg.JWT.Secret, "global-test-secret-padded-to-minimum-32-chars..")
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
	t.Setenv("AGENTHUB_JWT_SECRET", "override-secret!!-padded-to-minimum-32-chars..")
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
	t.Setenv("AGENTHUB_JWT_SECRET", "db-override-secret-padded-to-minimum-32-chars..")
	t.Setenv("AGENTHUB_DB_HOST", "env-db-host")
	t.Setenv("AGENTHUB_DB_USER", "env-db-user")
	t.Setenv("AGENTHUB_DB_NAME", "env-db-name")
	t.Setenv("AGENTHUB_DB_APPLICATION_NAME", "agenthub-test")
	t.Setenv("AGENTHUB_DB_MAX_OPEN_CONNS", "3")
	t.Setenv("AGENTHUB_DB_MAX_IDLE_CONNS", "2")
	t.Setenv("AGENTHUB_DB_CONN_MAX_LIFETIME", "45m")
	t.Setenv("AGENTHUB_DB_CONN_MAX_IDLE_TIME", "3m")

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
	if cfg.DB.ApplicationName != "agenthub-test" {
		t.Errorf("DB.ApplicationName = %q, want agenthub-test", cfg.DB.ApplicationName)
	}
	if cfg.DB.MaxOpenConns != 3 || cfg.DB.MaxIdleConns != 2 {
		t.Errorf("DB pool = %d/%d, want 3/2", cfg.DB.MaxOpenConns, cfg.DB.MaxIdleConns)
	}
	if cfg.DB.ConnMaxLifetime != 45*time.Minute || cfg.DB.ConnMaxIdleTime != 3*time.Minute {
		t.Errorf("DB lifetimes = %s/%s, want 45m/3m", cfg.DB.ConnMaxLifetime, cfg.DB.ConnMaxIdleTime)
	}
	// Password was NOT overridden via env — stays from YAML.
	if cfg.DB.Password != "yaml-pass" {
		t.Errorf("DB.Password = %q, want yaml-pass (not overridden)", cfg.DB.Password)
	}
}

func TestEnvOverrideRedisConfig(t *testing.T) {
	path := writeTempConfig(t, validJWTYAML)
	t.Setenv("AGENTHUB_JWT_SECRET", "redis-override-secret-padded-to-minimum-32-chars..")
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
	t.Setenv("AGENTHUB_JWT_SECRET", "upload-override-secret-padded-to-minimum-32-chars..")
	t.Setenv("AGENTHUB_UPLOAD_DIR", "/custom/uploads")
	t.Setenv("AGENTHUB_UPLOAD_MAX_SIZE", "20971520")
	t.Setenv("AGENTHUB_UPLOAD_ALLOWED_MIME_TYPES", "text/plain, application/octet-stream")

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
	if len(cfg.Upload.AllowedMimeTypes) != 2 {
		t.Fatalf("Upload.AllowedMimeTypes len = %d, want 2", len(cfg.Upload.AllowedMimeTypes))
	}
	if cfg.Upload.AllowedMimeTypes[0] != "text/plain" {
		t.Errorf("AllowedMimeTypes[0] = %q, want text/plain", cfg.Upload.AllowedMimeTypes[0])
	}
	if cfg.Upload.AllowedMimeTypes[1] != "application/octet-stream" {
		t.Errorf("AllowedMimeTypes[1] = %q, want application/octet-stream", cfg.Upload.AllowedMimeTypes[1])
	}
}

func TestLoadUploadAllowedMimeTypesDefaultExcludesOctetStream(t *testing.T) {
	path := writeTempConfig(t, validJWTYAML)
	t.Setenv("AGENTHUB_JWT_SECRET", "upload-mime-default-secret-padded-to-minimum-32-chars..")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if len(cfg.Upload.AllowedMimeTypes) == 0 {
		t.Fatal("Upload.AllowedMimeTypes is empty, want default allowlist")
	}
	for _, mimeType := range cfg.Upload.AllowedMimeTypes {
		if mimeType == "application/octet-stream" {
			t.Fatal("default upload MIME allowlist must not include application/octet-stream")
		}
	}
}

func TestEnvOverrideTokenDanceIDCanonicalNames(t *testing.T) {
	path := writeTempConfig(t, validJWTYAML+`
tokendance_id:
  issuer_url: ""
  jwks_uri: ""
  client_id: ""
  client_secret: ""
  redirect_uri: ""
`)
	t.Setenv("AGENTHUB_JWT_SECRET", "tokendance-env-secret-padded-to-minimum-32-chars..")
	t.Setenv("AGENTHUB_TOKENDANCE_ID_ISSUER_URL", "https://id.example")
	t.Setenv("AGENTHUB_TOKENDANCE_ID_JWKS_URI", "https://id.example/oidc/jwks")
	t.Setenv("AGENTHUB_TOKENDANCE_ID_CLIENT_ID", "agenthub-client")
	t.Setenv("AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET", "agenthub-secret")
	t.Setenv("AGENTHUB_TOKENDANCE_ID_REDIRECT_URI", "https://hub.example/client/auth/oidc/callback")
	t.Setenv("AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS", "https://hub.example/auth/tokendance/callback, http://127.0.0.1/callback")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.TokenDanceID.IssuerURL != "https://id.example" {
		t.Errorf("IssuerURL = %q", cfg.TokenDanceID.IssuerURL)
	}
	if cfg.TokenDanceID.JWKSURI != "https://id.example/oidc/jwks" {
		t.Errorf("JWKSURI = %q", cfg.TokenDanceID.JWKSURI)
	}
	if cfg.TokenDanceID.ClientID != "agenthub-client" {
		t.Errorf("ClientID = %q", cfg.TokenDanceID.ClientID)
	}
	if cfg.TokenDanceID.ClientSecret != "agenthub-secret" {
		t.Errorf("ClientSecret = %q", cfg.TokenDanceID.ClientSecret)
	}
	if cfg.TokenDanceID.RedirectURI != "https://hub.example/client/auth/oidc/callback" {
		t.Errorf("RedirectURI = %q", cfg.TokenDanceID.RedirectURI)
	}
	if len(cfg.TokenDanceID.AllowedRedirectURIs) != 2 {
		t.Fatalf("AllowedRedirectURIs len = %d, want 2", len(cfg.TokenDanceID.AllowedRedirectURIs))
	}
	if cfg.TokenDanceID.AllowedRedirectURIs[0] != "https://hub.example/auth/tokendance/callback" {
		t.Errorf("AllowedRedirectURIs[0] = %q", cfg.TokenDanceID.AllowedRedirectURIs[0])
	}
	if cfg.TokenDanceID.AllowedRedirectURIs[1] != "http://127.0.0.1/callback" {
		t.Errorf("AllowedRedirectURIs[1] = %q", cfg.TokenDanceID.AllowedRedirectURIs[1])
	}
}

func TestEnvOverrideTokenDanceIDCanonicalNamesWithoutYAMLSection(t *testing.T) {
	path := writeTempConfig(t, validJWTYAML)
	t.Setenv("AGENTHUB_JWT_SECRET", "tokendance-env-secret-padded-to-minimum-32-chars..")
	t.Setenv("AGENTHUB_TOKENDANCE_ID_ISSUER_URL", "https://id.example")
	t.Setenv("AGENTHUB_TOKENDANCE_ID_CLIENT_ID", "agenthub-client")
	t.Setenv("AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET", "agenthub-secret")
	t.Setenv("AGENTHUB_TOKENDANCE_ID_REDIRECT_URI", "https://hub.example/client/auth/oidc/callback")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.TokenDanceID.IssuerURL != "https://id.example" {
		t.Errorf("IssuerURL = %q", cfg.TokenDanceID.IssuerURL)
	}
	if cfg.TokenDanceID.JWKSURI != "https://id.example/oidc/jwks" {
		t.Errorf("JWKSURI = %q", cfg.TokenDanceID.JWKSURI)
	}
	if cfg.TokenDanceID.ClientID != "agenthub-client" {
		t.Errorf("ClientID = %q", cfg.TokenDanceID.ClientID)
	}
	if cfg.TokenDanceID.ClientSecret != "agenthub-secret" {
		t.Errorf("ClientSecret = %q", cfg.TokenDanceID.ClientSecret)
	}
	if cfg.TokenDanceID.RedirectURI != "https://hub.example/client/auth/oidc/callback" {
		t.Errorf("RedirectURI = %q", cfg.TokenDanceID.RedirectURI)
	}
}

func TestEnvOverrideTokenDanceIDLegacyNamesStillWork(t *testing.T) {
	path := writeTempConfig(t, validJWTYAML+`
tokendance_id:
  issuer_url: ""
  client_id: ""
  client_secret: ""
  redirect_uri: ""
`)
	t.Setenv("AGENTHUB_JWT_SECRET", "tokendance-legacy-secret-padded-to-minimum-32-chars..")
	t.Setenv("AGENTHUB_TOKENDANCE_ISSUER_URL", "https://legacy-id.example")
	t.Setenv("AGENTHUB_TOKENDANCE_CLIENT_ID", "legacy-client")
	t.Setenv("AGENTHUB_TOKENDANCE_CLIENT_SECRET", "legacy-secret")
	t.Setenv("AGENTHUB_TOKENDANCE_REDIRECT_URI", "https://legacy.example/callback")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.TokenDanceID.IssuerURL != "https://legacy-id.example" {
		t.Errorf("IssuerURL = %q", cfg.TokenDanceID.IssuerURL)
	}
	if cfg.TokenDanceID.JWKSURI != "https://legacy-id.example/oidc/jwks" {
		t.Errorf("JWKSURI = %q", cfg.TokenDanceID.JWKSURI)
	}
	if cfg.TokenDanceID.ClientID != "legacy-client" {
		t.Errorf("ClientID = %q", cfg.TokenDanceID.ClientID)
	}
	if cfg.TokenDanceID.ClientSecret != "legacy-secret" {
		t.Errorf("ClientSecret = %q", cfg.TokenDanceID.ClientSecret)
	}
	if cfg.TokenDanceID.RedirectURI != "https://legacy.example/callback" {
		t.Errorf("RedirectURI = %q", cfg.TokenDanceID.RedirectURI)
	}
}

func TestLoadAgentTeamGuardrailDefaults(t *testing.T) {
	path := writeTempConfig(t, validJWTYAML)
	t.Setenv("AGENTHUB_JWT_SECRET", "agent-team-default-secret-padded-to-minimum-32-chars..")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.AgentTeam.MaxDelegationDepth != 3 {
		t.Errorf("MaxDelegationDepth = %d, want 3", cfg.AgentTeam.MaxDelegationDepth)
	}
	if cfg.AgentTeam.MaxActiveSubAgentsPerRun != 5 {
		t.Errorf("MaxActiveSubAgentsPerRun = %d, want 5", cfg.AgentTeam.MaxActiveSubAgentsPerRun)
	}
	if cfg.AgentTeam.MaxRouteRepeats != 3 {
		t.Errorf("MaxRouteRepeats = %d, want 3", cfg.AgentTeam.MaxRouteRepeats)
	}
	if cfg.AgentTeam.MaxTasksPerTeamRun != 20 {
		t.Errorf("MaxTasksPerTeamRun = %d, want 20", cfg.AgentTeam.MaxTasksPerTeamRun)
	}
	if cfg.AgentTeam.AssignmentTimeout != 30*time.Minute {
		t.Errorf("AssignmentTimeout = %s, want 30m", cfg.AgentTeam.AssignmentTimeout)
	}
	if cfg.AgentTeam.MaxTeamRunBudgetTokens != 200_000 {
		t.Errorf("MaxTeamRunBudgetTokens = %d, want 200000", cfg.AgentTeam.MaxTeamRunBudgetTokens)
	}
	if cfg.AgentTeam.MaxTeamRunBudgetUsagePct != 95 {
		t.Errorf("MaxTeamRunBudgetUsagePct = %f, want 95", cfg.AgentTeam.MaxTeamRunBudgetUsagePct)
	}
}

func TestEnvOverrideAgentTeamGuardrails(t *testing.T) {
	path := writeTempConfig(t, validJWTYAML)
	t.Setenv("AGENTHUB_JWT_SECRET", "agent-team-env-secret-padded-to-minimum-32-chars..")
	t.Setenv("AGENTHUB_AGENT_TEAM_MAX_DELEGATION_DEPTH", "2")
	t.Setenv("AGENTHUB_AGENT_TEAM_MAX_ACTIVE_SUBAGENTS_PER_RUN", "3")
	t.Setenv("AGENTHUB_AGENT_TEAM_MAX_ROUTE_REPEATS", "4")
	t.Setenv("AGENTHUB_AGENT_TEAM_MAX_TASKS_PER_TEAM_RUN", "7")
	t.Setenv("AGENTHUB_AGENT_TEAM_ASSIGNMENT_TIMEOUT", "45m")
	t.Setenv("AGENTHUB_AGENT_TEAM_MAX_TEAM_RUN_BUDGET_TOKENS", "12345")
	t.Setenv("AGENTHUB_AGENT_TEAM_MAX_TEAM_RUN_BUDGET_USAGE_PCT", "80.5")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.AgentTeam.MaxDelegationDepth != 2 {
		t.Errorf("MaxDelegationDepth = %d, want 2", cfg.AgentTeam.MaxDelegationDepth)
	}
	if cfg.AgentTeam.MaxActiveSubAgentsPerRun != 3 {
		t.Errorf("MaxActiveSubAgentsPerRun = %d, want 3", cfg.AgentTeam.MaxActiveSubAgentsPerRun)
	}
	if cfg.AgentTeam.MaxRouteRepeats != 4 {
		t.Errorf("MaxRouteRepeats = %d, want 4", cfg.AgentTeam.MaxRouteRepeats)
	}
	if cfg.AgentTeam.MaxTasksPerTeamRun != 7 {
		t.Errorf("MaxTasksPerTeamRun = %d, want 7", cfg.AgentTeam.MaxTasksPerTeamRun)
	}
	if cfg.AgentTeam.AssignmentTimeout != 45*time.Minute {
		t.Errorf("AssignmentTimeout = %s, want 45m", cfg.AgentTeam.AssignmentTimeout)
	}
	if cfg.AgentTeam.MaxTeamRunBudgetTokens != 12345 {
		t.Errorf("MaxTeamRunBudgetTokens = %d, want 12345", cfg.AgentTeam.MaxTeamRunBudgetTokens)
	}
	if cfg.AgentTeam.MaxTeamRunBudgetUsagePct != 80.5 {
		t.Errorf("MaxTeamRunBudgetUsagePct = %f, want 80.5", cfg.AgentTeam.MaxTeamRunBudgetUsagePct)
	}
}

func TestValidateRejectsInvalidAgentTeamGuardrails(t *testing.T) {
	cfg := &Config{
		DB: DBConfig{
			Host:            "localhost",
			Port:            5432,
			User:            "agenthub",
			Name:            "agenthub",
			MaxOpenConns:    2,
			MaxIdleConns:    1,
			ConnMaxLifetime: 30 * time.Minute,
			ConnMaxIdleTime: 5 * time.Minute,
		},
		Redis: RedisConfig{
			Host: "localhost",
			Port: 6379,
		},
		JWT: JWTConfig{
			Secret: "strong-agenthub-secret-padded-to-minimum-32-chars..",
		},
		AgentTeam: AgentTeamConfig{
			MaxDelegationDepth: -1,
		},
	}

	err := cfg.Validate()
	if err == nil {
		t.Fatal("expected invalid AgentTeam guardrail to be rejected")
	}
	if !strings.Contains(err.Error(), "agent_team.max_delegation_depth") {
		t.Fatalf("Validate() error = %q, want agent_team.max_delegation_depth", err.Error())
	}
}

func TestValidateTokenDanceIDRequiresRedirectURI(t *testing.T) {
	cfg := &Config{
		DB: DBConfig{
			Host:            "localhost",
			Port:            5432,
			User:            "agenthub",
			Name:            "agenthub",
			MaxOpenConns:    2,
			MaxIdleConns:    1,
			ConnMaxLifetime: 30 * time.Minute,
			ConnMaxIdleTime: 5 * time.Minute,
		},
		Redis: RedisConfig{
			Host: "localhost",
			Port: 6379,
		},
		JWT: JWTConfig{
			Secret: "strong-agenthub-secret-padded-to-minimum-32-chars..",
		},
		TokenDanceID: TokenDanceIDConfig{
			IssuerURL:    "https://id.example",
			ClientID:     "agenthub-client",
			ClientSecret: "agenthub-secret",
		},
	}

	err := cfg.Validate()
	if err == nil {
		t.Fatal("expected missing TokenDance ID redirect URI to be rejected")
	}
	if !strings.Contains(err.Error(), "tokendance_id.redirect_uri") {
		t.Fatalf("Validate() error = %q, want tokendance_id.redirect_uri", err.Error())
	}
}

func TestValidateTokenDanceIDRejectsShortClientSecret(t *testing.T) {
	cfg := &Config{
		DB: DBConfig{
			Host:            "localhost",
			Port:            5432,
			User:            "agenthub",
			Name:            "agenthub",
			MaxOpenConns:    2,
			MaxIdleConns:    1,
			ConnMaxLifetime: 30 * time.Minute,
			ConnMaxIdleTime: 5 * time.Minute,
		},
		Redis: RedisConfig{Host: "localhost", Port: 6379},
		JWT: JWTConfig{
			Secret: "strong-agenthub-secret-padded-to-minimum-32-chars..",
		},
		TokenDanceID: TokenDanceIDConfig{
			IssuerURL:    "https://id.example",
			ClientID:     "agenthub-client",
			ClientSecret: "short-but-present-secret",
			RedirectURI:  "http://127.0.0.1/callback",
		},
	}

	err := cfg.Validate()
	if err == nil {
		t.Fatal("expected short TokenDance ID client secret to be rejected")
	}
	if !strings.Contains(err.Error(), "tokendance_id.client_secret too short") {
		t.Fatalf("Validate() error = %q, want tokendance_id.client_secret too short", err.Error())
	}
}

func TestValidateTokenDanceIDRejectsSeedSecret(t *testing.T) {
	cfg := &Config{
		DB: DBConfig{
			Host:            "localhost",
			Port:            5432,
			User:            "agenthub",
			Name:            "agenthub",
			MaxOpenConns:    2,
			MaxIdleConns:    1,
			ConnMaxLifetime: 30 * time.Minute,
			ConnMaxIdleTime: 5 * time.Minute,
		},
		Redis: RedisConfig{Host: "localhost", Port: 6379},
		JWT: JWTConfig{
			Secret: "strong-agenthub-secret-padded-to-minimum-32-chars..",
		},
		TokenDanceID: TokenDanceIDConfig{
			IssuerURL:    "https://id.example",
			ClientID:     "agenthub-client",
			ClientSecret: "agenthub-dev-secret-change-me-padded-to-32!!",
			RedirectURI:  "http://127.0.0.1/callback",
		},
	}

	err := cfg.Validate()
	if err == nil {
		t.Fatal("expected seed SQL TokenDance ID client secret to be rejected")
	}
	if !strings.Contains(err.Error(), "tokendance_id.client_secret must be a strong") {
		t.Fatalf("Validate() error = %q, want tokendance_id.client_secret must be a strong", err.Error())
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
	t.Setenv("AGENTHUB_JWT_SECRET", "empty-file-secret-padded-to-minimum-32-chars..")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error on empty YAML = %v", err)
	}
	if cfg.JWT.Secret != "empty-file-secret-padded-to-minimum-32-chars.." {
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
	t.Setenv("AGENTHUB_JWT_SECRET", "bare-min-secret!!-padded-to-minimum-32-chars..")

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
	t.Setenv("AGENTHUB_JWT_SECRET", "log-level-secret-padded-to-minimum-32-chars..")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Server.LogLevel != "info" {
		t.Errorf("Server.LogLevel = %q, want info (from YAML, not env)", cfg.Server.LogLevel)
	}
}

// #101: Reject known hardcoded JWT secrets in production.
func TestJWTSecretKnownHardcodedRejected(t *testing.T) {
	knownHardcoded := []string{
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
	for _, secret := range knownHardcoded {
		t.Run("secret="+secret, func(t *testing.T) {
			yaml := `
jwt:
  secret: ` + secret + `
  access_ttl: 15m
  refresh_ttl: 720h
`
			path := writeTempConfig(t, yaml)
			// No env var set — hardcoded value should be rejected.
			cfg, err := Load(path)
			if err != nil {
				t.Fatalf("Load() error = %v", err)
			}
			if err := cfg.Validate(); err == nil {
				t.Errorf("expected error for hardcoded JWT secret %q, got nil", secret)
			}
		})
	}
}

// #101: Known hardcoded secret overridden by env var should pass.
func TestJWTSecretHardcodedOverriddenByEnv(t *testing.T) {
	yaml := `
server:
  port: 8080
db:
  host: localhost
  port: 5432
  user: agenthub
  name: agenthub
redis:
  host: localhost
  port: 6379
jwt:
  secret: dev-secret
  access_ttl: 15m
  refresh_ttl: 720h
`
	path := writeTempConfig(t, yaml)
	t.Setenv("AGENTHUB_JWT_SECRET", "real-production-secret!!-padded-to-minimum-32-chars..")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.JWT.Secret != "real-production-secret!!-padded-to-minimum-32-chars.." {
		t.Errorf("JWT.Secret = %q, want real-production-secret!! (env override)", cfg.JWT.Secret)
	}
	// Validate should pass because env var overrides the hardcoded value.
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate() error = %v, expected success when env overrides hardcoded", err)
	}
}
func TestS3Config_IsConfigured(t *testing.T) {
	tests := []struct {
		name   string
		cfg    S3Config
		expect bool
	}{
		{"empty", S3Config{}, false},
		{"endpoint only", S3Config{Endpoint: "https://s3.example.com"}, false},
		{"bucket only", S3Config{Bucket: "my-bucket"}, false},
		{"both set", S3Config{Endpoint: "https://s3.example.com", Bucket: "my-bucket"}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.cfg.IsConfigured()
			if got != tt.expect {
				t.Errorf("IsConfigured() = %v, want %v", got, tt.expect)
			}
		})
	}
}

func TestS3Config_IsEmpty(t *testing.T) {
	var cfg S3Config
	if cfg.IsConfigured() {
		t.Error("zero-value S3Config should report IsConfigured() == false")
	}
}

func TestEnvOverrideS3Config(t *testing.T) {
	path := writeTempConfig(t, validJWTYAML)
	t.Setenv("AGENTHUB_JWT_SECRET", "s3-env-secret!!-padded-to-minimum-32-chars..")
	t.Setenv("AGENTHUB_S3_ENDPOINT", "https://r2.example.com")
	t.Setenv("AGENTHUB_S3_ACCESS_KEY", "access-key")
	t.Setenv("AGENTHUB_S3_SECRET_KEY", "secret-key")
	t.Setenv("AGENTHUB_S3_BUCKET", "agenthub-attachments")
	t.Setenv("AGENTHUB_S3_REGION", "auto")
	t.Setenv("AGENTHUB_S3_USE_SSL", "true")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.S3.Endpoint != "https://r2.example.com" {
		t.Errorf("S3.Endpoint = %q", cfg.S3.Endpoint)
	}
	if cfg.S3.AccessKey != "access-key" {
		t.Errorf("S3.AccessKey = %q", cfg.S3.AccessKey)
	}
	if cfg.S3.SecretKey != "secret-key" {
		t.Errorf("S3.SecretKey = %q", cfg.S3.SecretKey)
	}
	if cfg.S3.Bucket != "agenthub-attachments" {
		t.Errorf("S3.Bucket = %q", cfg.S3.Bucket)
	}
	if cfg.S3.Region != "auto" {
		t.Errorf("S3.Region = %q", cfg.S3.Region)
	}
	if !cfg.S3.UseSSL {
		t.Error("S3.UseSSL = false, want true")
	}
}

func TestValidateS3ConfigRequiresCompleteCredentials(t *testing.T) {
	cfg := &Config{
		DB: DBConfig{
			Host:            "localhost",
			Port:            5432,
			User:            "agenthub",
			Name:            "agenthub",
			MaxOpenConns:    2,
			MaxIdleConns:    1,
			ConnMaxLifetime: 30 * time.Minute,
			ConnMaxIdleTime: 5 * time.Minute,
		},
		Redis: RedisConfig{
			Host: "localhost",
			Port: 6379,
		},
		JWT: JWTConfig{
			Secret: "strong-s3-secret!!padded-to-minimum-32-chars..",
		},
		S3: S3Config{
			Endpoint: "https://r2.example.com",
			Bucket:   "agenthub-attachments",
		},
	}

	err := cfg.Validate()
	if err == nil {
		t.Fatal("expected incomplete S3 credentials to be rejected")
	}
	if !strings.Contains(err.Error(), "s3.access_key") {
		t.Fatalf("Validate() error = %q, want s3.access_key", err.Error())
	}
}

func TestValidateS3ConfigDoesNotRequireLocalUploadDir(t *testing.T) {
	cfg := &Config{
		DB: DBConfig{
			Host:            "localhost",
			Port:            5432,
			User:            "agenthub",
			Name:            "agenthub",
			MaxOpenConns:    2,
			MaxIdleConns:    1,
			ConnMaxLifetime: 30 * time.Minute,
			ConnMaxIdleTime: 5 * time.Minute,
		},
		Redis: RedisConfig{
			Host: "localhost",
			Port: 6379,
		},
		JWT: JWTConfig{
			Secret: "strong-s3-secret!!padded-to-minimum-32-chars..",
		},
		Upload: UploadConfig{
			Dir: filepath.Join(t.TempDir(), "missing"),
		},
		S3: S3Config{
			Endpoint:  "https://r2.example.com",
			AccessKey: "access-key",
			SecretKey: "secret-key",
			Bucket:    "agenthub-attachments",
		},
	}

	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate() error = %v, want nil when S3 is configured", err)
	}
}

func TestRateLimitFailOpen(t *testing.T) {
	t.Run("defaults to true when env not set", func(t *testing.T) {
		if !RateLimitFailOpen() {
			t.Error("RateLimitFailOpen() should default to true")
		}
	})

	t.Run("true for truthy values", func(t *testing.T) {
		for _, v := range []string{"true", "1", "yes", "anything-else"} {
			t.Setenv("AGENTHUB_RATE_LIMIT_FAIL_OPEN", v)
			if !RateLimitFailOpen() {
				t.Errorf("RateLimitFailOpen() = false for env value %q, want true", v)
			}
		}
	})

	t.Run("false for falsy values", func(t *testing.T) {
		for _, v := range []string{"false", "0", "no", "off", "FALSE", "NO"} {
			t.Setenv("AGENTHUB_RATE_LIMIT_FAIL_OPEN", v)
			if RateLimitFailOpen() {
				t.Errorf("RateLimitFailOpen() = true for env value %q, want false", v)
			}
		}
	})

	t.Run("defaults to true when env is empty", func(t *testing.T) {
		t.Setenv("AGENTHUB_RATE_LIMIT_FAIL_OPEN", "")
		if !RateLimitFailOpen() {
			t.Error("RateLimitFailOpen() should default to true when env is empty")
		}
	})
}

func TestAuthFailClosed(t *testing.T) {
	t.Run("defaults to false when env not set", func(t *testing.T) {
		t.Setenv("AGENTHUB_AUTH_FAIL_CLOSED", "")
		if AuthFailClosed() {
			t.Error("AuthFailClosed() should default to false")
		}
	})

	t.Run("true for truthy values", func(t *testing.T) {
		for _, v := range []string{"true", "1", "yes", "on", "TRUE", "Yes", "ON"} {
			t.Setenv("AGENTHUB_AUTH_FAIL_CLOSED", v)
			if !AuthFailClosed() {
				t.Errorf("AuthFailClosed() = false for env value %q, want true", v)
			}
		}
	})

	t.Run("false for falsy values", func(t *testing.T) {
		for _, v := range []string{"false", "0", "no", "off", "anything-else", ""} {
			t.Setenv("AGENTHUB_AUTH_FAIL_CLOSED", v)
			if AuthFailClosed() {
				t.Errorf("AuthFailClosed() = true for env value %q, want false", v)
			}
		}
	})
}

func TestEnvOverrideEdgeDispatchConfig(t *testing.T) {
	path := writeTempConfig(t, validJWTYAML)
	t.Setenv("AGENTHUB_JWT_SECRET", "edge-override-secret-padded-to-minimum-32-chars")
	t.Setenv("AGENTHUB_EDGE_URL", "http://127.0.0.1:3210")
	t.Setenv("AGENTHUB_EDGE_AUTH_TOKEN", "env-edge-token")
	t.Setenv("AGENTHUB_EDGE_DEVICE_ID", "env-device-1")
	t.Setenv("AGENTHUB_EDGE_TIMEOUT", "7s")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Edge.URL != "http://127.0.0.1:3210" {
		t.Errorf("Edge.URL = %q, want env value", cfg.Edge.URL)
	}
	if cfg.Edge.AuthToken != "env-edge-token" {
		t.Errorf("Edge.AuthToken = %q, want env value", cfg.Edge.AuthToken)
	}
	if cfg.Edge.DeviceID != "env-device-1" {
		t.Errorf("Edge.DeviceID = %q, want env value", cfg.Edge.DeviceID)
	}
	if cfg.Edge.Timeout != 7*time.Second {
		t.Errorf("Edge.Timeout = %v, want 7s", cfg.Edge.Timeout)
	}
}

func TestEdgeDispatchTimeoutDefault(t *testing.T) {
	path := writeTempConfig(t, validJWTYAML)
	t.Setenv("AGENTHUB_JWT_SECRET", "edge-default-secret-padded-to-minimum-32-chars")
	t.Setenv("AGENTHUB_EDGE_URL", "http://127.0.0.1:3210")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Edge.Timeout != 10*time.Second {
		t.Errorf("Edge.Timeout = %v, want default 10s", cfg.Edge.Timeout)
	}
}
