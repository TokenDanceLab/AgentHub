package lifecycle

import (
	"os"
	"runtime"
	"strings"
	"testing"
)

// --- SanitizedEnv tests ---

func TestSanitizedEnvReturnsMinimalSet(t *testing.T) {
	parentCount := len(os.Environ())
	env, _ := SanitizedEnv(nil, nil)

	// Sanitized output should be substantially smaller than the full parent env.
	if len(env) >= parentCount {
		t.Fatalf("SanitizedEnv returned %d vars, want fewer than parent (%d)", len(env), parentCount)
	}
}

func TestSanitizedEnvIncludesWhitelistedVars(t *testing.T) {
	// Set a known whitelisted var so we can detect it.
	t.Setenv("LANG", "en_US.UTF-8")

	env, _ := SanitizedEnv(nil, nil)
	envMap := envToMap(env)

	whitelisted := []string{"PATH", "HOME", "USER", "LANG"}
	found := 0
	for _, key := range whitelisted {
		if _, ok := envMap[key]; ok {
			found++
		}
	}
	if found == 0 {
		t.Errorf("SanitizedEnv included none of %v — whitelisted vars should pass through", whitelisted)
	}
	t.Logf("found %d/%d whitelisted vars", found, len(whitelisted))
}

func TestSanitizedEnvExcludesSensitiveVars(t *testing.T) {
	t.Setenv("MY_API_KEY", "secret-123")
	t.Setenv("DB_PASSWORD", "secret-456")
	t.Setenv("ANTHROPIC_API_KEY", "sk-ant-secret")

	env, _ := SanitizedEnv(nil, nil)
	envMap := envToMap(env)

	sensitive := []string{"MY_API_KEY", "DB_PASSWORD", "ANTHROPIC_API_KEY"}
	for _, key := range sensitive {
		if _, ok := envMap[key]; ok {
			t.Errorf("sensitive var %q leaked into sanitized env (should be filtered)", key)
		}
	}
}

func TestSanitizedEnvExcludesGitConfigPathVars(t *testing.T) {
	t.Setenv("GIT_CONFIG_GLOBAL", "/tmp/gitconfig-with-credential-helper")
	t.Setenv("GIT_CONFIG_SYSTEM", "/tmp/system-gitconfig-with-url-rewrite")

	env, _ := SanitizedEnv(nil, nil)
	envMap := envToMap(env)

	for _, key := range []string{"GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM"} {
		if _, ok := envMap[key]; ok {
			t.Errorf("Git config path var %q leaked into sanitized env", key)
		}
	}
}

func TestSanitizedEnvIncludesExtraEnv(t *testing.T) {
	extra := []string{
		"ANTHROPIC_API_KEY=sk-ant-test",
		"OPENAI_API_KEY=sk-test-key",
		"CUSTOM_CONFIG_PATH=/opt/myapp/config",
	}
	env, _ := SanitizedEnv(nil, extra)
	envMap := envToMap(env)

	want := map[string]string{
		"ANTHROPIC_API_KEY":  "sk-ant-test",
		"OPENAI_API_KEY":     "sk-test-key",
		"CUSTOM_CONFIG_PATH": "/opt/myapp/config",
	}
	for k, v := range want {
		got, ok := envMap[k]
		if !ok {
			t.Errorf("extra env %q not found in sanitized env (should be included)", k)
		} else if got != v {
			t.Errorf("extra env %q = %q, want %q", k, got, v)
		}
	}
}

func TestSanitizedEnvIncludesNonSensitiveAgentHubVars(t *testing.T) {
	t.Setenv("AGENTHUB_RUN_ID", "run_test")
	t.Setenv("AGENTHUB_PROJECT_ID", "proj_test")
	t.Setenv("AGENTHUB_THREAD_ID", "thread_test")
	// AGENTHUB_CUSTOM_SETTING is NOT in the explicit inherited allowlist and
	// should NOT pass through from the parent environment.
	t.Setenv("AGENTHUB_CUSTOM_SETTING", "custom-value")

	env, _ := SanitizedEnv(nil, nil)
	envMap := envToMap(env)

	// Explicitly approved inherited AGENTHUB_* vars pass through.
	for _, key := range []string{"AGENTHUB_RUN_ID", "AGENTHUB_PROJECT_ID", "AGENTHUB_THREAD_ID"} {
		if _, ok := envMap[key]; !ok {
			t.Errorf("safe inherited AGENTHUB_* var %q not in sanitized env", key)
		}
	}
	// Non-allowlisted AGENTHUB_* var should NOT pass through from inherited env.
	if _, ok := envMap["AGENTHUB_CUSTOM_SETTING"]; ok {
		t.Errorf("non-allowlisted AGENTHUB_* var AGENTHUB_CUSTOM_SETTING leaked into sanitized env (should be filtered from inherited env)")
	}
}

func TestSanitizedEnvExcludesSensitiveAgentHubVars(t *testing.T) {
	t.Setenv("AGENTHUB_RUN_ID", "run_test")
	t.Setenv("AGENTHUB_EDGE_AUTH_TOKEN", "edge-token")
	t.Setenv("AGENTHUB_HUB_TOKEN", "hub-token")
	t.Setenv("AGENTHUB_TOKEN", "token")
	t.Setenv("AGENTHUB_JWT_SECRET", "jwt-secret")
	t.Setenv("AGENTHUB_SECRET", "secret")
	t.Setenv("AGENTHUB_DB_PASSWORD", "db-password")
	t.Setenv("AGENTHUB_PASSWORD", "password")

	env, _ := SanitizedEnv(nil, nil)
	envMap := envToMap(env)

	if got := envMap["AGENTHUB_RUN_ID"]; got != "run_test" {
		t.Fatalf("AGENTHUB_RUN_ID = %q, want run_test", got)
	}
	for _, key := range []string{
		"AGENTHUB_EDGE_AUTH_TOKEN",
		"AGENTHUB_HUB_TOKEN",
		"AGENTHUB_TOKEN",
		"AGENTHUB_JWT_SECRET",
		"AGENTHUB_SECRET",
		"AGENTHUB_DB_PASSWORD",
		"AGENTHUB_PASSWORD",
	} {
		if _, ok := envMap[key]; ok {
			t.Errorf("sensitive AGENTHUB_* var %q leaked into sanitized env", key)
		}
	}
}

func TestSanitizedEnvRespectsExplicitProfileEnv(t *testing.T) {
	// When profileEnv is non-nil, it passes through verbatim (not filtered).
	profileEnv := []string{
		"CUSTOM_VAR=hello",
		"MY_CUSTOM_SECRET_TOKEN=should-pass-through",
	}
	extraEnv := []string{"EXTRA_VAR=world"}

	env, _ := SanitizedEnv(profileEnv, extraEnv)
	envMap := envToMap(env)

	if envMap["CUSTOM_VAR"] != "hello" {
		t.Errorf("profile env CUSTOM_VAR = %q, want hello", envMap["CUSTOM_VAR"])
	}
	if envMap["MY_CUSTOM_SECRET_TOKEN"] != "should-pass-through" {
		t.Errorf("profile env MY_CUSTOM_SECRET_TOKEN = %q, want should-pass-through", envMap["MY_CUSTOM_SECRET_TOKEN"])
	}
	if envMap["EXTRA_VAR"] != "world" {
		t.Errorf("extra env EXTRA_VAR = %q, want world", envMap["EXTRA_VAR"])
	}
}

func TestSanitizedEnvIncludesWindowsSpecificVars(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows-specific test")
	}
	// On Windows, SystemRoot, TEMP, USERPROFILE must be present.
	env, _ := SanitizedEnv(nil, nil)
	envMap := envToMap(env)

	wantVars := map[string]bool{"systemroot": true, "temp": true, "userprofile": true}
	for key := range envMap {
		if wantVars[strings.ToLower(key)] {
			delete(wantVars, strings.ToLower(key))
		}
	}
	for key := range wantVars {
		t.Errorf("Windows var %q not found in sanitized env (must be whitelisted)", key)
	}
}

// TestEnvFilterAudit_KnownMixCounts verifies that EnvFilterAudit counts correctly
// reflect a known mix of sensitive, whitelisted, and unknown env vars. It also
// validates that the sanitized output includes only whitelisted vars from the
// known set and that FilteredKeys contains only key names, never values.
func TestEnvFilterAudit_KnownMixCounts(t *testing.T) {
	// ── Set a known mix of env vars ──

	// Sensitive (should be filtered as SensitiveVars)
	sensitiveVars := []string{
		"ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GITHUB_TOKEN",
		"JWT_SECRET", "DATABASE_URL", "KUBECONFIG",
		"MY_PRIVATE_KEY", "DB_PASSWORD",
	}
	for _, k := range sensitiveVars {
		t.Setenv(k, "secret-placeholder-value")
	}

	// Whitelisted (should pass through)
	whitelistedVars := []string{
		"LANG", "EDITOR", "GOPATH", "SSH_AUTH_SOCK",
		"NO_COLOR", "PWD", "CARGO_HOME",
	}
	for _, k := range whitelistedVars {
		t.Setenv(k, "known-value")
	}

	// Unknown / not whitelisted (should be filtered as NotWhitelisted)
	unknownVars := []string{
		"MY_CUSTOM_VAR", "RANDOM_APP_SETTING",
		"UNDEFINED_TOOL_CONFIG", "SOME_INTERNAL_FLAG",
		"LOCAL_DEV_MODE",
	}
	for _, k := range unknownVars {
		t.Setenv(k, "some-value")
	}

	// ── Sanitize ──

	env, audit := SanitizedEnv(nil, nil)
	envMap := envToMap(env)

	// ── Verify audit counts (lower bounds — parent env has its own vars too) ──

	if audit.SensitiveVars < len(sensitiveVars) {
		t.Errorf("SensitiveVars = %d, want >= %d", audit.SensitiveVars, len(sensitiveVars))
	}
	if audit.NotWhitelisted < len(unknownVars) {
		t.Errorf("NotWhitelisted = %d, want >= %d", audit.NotWhitelisted, len(unknownVars))
	}
	if audit.PassedVars < len(whitelistedVars) {
		t.Errorf("PassedVars = %d, want >= %d", audit.PassedVars, len(whitelistedVars))
	}
	if audit.TotalVars < len(sensitiveVars)+len(whitelistedVars)+len(unknownVars) {
		t.Errorf("TotalVars = %d, want >= %d", audit.TotalVars,
			len(sensitiveVars)+len(whitelistedVars)+len(unknownVars))
	}

	// Invariant: TotalVars == SensitiveVars + NotWhitelisted + PassedVars
	expectedPassed := audit.TotalVars - audit.SensitiveVars - audit.NotWhitelisted
	if audit.PassedVars != expectedPassed {
		t.Errorf("PassedVars = %d, want %d (total=%d - sensitive=%d - not_whitelisted=%d)",
			audit.PassedVars, expectedPassed, audit.TotalVars, audit.SensitiveVars, audit.NotWhitelisted)
	}

	// ── Verify output env: whitelisted vars present, sensitive + unknown absent ──

	for _, k := range whitelistedVars {
		if _, ok := envMap[k]; !ok {
			t.Errorf("whitelisted var %q not found in sanitized env (should pass through)", k)
		}
	}
	for _, k := range sensitiveVars {
		if _, ok := envMap[k]; ok {
			t.Errorf("sensitive var %q leaked into sanitized env", k)
		}
	}
	for _, k := range unknownVars {
		if _, ok := envMap[k]; ok {
			t.Errorf("unknown/not-whitelisted var %q leaked into sanitized env", k)
		}
	}

	// ── Verify FilteredKeys: contains expected keys by name, never values ──

	expectedFiltered := make(map[string]bool)
	for _, k := range sensitiveVars {
		expectedFiltered[k] = false
	}
	for _, k := range unknownVars {
		expectedFiltered[k] = false
	}
	for _, key := range audit.FilteredKeys {
		if _, expected := expectedFiltered[key]; expected {
			expectedFiltered[key] = true
		}
		// Guard: FilteredKeys must never contain value data.
		if strings.Contains(key, "=") {
			t.Errorf("FilteredKeys contains value data (has '='): %q", key)
		}
		if strings.Contains(key, "secret") || strings.Contains(key, "placeholder") {
			t.Errorf("FilteredKeys appears to contain a value, not a key name: %q", key)
		}
	}
	for key, found := range expectedFiltered {
		if !found {
			t.Errorf("FilteredKeys missing expected key %q", key)
		}
	}
}

// It validates that:
//  1. Only explicitly approved AGENTHUB_* vars pass through from inherited env.
//  2. Non-allowlisted AGENTHUB_* vars are blocked from inherited env.
//  3. Sensitive vars (JWT_SECRET, REDIS_PASSWORD, etc.) are always blocked.
//  4. Profile env (explicitly configured) is distinct from inherited env —
//     it passes through verbatim while inherited env is strictly filtered.
func TestEnvAllowlist(t *testing.T) {
	t.Run("explicit safe AGENTHUB vars inherited", func(t *testing.T) {
		t.Setenv("AGENTHUB_RUN_ID", "inherited-run-123")
		t.Setenv("AGENTHUB_PROJECT_ID", "inherited-proj-456")
		t.Setenv("AGENTHUB_THREAD_ID", "inherited-thread-789")

		env, _ := SanitizedEnv(nil, nil)
		envMap := envToMap(env)

		allowed := []string{"AGENTHUB_RUN_ID", "AGENTHUB_PROJECT_ID", "AGENTHUB_THREAD_ID"}
		for _, key := range allowed {
			if _, ok := envMap[key]; !ok {
				t.Errorf("safe inherited AGENTHUB var %q not in sanitized env", key)
			}
		}
	})

	t.Run("non-allowlisted AGENTHUB vars blocked from inherited env", func(t *testing.T) {
		// These AGENTHUB_* vars are NOT in the explicit inherited allowlist
		// and should NOT leak from the parent process into child agent env.
		t.Setenv("AGENTHUB_DB_URL", "postgres://localhost/agenthub")
		t.Setenv("AGENTHUB_INTERNAL_PORT", "9999")
		t.Setenv("AGENTHUB_ADMIN_TOKEN", "admin-secret-token")
		t.Setenv("AGENTHUB_CUSTOM_SETTING", "some-value")

		env, _ := SanitizedEnv(nil, nil)
		envMap := envToMap(env)

		blocked := []string{
			"AGENTHUB_DB_URL",
			"AGENTHUB_INTERNAL_PORT",
			"AGENTHUB_ADMIN_TOKEN",
			"AGENTHUB_CUSTOM_SETTING",
		}
		for _, key := range blocked {
			if _, ok := envMap[key]; ok {
				t.Errorf("non-allowlisted AGENTHUB var %q leaked into sanitized env (should be filtered from inherited env)", key)
			}
		}
	})

	t.Run("sensitive AGENTHUB vars blocked from inherited env", func(t *testing.T) {
		// Sensitive-looking AGENTHUB_* vars must be blocked regardless of allowlist.
		// IsSensitiveEnvKey catches these before isWhitelistedEnvKey is consulted.
		t.Setenv("AGENTHUB_JWT_SECRET", "jwt-secret-value")
		t.Setenv("AGENTHUB_REDIS_PASSWORD", "redis-pass")
		t.Setenv("AGENTHUB_HUB_TOKEN", "hub-token-value")
		t.Setenv("AGENTHUB_EDGE_AUTH_TOKEN", "edge-auth-token")
		t.Setenv("AGENTHUB_DB_PASSWORD", "db-password")
		t.Setenv("AGENTHUB_ENCRYPTION_KEY", "enc-key")
		t.Setenv("AGENTHUB_SECRET", "some-secret")

		env, _ := SanitizedEnv(nil, nil)
		envMap := envToMap(env)

		sensitive := []string{
			"AGENTHUB_JWT_SECRET",
			"AGENTHUB_REDIS_PASSWORD",
			"AGENTHUB_HUB_TOKEN",
			"AGENTHUB_EDGE_AUTH_TOKEN",
			"AGENTHUB_DB_PASSWORD",
			"AGENTHUB_ENCRYPTION_KEY",
			"AGENTHUB_SECRET",
		}
		for _, key := range sensitive {
			if _, ok := envMap[key]; ok {
				t.Errorf("sensitive AGENTHUB var %q leaked into sanitized env", key)
			}
		}
	})

	t.Run("profile env distinct from inherited env", func(t *testing.T) {
		// Profile env: explicitly configured by administrator, passes verbatim.
		// Inherited env: filtered aggressively via explicit allowlist.
		//
		// Set up inherited env with vars that should be blocked.
		t.Setenv("AGENTHUB_DB_URL", "inherited-db-url")
		t.Setenv("AGENTHUB_CUSTOM_SETTING", "inherited-custom")

		// Profile env explicitly sets the same vars — should pass through.
		profileEnv := []string{
			"AGENTHUB_DB_URL=custom-db-url",
			"AGENTHUB_CUSTOM_SETTING=custom-value",
		}

		env, _ := SanitizedEnv(profileEnv, nil)
		envMap := envToMap(env)

		// Profile env vars pass through verbatim because the administrator
		// explicitly configured them. They are NOT subject to the inherited
		// allowlist because profileEnv is non-nil.
		if envMap["AGENTHUB_DB_URL"] != "custom-db-url" {
			t.Errorf("profile env AGENTHUB_DB_URL = %q, want custom-db-url", envMap["AGENTHUB_DB_URL"])
		}
		if envMap["AGENTHUB_CUSTOM_SETTING"] != "custom-value" {
			t.Errorf("profile env AGENTHUB_CUSTOM_SETTING = %q, want custom-value", envMap["AGENTHUB_CUSTOM_SETTING"])
		}
	})

	t.Run("profile env still warns on sensitive vars", func(t *testing.T) {
		// Even though profile env passes through verbatim, sensitive vars
		// should be detected by IsSensitiveEnvKey. The SanitizedEnv function
		// doesn't strip them from profile env (that's the caller's job via
		// envForRun which logs warnings), but IsSensitiveEnvKey should still
		// classify them correctly.
		sensitive := []string{
			"JWT_SECRET",
			"REDIS_PASSWORD",
			"AGENTHUB_JWT_SECRET",
			"AGENTHUB_REDIS_PASSWORD",
			"DATABASE_URL",
			"ANTHROPIC_API_KEY",
			"OPENAI_API_KEY",
		}
		for _, key := range sensitive {
			if !IsSensitiveEnvKey(key) {
				t.Errorf("IsSensitiveEnvKey(%q) = false, want true", key)
			}
		}
	})

	t.Run("extra env always passes through", func(t *testing.T) {
		// Extra env (runtime vars like AGENTHUB_RUN_ID added by envForRun)
		// always passes through regardless of allowlist — it's explicitly
		// appended after filtering.
		extraEnv := []string{
			"AGENTHUB_RUN_ID=extra-run-123",
			"AGENTHUB_PROJECT_ID=extra-proj-456",
			"AGENTHUB_CUSTOM_SETTING=extra-custom",
		}
		env, _ := SanitizedEnv(nil, extraEnv)
		envMap := envToMap(env)

		for _, kv := range extraEnv {
			key, val, _ := strings.Cut(kv, "=")
			got, ok := envMap[key]
			if !ok {
				t.Errorf("extra env %q not found in sanitized env", key)
			} else if got != val {
				t.Errorf("extra env %q = %q, want %q", key, got, val)
			}
		}
	})

	t.Run("sensitive non-AGENTHUB vars also blocked", func(t *testing.T) {
		// Non-AGENTHUB_* sensitive vars must also be blocked from inherited env.
		t.Setenv("JWT_SECRET", "jwt-secret")
		t.Setenv("REDIS_PASSWORD", "redis-pass")
		t.Setenv("DATABASE_URL", "postgres://localhost/db")
		t.Setenv("ANTHROPIC_API_KEY", "sk-ant-secret")
		t.Setenv("GITHUB_TOKEN", "ghp-secret")

		env, _ := SanitizedEnv(nil, nil)
		envMap := envToMap(env)

		blocked := []string{
			"JWT_SECRET",
			"REDIS_PASSWORD",
			"DATABASE_URL",
			"ANTHROPIC_API_KEY",
			"GITHUB_TOKEN",
		}
		for _, key := range blocked {
			if _, ok := envMap[key]; ok {
				t.Errorf("sensitive non-AGENTHUB var %q leaked into sanitized env", key)
			}
		}
	})
}

// --- IsSensitiveEnvKey tests ---

func TestIsSensitiveEnvKeySuffixPatterns(t *testing.T) {
	sensitive := []string{
		"OPENAI_API_KEY",
		"ANTHROPIC_API_KEY",
		"GITHUB_TOKEN",
		"JWT_SECRET",
		"DB_PASSWORD",
		"ENCRYPTION_KEY",
		"AWS_SECRET_ACCESS_KEY",
		"DOCKER_PASSWORD",
		"MY_PRIVATE_KEY",
		"AZURE_CLIENT_SECRET",
		"NUGET_API_KEY",
		"MASTER_KEY",
		"SIGNING_KEY",
		"API_SECRET",
		"AUTH_TOKEN",
		"GCP_CREDENTIALS",
		"SSH_PRIVATE_KEY",
	}
	for _, key := range sensitive {
		if !IsSensitiveEnvKey(key) {
			t.Errorf("IsSensitiveEnvKey(%q) = false, want true", key)
		}
	}
}

func TestIsSensitiveEnvKeyExactMatches(t *testing.T) {
	exactMatches := []string{
		"AWS_ACCESS_KEY_ID",
		"DATABASE_URL",
		"PGPASSWORD",
		"MYSQL_PWD",
		"GITHUB_TOKEN",
		"NPM_TOKEN",
		"KUBECONFIG",
		"CONNECTION_STRING",
		"GOOGLE_APPLICATION_CREDENTIALS",
		"DATABASE_PASSWORD",
		"GIT_CONFIG_GLOBAL",
		"GIT_CONFIG_SYSTEM",
	}
	for _, key := range exactMatches {
		if !IsSensitiveEnvKey(key) {
			t.Errorf("IsSensitiveEnvKey(%q) = false, want true (exact match)", key)
		}
	}
}

func TestIsSensitiveEnvKeyCaseInsensitive(t *testing.T) {
	tests := []struct {
		key       string
		sensitive bool
	}{
		{"api_key", true},
		{"Api_Key", true},
		{"GITHUB_TOKEN", true},
		{"github_token", true},
		{"DB_PASSWORD", true},
		{"db_password", true},
		{"aws_secret_access_key", true},
	}
	for _, tt := range tests {
		got := IsSensitiveEnvKey(tt.key)
		if got != tt.sensitive {
			t.Errorf("IsSensitiveEnvKey(%q) = %v, want %v", tt.key, got, tt.sensitive)
		}
	}
}

func TestIsSensitiveEnvKeyNegativeCases(t *testing.T) {
	nonSensitive := []string{
		"PATH",
		"HOME",
		"USER",
		"LANG",
		"EDITOR",
		"PWD",
		"HOSTNAME",
		"SHELL",
		"TERM",
		"GOPATH",
		"JAVA_HOME",
		"PYTHONPATH",
		"NODE_PATH",
		"RUSTUP_HOME",
		"CARGO_HOME",
		"SSH_AUTH_SOCK",
		"DISPLAY",
		"MY_APP_CONFIG",
		"APP_DATA_DIR",
		"LOG_LEVEL",
		"DEBUG",
		"PORT",
		"ENDPOINT_URL",
		"RETRY_COUNT",
		"TIMEOUT",
	}
	for _, key := range nonSensitive {
		if IsSensitiveEnvKey(key) {
			t.Errorf("IsSensitiveEnvKey(%q) = true, want false", key)
		}
	}
}

func TestIsSensitiveEnvKeyPartialSuffixNotTriggered(t *testing.T) {
	// Substring of a suffix should not match.
	nonSensitive := []string{
		"MY_KEY_HOLDER",
		"SECRET_AGENT_NAME",
		"TOKEN_RING",
		"PASSWORD_MANAGER_VERSION",
	}
	for _, key := range nonSensitive {
		upper := strings.ToUpper(key)
		// These don't end with the sensitive suffix, so should be false.
		if IsSensitiveEnvKey(key) {
			t.Errorf("IsSensitiveEnvKey(%q) = true, want false (does not end with sensitive suffix: %s)", key, upper)
		}
	}
}

// envToMap converts a []string of KEY=VALUE pairs to a map that follows the
// target operating system's environment-key semantics. Windows preserves the
// original spelling of an existing key even when t.Setenv uses another case,
// but environment lookups remain case-insensitive.
func envToMap(env []string) map[string]string {
	m := make(map[string]string, len(env))
	for _, kv := range env {
		key, val, ok := strings.Cut(kv, "=")
		if ok {
			if runtime.GOOS == "windows" {
				key = strings.ToUpper(key)
			}
			m[key] = val
		}
	}
	return m
}
