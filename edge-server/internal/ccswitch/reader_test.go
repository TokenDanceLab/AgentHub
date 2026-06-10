package ccswitch

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDetect(t *testing.T) {
	// Detect should not panic even if cc-switch is not installed in CI.
	status := Detect()
	t.Logf("cc-switch status: installed=%v routing=%v dir=%q db=%q",
		status.Installed, status.RoutingActive, status.ConfigDir, status.DBPath)
}

func TestDetectRealDB(t *testing.T) {
	dbPath := DBPath()
	if _, err := os.Stat(dbPath); err != nil {
		t.Skip("cc-switch database not found on this machine")
	}

	status := Detect()
	if !status.Installed {
		t.Fatal("expected cc-switch to be installed when db exists")
	}
	t.Logf("status: %+v", status)
}

func TestReaderRealDB(t *testing.T) {
	reader := NewReader()
	if reader == nil {
		t.Skip("cc-switch database not found on this machine")
	}

	providers, err := reader.ReadProviders("claude")
	if err != nil {
		t.Fatalf("ReadProviders returned error: %v", err)
	}
	t.Logf("Found %d claude providers", len(providers))
	for _, p := range providers {
		t.Logf("  provider: id=%s name=%s current=%v active=%v base_url=%s",
			p.ProviderID, p.ProviderName, p.IsCurrent, p.IsActive, p.BaseURL)
		if p.IsCurrent {
			for alias, model := range p.ModelAliases {
				t.Logf("    alias: %s -> %s", alias, model)
			}
		}
	}

	settings, err := reader.ReadSettings()
	if err != nil {
		t.Fatalf("ReadSettings returned error: %v", err)
	}
	t.Logf("Found %d settings", len(settings))
}

func TestReaderResolveModelAlias(t *testing.T) {
	reader := NewReader()
	if reader == nil {
		t.Skip("cc-switch database not found on this machine")
	}

	// Try to resolve the "opus" alias for the "claude" app type.
	resolved, ok := reader.ResolveModelAlias("opus", "claude")
	t.Logf("ResolveModelAlias(opus, claude): resolved=%q ok=%v", resolved, ok)
}

func TestStripContextSuffix(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"deepseek-v4-pro[1M]", "deepseek-v4-pro"},
		{"deepseek-v4-pro[1M] ", "deepseek-v4-pro"},
		{"glm-5.1", "glm-5.1"},
		{"qwen3.7-max[1M]", "qwen3.7-max"},
		{"deepseek-v4-flash", "deepseek-v4-flash"},
	}
	for _, tt := range tests {
		got := stripContextSuffix(tt.input)
		if got != tt.expected {
			t.Errorf("stripContextSuffix(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

func TestParseModelAliases(t *testing.T) {
	input := `{"model":"opus[1m]","env":{"ANTHROPIC_AUTH_TOKEN":"sk-test","ANTHROPIC_BASE_URL":"https://api.example.com/v1","ANTHROPIC_DEFAULT_OPUS_MODEL":"deepseek-v4-pro[1M]","ANTHROPIC_DEFAULT_SONNET_MODEL":"glm-5.1","ANTHROPIC_DEFAULT_HAIKU_MODEL":"deepseek-v4-flash","ANTHROPIC_DEFAULT_OPUS_MODEL_NAME":"deepseek-v4-pro","ANTHROPIC_DEFAULT_SONNET_MODEL_NAME":"glm-5.1","ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME":"deepseek-v4-flash"}}`

	aliases := parseModelAliases(input)

	if got := aliases["opus"]; got != "deepseek-v4-pro" {
		t.Errorf("aliases[opus] = %q, want %q", got, "deepseek-v4-pro")
	}
	if got := aliases["sonnet"]; got != "glm-5.1" {
		t.Errorf("aliases[sonnet] = %q, want %q", got, "glm-5.1")
	}
	if got := aliases["haiku"]; got != "deepseek-v4-flash" {
		t.Errorf("aliases[haiku] = %q, want %q", got, "deepseek-v4-flash")
	}
}

func TestParseModelAliasesEmpty(t *testing.T) {
	aliases := parseModelAliases("")
	if len(aliases) != 0 {
		t.Errorf("expected empty aliases for empty input, got %d", len(aliases))
	}

	aliases = parseModelAliases("{}")
	if len(aliases) != 0 {
		t.Errorf("expected empty aliases for {}, got %d", len(aliases))
	}
}

func TestNewReaderMissingDB(t *testing.T) {
	// Temporarily override the config dir to a non-existent path.
	orig := os.Getenv("CC_SWITCH_HOME")
	os.Setenv("CC_SWITCH_HOME", filepath.Join(t.TempDir(), "nonexistent"))
	defer os.Setenv("CC_SWITCH_HOME", orig)

	reader := NewReader()
	if reader != nil {
		t.Error("expected nil reader when db does not exist")
	}
}

func TestConfigDir(t *testing.T) {
	// Default: ~/.cc-switch
	dir := ConfigDir()
	if dir == "" {
		t.Error("expected non-empty config dir")
	}
	t.Logf("config dir: %s", dir)

	// With env override.
	orig := os.Getenv("CC_SWITCH_HOME")
	os.Setenv("CC_SWITCH_HOME", "/tmp/test-cc-switch")
	defer os.Setenv("CC_SWITCH_HOME", orig)

	dir = ConfigDir()
	if dir != "/tmp/test-cc-switch" {
		t.Errorf("expected /tmp/test-cc-switch, got %s", dir)
	}
}
