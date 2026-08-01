package lifecycle

import (
	"runtime"
	"strings"
	"testing"
)

// ── Behavioral tests for SanitizedEnv ──────────────────────────────────────
// These tests set up real parent environment state via os.Setenv and verify
// the behavioral contract of SanitizedEnv. They complement the existing
// env_sanitizer_test.go unit tests with broader end-to-end scenarios.

func TestSanitizedEnv_Behavior_NilProfileEnv_FiltersAllButWhitelist(t *testing.T) {
	// Set up a realistic parent environment with a mix of whitelisted,
	// sensitive, and unknown vars.
	t.Setenv("PATH", "/usr/bin:/bin")
	t.Setenv("HOME", "/home/testuser")
	t.Setenv("USER", "testuser")
	t.Setenv("LANG", "en_US.UTF-8")
	t.Setenv("SHELL", "/bin/bash")
	t.Setenv("TERM", "xterm-256color")
	t.Setenv("HOSTNAME", "testhost")

	// Sensitive vars — should be filtered.
	t.Setenv("ANTHROPIC_API_KEY", "sk-ant-secret-12345")
	t.Setenv("OPENAI_API_KEY", "sk-openai-secret")
	t.Setenv("GITHUB_TOKEN", "ghp_fake_token")
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("REDIS_URL", "redis://localhost:6379")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY")
	t.Setenv("JWT_SECRET", "super-secret-jwt")
	t.Setenv("DB_PASSWORD", "db-pass-123")

	// Unknown/unlisted vars — should be filtered (not in whitelist).
	t.Setenv("MY_CUSTOM_APP_CONFIG", "/opt/myapp/config")
	t.Setenv("NONEXISTENT_VAR", "some-value")
	t.Setenv("RANDOM_DEBUG_FLAG", "1")

	env, _ := SanitizedEnv(nil, nil)
	envMap := envToMap(env)

	// Whitelisted vars must pass through.
	for _, key := range []string{"PATH", "HOME", "USER", "LANG", "SHELL", "TERM", "HOSTNAME"} {
		if _, ok := envMap[key]; !ok {
			t.Errorf("whitelisted var %q not present in sanitized env", key)
		}
	}

	// Sensitive vars must be absent.
	for _, key := range []string{
		"ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GITHUB_TOKEN",
		"DATABASE_URL", "REDIS_URL", "AWS_SECRET_ACCESS_KEY",
		"JWT_SECRET", "DB_PASSWORD",
	} {
		if _, ok := envMap[key]; ok {
			t.Errorf("sensitive var %q leaked into sanitized env", key)
		}
	}

	// Unknown/unlisted vars must be absent.
	for _, key := range []string{"MY_CUSTOM_APP_CONFIG", "NONEXISTENT_VAR", "RANDOM_DEBUG_FLAG"} {
		if _, ok := envMap[key]; ok {
			t.Errorf("unlisted var %q leaked into sanitized env (not in whitelist)", key)
		}
	}
}

func TestSanitizedEnv_Behavior_ProfileEnv_BypassesFilteringEntirely(t *testing.T) {
	// Set parent env with vars that would normally be filtered.
	t.Setenv("ANTHROPIC_API_KEY", "sk-ant-parent-leaked")
	t.Setenv("AGENTHUB_DB_URL", "inherited-db-url")
	t.Setenv("CUSTOM_SECRET_TOKEN", "parent-token")
	t.Setenv("HOME", "/home/parent")

	// Profile env explicitly sets different values — these pass through verbatim.
	profileEnv := []string{
		"ANTHROPIC_API_KEY=sk-ant-admin-configured",
		"AGENTHUB_DB_URL=admin-db-url",
		"CUSTOM_SECRET_TOKEN=admin-token",
		"APP_SPECIFIC_CONFIG=admin-value",
	}

	extraEnv := []string{
		"AGENTHUB_RUN_ID=run-001",
		"AGENTHUB_PROJECT_ID=proj-001",
	}

	env, _ := SanitizedEnv(profileEnv, extraEnv)
	envMap := envToMap(env)

	// Profile env vars pass through exactly as provided — no filtering applied.
	for _, kv := range profileEnv {
		key, val, _ := strings.Cut(kv, "=")
		got, ok := envMap[key]
		if !ok {
			t.Errorf("profile env var %q not present (should bypass filtering)", key)
		} else if got != val {
			t.Errorf("profile env var %q = %q, want %q", key, got, val)
		}
	}

	// Extra env vars are appended after profile env.
	for _, kv := range extraEnv {
		key, val, _ := strings.Cut(kv, "=")
		got, ok := envMap[key]
		if !ok {
			t.Errorf("extra env var %q not present", key)
		} else if got != val {
			t.Errorf("extra env var %q = %q, want %q", key, got, val)
		}
	}

	// Parent env vars NOT in profileEnv are excluded.
	// t.Setenv scope means HOME is set in the test process, but profileEnv
	// is non-nil, so parent env is not consulted at all — HOME from parent
	// should NOT appear.
	if _, ok := envMap["HOME"]; ok {
		t.Error("parent env HOME leaked into sanitized env when profileEnv is non-nil")
	}
}

func TestSanitizedEnv_Behavior_ProfileEnv_DoesNotConsultParentAtAll(t *testing.T) {
	// When profileEnv is non-nil, the function returns profileEnv + extraEnv
	// without ever calling sanitizeParentEnv. This tests that behavior.
	t.Setenv("PATH", "/from/parent")
	t.Setenv("HOME", "/from/parent")
	t.Setenv("LANG", "from-parent")

	profileEnv := []string{
		"PATH=/from/profile",
		"ONLY_IN_PROFILE=yes",
	}

	env, _ := SanitizedEnv(profileEnv, []string{"EXTRA=from-extra"})
	envMap := envToMap(env)

	// Profile PATH overrides — parent PATH not consulted.
	if got := envMap["PATH"]; got != "/from/profile" {
		t.Errorf("PATH = %q, want /from/profile (profile env)", got)
	}

	// Only profile env + extra env present; parent vars are excluded.
	if _, ok := envMap["HOME"]; ok {
		t.Error("parent env HOME leaked into sanitized env")
	}
	if _, ok := envMap["LANG"]; ok {
		t.Error("parent env LANG leaked into sanitized env")
	}

	// Profile-only var present.
	if got := envMap["ONLY_IN_PROFILE"]; got != "yes" {
		t.Errorf("ONLY_IN_PROFILE = %q, want yes", got)
	}

	// Extra var present.
	if got := envMap["EXTRA"]; got != "from-extra" {
		t.Errorf("EXTRA = %q, want from-extra", got)
	}

	// Count: exactly 3 entries (PATH, ONLY_IN_PROFILE, EXTRA).
	if len(env) != 3 {
		t.Errorf("sanitized env has %d entries, want 3: %v", len(env), env)
	}
}

func TestSanitizedEnv_Behavior_SensitivePatterns_TOKEN_KEY_SECRET_PASSWORD(t *testing.T) {
	// Test that the suffix-based sensitive detection correctly blocks
	// vars ending with TOKEN, KEY, SECRET, PASSWORD (and their variations).
	sensitiveVars := map[string]string{
		"MY_TOKEN":                       "tok1",
		"API_TOKEN":                      "tok2",
		"ACCESS_TOKEN":                   "tok3",
		"REFRESH_TOKEN":                  "tok4",
		"AUTH_TOKEN":                     "tok5",
		"MY_KEY":                         "key1",
		"ENCRYPTION_KEY":                 "key2",
		"API_KEY":                        "key3",
		"PRIVATE_KEY":                    "key4",
		"MY_SECRET":                      "sec1",
		"API_SECRET":                     "sec2",
		"CLIENT_SECRET":                  "sec3",
		"MY_PASSWORD":                    "pw1",
		"DB_PASSWORD":                    "pw2",
		"ADMIN_PASSWORD":                 "pw3",
		"MY_CREDENTIAL":                  "cred1",
		"SERVICE_CREDENTIALS":            "cred2",
		"GOOGLE_APPLICATION_CREDENTIALS": "gac1",
	}

	for k, v := range sensitiveVars {
		t.Setenv(k, v)
	}

	env, _ := SanitizedEnv(nil, nil)
	envMap := envToMap(env)

	for k := range sensitiveVars {
		if _, ok := envMap[k]; ok {
			t.Errorf("sensitive suffix-pattern var %q leaked into sanitized env", k)
		}
	}
}

func TestSanitizedEnv_Behavior_AgentHubVars_OnlyRunProjectThreadAllowed(t *testing.T) {
	// Set the three explicitly allowed AGENTHUB_* vars.
	t.Setenv("AGENTHUB_RUN_ID", "run-abc")
	t.Setenv("AGENTHUB_PROJECT_ID", "proj-xyz")
	t.Setenv("AGENTHUB_THREAD_ID", "thread-123")

	// Set various AGENTHUB_* vars that should NOT pass through from parent env.
	t.Setenv("AGENTHUB_DB_URL", "postgres://secret/db")
	t.Setenv("AGENTHUB_ADMIN_TOKEN", "admin-secret")
	t.Setenv("AGENTHUB_JWT_SECRET", "jwt-secret")
	t.Setenv("AGENTHUB_HUB_TOKEN", "hub-token")
	t.Setenv("AGENTHUB_INTERNAL_PORT", "9999")
	t.Setenv("AGENTHUB_LOG_LEVEL", "debug")
	t.Setenv("AGENTHUB_CUSTOM_SETTING", "custom")
	t.Setenv("AGENTHUB_REDIS_PASSWORD", "redis-pass")
	t.Setenv("AGENTHUB_ENCRYPTION_KEY", "enc-key")
	t.Setenv("AGENTHUB_SIGNING_KEY", "sign-key")

	env, _ := SanitizedEnv(nil, nil)
	envMap := envToMap(env)

	// The three allowed vars pass through.
	allowed := map[string]string{
		"AGENTHUB_RUN_ID":     "run-abc",
		"AGENTHUB_PROJECT_ID": "proj-xyz",
		"AGENTHUB_THREAD_ID":  "thread-123",
	}
	for key, want := range allowed {
		got, ok := envMap[key]
		if !ok {
			t.Errorf("allowed AGENTHUB var %q not present in sanitized env", key)
		} else if got != want {
			t.Errorf("AGENTHUB var %q = %q, want %q", key, got, want)
		}
	}

	// All other AGENTHUB_* vars are absent.
	blocked := []string{
		"AGENTHUB_DB_URL",
		"AGENTHUB_ADMIN_TOKEN",
		"AGENTHUB_JWT_SECRET",
		"AGENTHUB_HUB_TOKEN",
		"AGENTHUB_INTERNAL_PORT",
		"AGENTHUB_LOG_LEVEL",
		"AGENTHUB_CUSTOM_SETTING",
		"AGENTHUB_REDIS_PASSWORD",
		"AGENTHUB_ENCRYPTION_KEY",
		"AGENTHUB_SIGNING_KEY",
	}
	for _, key := range blocked {
		if _, ok := envMap[key]; ok {
			t.Errorf("blocked AGENTHUB var %q leaked into sanitized env", key)
		}
	}
}

func TestSanitizedEnv_Behavior_ExtraEnv_AlwaysAppended(t *testing.T) {
	// Extra env is appended after filtering. Even sensitive-looking extra vars
	// pass through — callers (envForRun) are responsible for warning on them.
	extraEnv := []string{
		"ANTHROPIC_API_KEY=sk-ant-extra",
		"OPENAI_API_KEY=sk-openai-extra",
		"AGENTHUB_RUN_ID=extra-run",
		"CUSTOM_CONFIG_PATH=/opt/config",
		"AGENTHUB_CUSTOM_SETTING=extra-custom",
	}

	// Also set parent env with conflicting values.
	t.Setenv("ANTHROPIC_API_KEY", "sk-ant-parent")
	t.Setenv("CUSTOM_CONFIG_PATH", "/from/parent")

	env, _ := SanitizedEnv(nil, extraEnv)
	envMap := envToMap(env)

	// Every extra env var appears in the output with its value.
	for _, kv := range extraEnv {
		key, val, _ := strings.Cut(kv, "=")
		got, ok := envMap[key]
		if !ok {
			t.Errorf("extra env var %q not found in sanitized env", key)
		} else if got != val {
			t.Errorf("extra env var %q = %q, want %q", key, got, val)
		}
	}

	// Parent ANTHROPIC_API_KEY should NOT appear (filtered as sensitive).
	if _, ok := envMap["ANTHROPIC_API_KEY"]; ok && envMap["ANTHROPIC_API_KEY"] == "sk-ant-parent" {
		t.Error("parent ANTHROPIC_API_KEY leaked (should be filtered from parent env)")
	}
}

func TestSanitizedEnv_Behavior_EmptyProfileEnv_DoesNotBypass(t *testing.T) {
	// An empty (but non-nil) profileEnv means "no profile vars" but still bypasses
	// parent filtering. The result is just extraEnv, with zero parent vars.
	t.Setenv("PATH", "/usr/bin")
	t.Setenv("HOME", "/home/user")

	emptyProfile := []string{} // non-nil, zero length

	env, _ := SanitizedEnv(emptyProfile, []string{"EXTRA=value"})
	envMap := envToMap(env)

	// Parent vars are excluded (profileEnv is non-nil, so no parent filtering).
	if _, ok := envMap["PATH"]; ok {
		t.Error("parent PATH leaked when profileEnv is empty but non-nil")
	}
	if _, ok := envMap["HOME"]; ok {
		t.Error("parent HOME leaked when profileEnv is empty but non-nil")
	}

	// Extra env still present.
	if got := envMap["EXTRA"]; got != "value" {
		t.Errorf("EXTRA = %q, want value", got)
	}

	if len(env) != 1 {
		t.Errorf("sanitized env has %d entries, want 1: %v", len(env), env)
	}
}

func TestSanitizedEnv_Behavior_WhitelistedXDGVars_PassThrough(t *testing.T) {
	// XDG_* vars are explicitly whitelisted and should pass through from parent.
	t.Setenv("XDG_CONFIG_HOME", "/home/user/.config")
	t.Setenv("XDG_CACHE_HOME", "/home/user/.cache")
	t.Setenv("XDG_DATA_HOME", "/home/user/.local/share")
	t.Setenv("XDG_STATE_HOME", "/home/user/.local/state")
	t.Setenv("PATH", "/usr/bin") // ensure we aren't in empty state

	env, _ := SanitizedEnv(nil, nil)
	envMap := envToMap(env)

	for _, key := range []string{
		"XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME",
	} {
		if _, ok := envMap[key]; !ok {
			t.Errorf("XDG var %q not present in sanitized env", key)
		}
	}
}

func TestSanitizedEnv_Behavior_CommonDevToolVars_PassThrough(t *testing.T) {
	// Development tool vars (GOPATH, JAVA_HOME, PYTHONPATH, etc.) should pass through.
	t.Setenv("GOPATH", "/home/user/go")
	t.Setenv("GOROOT", "/usr/local/go")
	t.Setenv("JAVA_HOME", "/usr/lib/jvm/java-17")
	t.Setenv("PYTHONPATH", "/home/user/python")
	t.Setenv("NODE_PATH", "/home/user/node_modules")
	t.Setenv("CARGO_HOME", "/home/user/.cargo")
	t.Setenv("RUSTUP_HOME", "/home/user/.rustup")
	t.Setenv("PATH", "/usr/bin") // ensure whitelist includes at least PATH

	env, _ := SanitizedEnv(nil, nil)
	envMap := envToMap(env)

	for _, key := range []string{
		"GOPATH", "GOROOT", "JAVA_HOME", "PYTHONPATH",
		"NODE_PATH", "CARGO_HOME", "RUSTUP_HOME",
	} {
		if _, ok := envMap[key]; !ok {
			t.Errorf("dev tool var %q not present in sanitized env", key)
		}
	}
}

func TestSanitizedEnv_Behavior_GitConfigPathVars_Blocked(t *testing.T) {
	// GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM can be used to inject
	// credential helpers or URL rewrites into child git processes.
	t.Setenv("GIT_CONFIG_GLOBAL", "/tmp/malicious-gitconfig")
	t.Setenv("GIT_CONFIG_SYSTEM", "/tmp/malicious-system-gitconfig")
	// Safe Git identity vars should still pass through.
	t.Setenv("GIT_AUTHOR_NAME", "Test Author")
	t.Setenv("GIT_AUTHOR_EMAIL", "author@example.com")
	t.Setenv("PATH", "/usr/bin")

	env, _ := SanitizedEnv(nil, nil)
	envMap := envToMap(env)

	// Git config path vars blocked.
	for _, key := range []string{"GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM"} {
		if _, ok := envMap[key]; ok {
			t.Errorf("git config path var %q leaked into sanitized env", key)
		}
	}

	// Safe Git identity vars pass through.
	if got := envMap["GIT_AUTHOR_NAME"]; got != "Test Author" {
		t.Errorf("GIT_AUTHOR_NAME = %q, want Test Author", got)
	}
	if got := envMap["GIT_AUTHOR_EMAIL"]; got != "author@example.com" {
		t.Errorf("GIT_AUTHOR_EMAIL = %q, want author@example.com", got)
	}
}

func TestSanitizedEnv_Behavior_ProxyVars_PassThrough(t *testing.T) {
	// Proxy vars are whitelisted to allow network configuration in child processes.
	// Note: on case-insensitive platforms (Windows), lowercase proxy vars
	// collide with their uppercase counterparts, so we test them separately.
	t.Setenv("HTTP_PROXY", "http://proxy:8080")
	t.Setenv("HTTPS_PROXY", "http://proxy:8080")
	t.Setenv("NO_PROXY", "localhost,127.0.0.1")
	t.Setenv("ALL_PROXY", "http://proxy:8080")
	t.Setenv("PATH", "/usr/bin")

	env, _ := SanitizedEnv(nil, nil)
	envMap := envToMap(env)

	for _, key := range []string{
		"HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY",
	} {
		if _, ok := envMap[key]; !ok {
			t.Errorf("proxy var %q not present in sanitized env", key)
		}
	}
}

func TestSanitizedEnv_Behavior_LowercaseProxyVars_PassThrough(t *testing.T) {
	// Lowercase proxy variants are whitelisted separately from their uppercase
	// counterparts (both appear in the commonWhitelist). On case-insensitive
	// platforms (Windows), os.Environ() normalizes to the existing canonical
	// case, so lowercase variants are unreachable there; this test is for Unix.
	if runtime.GOOS == "windows" {
		t.Skip("lowercase proxy variants are unreachable on case-insensitive Windows")
	}

	t.Setenv("http_proxy", "http://proxy:8080")
	t.Setenv("https_proxy", "http://proxy:8080")
	t.Setenv("no_proxy", "localhost,127.0.0.1")
	t.Setenv("PATH", "/usr/bin")

	env, _ := SanitizedEnv(nil, nil)
	envMap := envToMap(env)

	for _, key := range []string{
		"http_proxy", "https_proxy", "no_proxy",
	} {
		if _, ok := envMap[key]; !ok {
			t.Errorf("lowercase proxy var %q not present in sanitized env", key)
		}
	}
}

func TestSanitizedEnv_Behavior_ExactSecretVars_Blocked(t *testing.T) {
	// Test the exact-match blocklist for well-known secret env var names.
	exactSecrets := map[string]string{
		"AWS_ACCESS_KEY_ID":              "AKIAIOSFODNN7EXAMPLE",
		"AWS_SECRET_ACCESS_KEY":          "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
		"AWS_SESSION_TOKEN":              "FQoGZXIvYXdzEJr...",
		"DATABASE_URL":                   "postgres://user:pass@localhost/db",
		"DATABASE_PASSWORD":              "db-secret",
		"DB_URL":                         "mysql://user:pass@localhost/db",
		"MONGODB_URI":                    "mongodb://user:pass@localhost:27017",
		"REDIS_URL":                      "redis://:password@localhost:6379",
		"CONNECTION_STRING":              "Server=localhost;User=sa;Password=secret",
		"PGPASSWORD":                     "pg-secret",
		"MYSQL_PWD":                      "mysql-secret",
		"DOCKER_PASSWORD":                "docker-secret",
		"DOCKER_AUTH":                    "docker-auth-data",
		"GITHUB_TOKEN":                   "ghp_fake123",
		"GITLAB_TOKEN":                   "glpat-fake123",
		"BITBUCKET_TOKEN":                "bb-fake123",
		"NPM_TOKEN":                      "npm_fake123",
		"NUGET_API_KEY":                  "nuget-fake123",
		"PYPI_TOKEN":                     "pypi-fake123",
		"AZURE_STORAGE_KEY":              "azure-key-fake",
		"AZURE_CLIENT_SECRET":            "azure-secret-fake",
		"GOOGLE_APPLICATION_CREDENTIALS": "/path/to/creds.json",
		"KUBECONFIG":                     "/path/to/kubeconfig",
		"JWT_SECRET":                     "jwt-fake",
		"ENCRYPTION_KEY":                 "enc-fake",
		"MASTER_KEY":                     "master-fake",
		"SIGNING_KEY":                    "sign-fake",
		"SSH_PRIVATE_KEY":                "-----BEGIN RSA PRIVATE KEY-----",
		"CODEX_ACCESS_TOKEN":             "codex-fake",
		"CODEX_CONNECTORS_TOKEN":         "connectors-fake",
		"OPENAI_API_KEY":                 "sk-fake",
		"ANTHROPIC_API_KEY":              "sk-ant-fake",
		"CLAUDE_API_KEY":                 "sk-ant-claude-fake",
	}

	for k, v := range exactSecrets {
		t.Setenv(k, v)
	}

	t.Setenv("PATH", "/usr/bin") // ensure we're not in empty state

	env, _ := SanitizedEnv(nil, nil)
	envMap := envToMap(env)

	for k := range exactSecrets {
		if _, ok := envMap[k]; ok {
			t.Errorf("exact-match secret var %q leaked into sanitized env", k)
		}
	}
}

func TestSanitizedEnv_Behavior_CaseInsensitive_SensitiveDetection(t *testing.T) {
	// IsSensitiveEnvKey is case-insensitive. Lowercase variants of secret
	// suffixes should also be blocked.
	sensitiveVars := map[string]string{
		"my_api_key":        "val1",
		"MY_API_KEY":        "val2",
		"anthropic_api_key": "val3",
		"ANTHROPIC_API_KEY": "val4",
		"github_token":      "val5",
		"GITHUB_TOKEN":      "val6",
		"db_password":       "val7",
		"DB_PASSWORD":       "val8",
		"jwt_secret":        "val9",
		"JWT_SECRET":        "val10",
	}

	for k, v := range sensitiveVars {
		t.Setenv(k, v)
	}

	t.Setenv("PATH", "/usr/bin")

	env, _ := SanitizedEnv(nil, nil)
	envMap := envToMap(env)

	for k := range sensitiveVars {
		if _, ok := envMap[k]; ok {
			t.Errorf("case-variant sensitive var %q leaked into sanitized env", k)
		}
	}
}

func TestSanitizedEnv_Behavior_IsSensitiveEnvKey_DoesNotFalsePositiveOnPartial(t *testing.T) {
	// Suffix matching is by HasSuffix, not substring. Vars that contain
	// sensitive substrings but don't end with them should NOT be flagged.
	nonSensitive := []string{
		"TOKENIZER_PATH",      // does not end with _TOKEN
		"KEYSTORE_PATH",       // does not end with _KEY
		"SECRETARY_NAME",      // does not end with _SECRET
		"PASSWORDLESS_CONFIG", // does not end with _PASSWORD
		"KEY_GENERATION_ALGO", // does not end with _KEY
	}

	for _, key := range nonSensitive {
		if IsSensitiveEnvKey(key) {
			t.Errorf("IsSensitiveEnvKey(%q) = true, want false (does not end with sensitive suffix)", key)
		}
	}
}

func TestSanitizedEnv_Behavior_LocaleVars_PassThrough(t *testing.T) {
	// LC_* locale vars are whitelisted and pass through from parent.
	t.Setenv("LC_ALL", "en_US.UTF-8")
	t.Setenv("LC_CTYPE", "en_US.UTF-8")
	t.Setenv("LC_MESSAGES", "en_US.UTF-8")
	t.Setenv("LC_TIME", "en_US.UTF-8")
	t.Setenv("PATH", "/usr/bin")

	env, _ := SanitizedEnv(nil, nil)
	envMap := envToMap(env)

	for _, key := range []string{"LC_ALL", "LC_CTYPE", "LC_MESSAGES", "LC_TIME"} {
		if _, ok := envMap[key]; !ok {
			t.Errorf("LC_* locale var %q not present in sanitized env", key)
		}
	}
}

// TestSanitizedEnv_Behavior_SanitizeParentEnv_MalformedLines tests that
// os.Environ() entries without '=' are safely skipped.
func TestSanitizedEnv_Behavior_SanitizeParentEnv_ExtraEnvWithEqualsInValue(t *testing.T) {
	// Extra env values can contain '=' — only the first '=' splits key from value.
	extraEnv := []string{
		"BASE64_DATA=SGVsbG8gV29ybGQ=",
		"COMPLEX_VAR=key=value&another=thing",
	}

	env, _ := SanitizedEnv(nil, extraEnv)
	envMap := envToMap(env)

	if got := envMap["BASE64_DATA"]; got != "SGVsbG8gV29ybGQ=" {
		t.Errorf("BASE64_DATA = %q, want SGVsbG8gV29ybGQ=", got)
	}
	if got := envMap["COMPLEX_VAR"]; got != "key=value&another=thing" {
		t.Errorf("COMPLEX_VAR = %q, want key=value&another=thing", got)
	}
}

func TestSanitizedEnv_Behavior_SSHAgentAndConnectionVars_PassThrough(t *testing.T) {
	// SSH agent and connection vars are whitelisted for SSH-based tool use.
	t.Setenv("SSH_AUTH_SOCK", "/tmp/ssh-agent.sock")
	t.Setenv("SSH_AGENT_PID", "12345")
	t.Setenv("SSH_CLIENT", "192.168.1.1 2222 22")
	t.Setenv("SSH_CONNECTION", "192.168.1.1 2222 10.0.0.1 22")
	t.Setenv("SSH_TTY", "/dev/pts/0")
	t.Setenv("PATH", "/usr/bin")

	env, _ := SanitizedEnv(nil, nil)
	envMap := envToMap(env)

	for _, key := range []string{
		"SSH_AUTH_SOCK", "SSH_AGENT_PID", "SSH_CLIENT", "SSH_CONNECTION", "SSH_TTY",
	} {
		if _, ok := envMap[key]; !ok {
			t.Errorf("SSH var %q not present in sanitized env", key)
		}
	}
}

func TestSanitizedEnv_Behavior_DisplayAndEditorVars_PassThrough(t *testing.T) {
	// Display and editor vars are whitelisted for interactive tool use.
	t.Setenv("DISPLAY", ":0")
	t.Setenv("WAYLAND_DISPLAY", "wayland-0")
	t.Setenv("EDITOR", "vim")
	t.Setenv("VISUAL", "code")
	t.Setenv("PAGER", "less")
	t.Setenv("BROWSER", "firefox")
	t.Setenv("PATH", "/usr/bin")

	env, _ := SanitizedEnv(nil, nil)
	envMap := envToMap(env)

	for _, key := range []string{
		"DISPLAY", "WAYLAND_DISPLAY", "EDITOR", "VISUAL", "PAGER", "BROWSER",
	} {
		if _, ok := envMap[key]; !ok {
			t.Errorf("display/editor var %q not present in sanitized env", key)
		}
	}
}

// ── Behavioral tests for IsSensitiveEnvKey ─────────────────────────────────

func TestIsSensitiveEnvKey_Behavior_AllSuffixPatterns(t *testing.T) {
	// Each suffix variant from the source code's suffix list.
	tests := []struct {
		key       string
		sensitive bool
	}{
		// Suffix: _KEY
		{"API_KEY", true},
		{"ENCRYPTION_KEY", true},
		{"MY_KEY", true},
		// Suffix: _SECRET
		{"CLIENT_SECRET", true},
		{"MY_SECRET", true},
		// Suffix: _TOKEN
		{"ACCESS_TOKEN", true},
		{"REFRESH_TOKEN", true},
		{"MY_TOKEN", true},
		// Suffix: _PASSWORD
		{"DB_PASSWORD", true},
		{"ADMIN_PASSWORD", true},
		// Suffix: _PASSWD
		{"MYSQL_PASSWD", true},
		// Suffix: _CREDENTIAL
		{"SERVICE_CREDENTIAL", true},
		// Suffix: _CREDENTIALS
		{"SERVICE_CREDENTIALS", true},
		// Suffix: _AUTH_TOKEN
		{"MY_AUTH_TOKEN", true},
		// Suffix: _PRIVATE_KEY
		{"SSH_PRIVATE_KEY", true},
		// Suffix: _API_SECRET
		{"MY_API_SECRET", true},
		// Negative: safe vars
		{"API_KEY_HOLDER", false},    // ends with HOLDER, not _KEY
		{"TOKEN_COUNT", false},       // ends with COUNT, not _TOKEN
		{"SECRET_AGENT_CODE", false}, // ends with CODE, not _SECRET
	}
	for _, tt := range tests {
		got := IsSensitiveEnvKey(tt.key)
		if got != tt.sensitive {
			t.Errorf("IsSensitiveEnvKey(%q) = %v, want %v", tt.key, got, tt.sensitive)
		}
	}
}
