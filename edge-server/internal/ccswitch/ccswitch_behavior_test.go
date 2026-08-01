package ccswitch

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// =============================================================================
// stripContextSuffix behavior
// =============================================================================

func TestStripContextSuffix_EdgeCases(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		// Empty and whitespace-only
		{"empty string", "", ""},
		{"whitespace only", "   ", ""}, // TrimSpace reduces all-whitespace to empty
		{"just spaces no bracket", "  foo  ", "foo"},

		// Bracket but no context suffix pattern (no closing bracket)
		{"only open bracket", "[", "["},                         // idx=0, not >0, so returns TrimSpace("[")
		{"bracket at start", "[abc", "[abc"},                    // idx=0
		{"bracket as first char of word", "foo[bar", "foo[bar"}, // idx>0 but no closing ]

		// Normal context suffixes
		{"suffix [1M]", "deepseek-v4-pro[1M]", "deepseek-v4-pro"},
		{"suffix [1m] lowercase", "opus[1m]", "opus"},
		{"suffix [128K]", "claude-sonnet[128K]", "claude-sonnet"},
		{"suffix [200k]", "gemini-flash[200k]", "gemini-flash"},

		// Suffix with trailing space
		{"suffix [1M] with trailing space", "deepseek-v4-pro[1M] ", "deepseek-v4-pro"},

		// Model name already containing brackets in middle (unlikely but handle gracefully)
		{"bracket mid-name and suffix", "foo[bar]baz[1M]", "foo[bar]baz"}, // LastIndex finds second [

		// Context tag in middle of name (not a suffix)
		{"mid-word bracket", "[1M] at start", "[1M] at start"},                   // idx=0, not >0
		{"trailing bracket but closed mid-word", "model[1M] v2", "model[1M] v2"}, // bracket not at end, suffix doesn't end with ]

		// Already clean names (no brackets)
		{"clean model name", "deepseek-v4-pro", "deepseek-v4-pro"},
		{"clean with trailing space", "glm-5.1 ", "glm-5.1"},

		// Different context window sizes
		{"[4K]", "tiny-model[4K]", "tiny-model"},
		{"[32k]", "model[32k]", "model"},
		{"[2M]", "large-context[2M]", "large-context"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := stripContextSuffix(tt.input)
			if got != tt.expected {
				t.Errorf("stripContextSuffix(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

// =============================================================================
// parseModelAliases behavior
// =============================================================================

func TestParseModelAliases_AllAliasTypes(t *testing.T) {
	// Full config: all known alias keys populated.
	input := `{
		"model": "sonnet[1m]",
		"env": {
			"ANTHROPIC_AUTH_TOKEN": "sk-abc",
			"ANTHROPIC_BASE_URL": "https://api.example.com/v1",
			"ANTHROPIC_DEFAULT_OPUS_MODEL": "deepseek-v4-pro[1M]",
			"ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-5.1",
			"ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek-v4-flash",
			"ANTHROPIC_REASONING_MODEL": "deepseek-r1[64K]",
			"CLAUDE_CODE_SUBAGENT_MODEL": "deepseek-v4-flash[1M]",
			"ANTHROPIC_MODEL": "glm-5.1",
			"ANTHROPIC_DEFAULT_OPUS_MODEL_NAME": "DeepSeek V4 Pro",
			"ANTHROPIC_DEFAULT_SONNET_MODEL_NAME": "GLM 5.1",
			"ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME": "DeepSeek V4 Flash"
		}
	}`

	aliases := parseModelAliases(input)

	// Model aliases (with context suffix stripped).
	assertAlias(t, aliases, "opus", "deepseek-v4-pro")
	assertAlias(t, aliases, "sonnet", "glm-5.1")
	assertAlias(t, aliases, "haiku", "deepseek-v4-flash")
	assertAlias(t, aliases, "reasoning", "deepseek-r1")
	assertAlias(t, aliases, "subagent", "deepseek-v4-flash")
	assertAlias(t, aliases, "default", "glm-5.1")

	// Display name aliases (no suffix to strip on most, but belts-and-suspenders).
	assertAlias(t, aliases, "opus_name", "DeepSeek V4 Pro")
	assertAlias(t, aliases, "sonnet_name", "GLM 5.1")
	assertAlias(t, aliases, "haiku_name", "DeepSeek V4 Flash")

	// Total: 9 aliases.
	if len(aliases) != 9 {
		t.Errorf("expected 9 aliases, got %d: %v", len(aliases), aliases)
	}
}

func TestParseModelAliases_PartialConfig(t *testing.T) {
	// Only a subset of aliases configured.
	input := `{
		"env": {
			"ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-5.1",
			"ANTHROPIC_DEFAULT_HAIKU_MODEL": "qwen3.7-max[1M]"
		}
	}`

	aliases := parseModelAliases(input)

	if len(aliases) != 2 {
		t.Errorf("expected 2 aliases, got %d", len(aliases))
	}
	assertAlias(t, aliases, "sonnet", "glm-5.1")
	assertAlias(t, aliases, "haiku", "qwen3.7-max")

	// Unconfigured keys should not appear.
	if _, ok := aliases["opus"]; ok {
		t.Error("opus should not be present when not configured")
	}
	if _, ok := aliases["default"]; ok {
		t.Error("default should not be present when not configured")
	}
}

func TestParseModelAliases_EmptyEnv(t *testing.T) {
	// settings_config with "env":{} — no aliases.
	input := `{"model":"opus","env":{}}`
	aliases := parseModelAliases(input)
	if len(aliases) != 0 {
		t.Errorf("expected 0 aliases for empty env, got %d", len(aliases))
	}
}

func TestParseModelAliases_NoEnvKey(t *testing.T) {
	// settings_config with no "env" key at all.
	input := `{"model":"sonnet"}`
	aliases := parseModelAliases(input)
	if len(aliases) != 0 {
		t.Errorf("expected 0 aliases for missing env key, got %d", len(aliases))
	}
}

func TestParseModelAliases_MalformedJSON(t *testing.T) {
	// Totally invalid JSON.
	aliases := parseModelAliases("not json at all")
	if len(aliases) != 0 {
		t.Errorf("expected 0 aliases for malformed JSON, got %d", len(aliases))
	}

	// Truncated JSON.
	aliases = parseModelAliases(`{"env":{"ANTHROPIC_DEFAULT_OPUS_MODEL":"deepseek`)
	if len(aliases) != 0 {
		t.Errorf("expected 0 aliases for truncated JSON, got %d", len(aliases))
	}
}

func TestParseModelAliases_EmptyStringValue(t *testing.T) {
	// Alias key present but with empty value — should be skipped.
	input := `{
		"env": {
			"ANTHROPIC_DEFAULT_OPUS_MODEL": "",
			"ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-5.1"
		}
	}`
	aliases := parseModelAliases(input)
	if len(aliases) != 1 {
		t.Errorf("expected 1 alias (empty value skipped), got %d", len(aliases))
	}
	assertAlias(t, aliases, "sonnet", "glm-5.1")
	if _, ok := aliases["opus"]; ok {
		t.Error("opus should be skipped for empty value")
	}
}

// =============================================================================
// hasAPIKey behavior
// =============================================================================

func TestHasAPIKey_Present(t *testing.T) {
	input := `{"env":{"ANTHROPIC_AUTH_TOKEN":"sk-abc123"}}`
	if !hasAPIKey(input) {
		t.Error("expected true when ANTHROPIC_AUTH_TOKEN is set")
	}
}

func TestHasAPIKey_Missing(t *testing.T) {
	// env exists but no AUTH_TOKEN key.
	input := `{"env":{"ANTHROPIC_BASE_URL":"https://api.example.com"}}`
	if hasAPIKey(input) {
		t.Error("expected false when ANTHROPIC_AUTH_TOKEN is not set")
	}
}

func TestHasAPIKey_EmptyEnv(t *testing.T) {
	input := `{"env":{}}`
	if hasAPIKey(input) {
		t.Error("expected false for empty env")
	}
}

func TestHasAPIKey_NoEnvKey(t *testing.T) {
	input := `{"model":"sonnet"}`
	if hasAPIKey(input) {
		t.Error("expected false when env key is missing")
	}
}

func TestHasAPIKey_MalformedJSON(t *testing.T) {
	if hasAPIKey("not json") {
		t.Error("expected false for malformed JSON")
	}
}

func TestHasAPIKey_EmptyString(t *testing.T) {
	if hasAPIKey("") {
		t.Error("expected false for empty string")
	}
}

func TestHasAPIKey_TokenEmptyString(t *testing.T) {
	// Token key exists but value is empty — still counts as "set" per current impl.
	// Documenting the behavior: hasAPIKey only checks key presence via map lookup.
	input := `{"env":{"ANTHROPIC_AUTH_TOKEN":""}}`
	if !hasAPIKey(input) {
		t.Error("expected true when ANTHROPIC_AUTH_TOKEN key exists (even if empty)")
	}
}

// =============================================================================
// ConfigDir behavior
// =============================================================================

func TestConfigDir_Default(t *testing.T) {
	// Unset CC_SWITCH_HOME to test default path.
	orig := os.Getenv("CC_SWITCH_HOME")
	os.Unsetenv("CC_SWITCH_HOME")
	defer os.Setenv("CC_SWITCH_HOME", orig)

	dir := ConfigDir()
	if dir == "" {
		t.Error("expected non-empty default config dir")
	}
	if !strings.HasSuffix(dir, ".cc-switch") {
		t.Errorf("expected path ending in .cc-switch, got %s", dir)
	}
}

func TestConfigDir_EnvOverride(t *testing.T) {
	orig := os.Getenv("CC_SWITCH_HOME")
	os.Setenv("CC_SWITCH_HOME", "/custom/cc-switch/home")
	defer os.Setenv("CC_SWITCH_HOME", orig)

	dir := ConfigDir()
	if dir != "/custom/cc-switch/home" {
		t.Errorf("expected /custom/cc-switch/home, got %s", dir)
	}
}

func TestConfigDir_EnvOverrideTrimmed(t *testing.T) {
	// Leading/trailing whitespace in env var should be trimmed.
	orig := os.Getenv("CC_SWITCH_HOME")
	os.Setenv("CC_SWITCH_HOME", "  /spaces/path/  ")
	defer os.Setenv("CC_SWITCH_HOME", orig)

	dir := ConfigDir()
	if dir != "/spaces/path/" {
		t.Errorf("expected trimmed /spaces/path/, got %q", dir)
	}
}

// =============================================================================
// DBPath behavior
// =============================================================================

func TestDBPath_Default(t *testing.T) {
	orig := os.Getenv("CC_SWITCH_HOME")
	os.Unsetenv("CC_SWITCH_HOME")
	defer os.Setenv("CC_SWITCH_HOME", orig)

	path := DBPath()
	if path == "" {
		t.Error("expected non-empty db path")
	}
	if !strings.HasSuffix(path, "cc-switch.db") {
		t.Errorf("expected path ending in cc-switch.db, got %s", path)
	}
}

func TestDBPath_EnvOverride(t *testing.T) {
	orig := os.Getenv("CC_SWITCH_HOME")
	os.Setenv("CC_SWITCH_HOME", "/custom/path")
	defer os.Setenv("CC_SWITCH_HOME", orig)

	want := filepath.Join("/custom/path", "cc-switch.db")
	path := DBPath()
	if path != want {
		t.Errorf("expected %s, got %s", want, path)
	}
}

// =============================================================================
// parseModelAliases + stripContextSuffix integration
// (Prove that parseModelAliases → stripContextSuffix pipeline works end-to-end)
// =============================================================================

func TestParseModelAliases_StripIntegration(t *testing.T) {
	// Verify that every known env key strips context suffixes.
	cases := []struct {
		envKey      string
		aliasKey    string
		rawValue    string
		cleanedWant string
	}{
		{"ANTHROPIC_DEFAULT_OPUS_MODEL", "opus", "deepseek-v4-pro[1M]", "deepseek-v4-pro"},
		{"ANTHROPIC_DEFAULT_SONNET_MODEL", "sonnet", "claude-sonnet-4-20250514[200k]", "claude-sonnet-4-20250514"},
		{"ANTHROPIC_DEFAULT_HAIKU_MODEL", "haiku", "claude-haiku-3.5[128K]", "claude-haiku-3.5"},
		{"ANTHROPIC_REASONING_MODEL", "reasoning", "deepseek-r1[64K]", "deepseek-r1"},
		{"CLAUDE_CODE_SUBAGENT_MODEL", "subagent", "deepseek-v4-flash[1M]", "deepseek-v4-flash"},
		{"ANTHROPIC_MODEL", "default", "glm-5.1[128K]", "glm-5.1"},
		// NAME variants should also get stripped (suffix unlikely but defensive).
		{"ANTHROPIC_DEFAULT_OPUS_MODEL_NAME", "opus_name", "DeepSeek V4 Pro[1M]", "DeepSeek V4 Pro"},
	}

	for _, c := range cases {
		input := `{"env":{"` + c.envKey + `":"` + c.rawValue + `"}}`
		aliases := parseModelAliases(input)
		got, ok := aliases[c.aliasKey]
		if !ok {
			t.Errorf("%s: alias key %q not found in result", c.envKey, c.aliasKey)
			continue
		}
		if got != c.cleanedWant {
			t.Errorf("%s: got %q, want %q", c.envKey, got, c.cleanedWant)
		}
	}
}

// =============================================================================
// Helpers
// =============================================================================

func assertAlias(t *testing.T, aliases map[string]string, key, want string) {
	t.Helper()
	got, ok := aliases[key]
	if !ok {
		t.Errorf("aliases[%q]: key not found, want %q", key, want)
		return
	}
	if got != want {
		t.Errorf("aliases[%q] = %q, want %q", key, got, want)
	}
}
