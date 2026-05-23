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
	env := SanitizedEnv(nil, nil)

	// Sanitized output should be substantially smaller than the full parent env.
	if len(env) >= parentCount {
		t.Fatalf("SanitizedEnv returned %d vars, want fewer than parent (%d)", len(env), parentCount)
	}
}

func TestSanitizedEnvIncludesWhitelistedVars(t *testing.T) {
	// Set a known whitelisted var so we can detect it.
	t.Setenv("LANG", "en_US.UTF-8")

	env := SanitizedEnv(nil, nil)
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

	env := SanitizedEnv(nil, nil)
	envMap := envToMap(env)

	sensitive := []string{"MY_API_KEY", "DB_PASSWORD", "ANTHROPIC_API_KEY"}
	for _, key := range sensitive {
		if _, ok := envMap[key]; ok {
			t.Errorf("sensitive var %q leaked into sanitized env (should be filtered)", key)
		}
	}
}

func TestSanitizedEnvIncludesExtraEnv(t *testing.T) {
	extra := []string{
		"ANTHROPIC_API_KEY=sk-ant-test",
		"OPENAI_API_KEY=sk-test-key",
		"CUSTOM_CONFIG_PATH=/opt/myapp/config",
	}
	env := SanitizedEnv(nil, extra)
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

func TestSanitizedEnvIncludesAgentHubVars(t *testing.T) {
	t.Setenv("AGENTHUB_RUN_ID", "run_test")
	t.Setenv("AGENTHUB_PROJECT_ID", "proj_test")
	t.Setenv("AGENTHUB_CUSTOM_SETTING", "custom-value")

	env := SanitizedEnv(nil, nil)
	envMap := envToMap(env)

	for _, key := range []string{"AGENTHUB_RUN_ID", "AGENTHUB_PROJECT_ID", "AGENTHUB_CUSTOM_SETTING"} {
		if _, ok := envMap[key]; !ok {
			t.Errorf("AGENTHUB_* var %q not in sanitized env (should always pass through)", key)
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

	env := SanitizedEnv(profileEnv, extraEnv)
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
	env := SanitizedEnv(nil, nil)
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

// envToMap converts a []string of KEY=VALUE pairs to a map.
func envToMap(env []string) map[string]string {
	m := make(map[string]string, len(env))
	for _, kv := range env {
		key, val, ok := strings.Cut(kv, "=")
		if ok {
			m[key] = val
		}
	}
	return m
}
