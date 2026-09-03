package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGetModelCatalogRedactsLocalConfigSecrets(t *testing.T) {
	tempDir := t.TempDir()
	codexHome := filepath.Join(tempDir, ".codex")
	claudeHome := filepath.Join(tempDir, ".claude")
	ccSwitchHome := filepath.Join(tempDir, ".cc-switch")
	if err := os.MkdirAll(codexHome, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(claudeHome, "cc-haha"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(ccSwitchHome, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CODEX_HOME", codexHome)
	t.Setenv("CLAUDE_CONFIG_DIR", claudeHome)
	t.Setenv("CC_SWITCH_HOME", ccSwitchHome)

	if err := os.WriteFile(filepath.Join(codexHome, "config.toml"), []byte(`
model = "gpt-5.5"
model_provider = "newapi"

[model_providers.newapi]
name = "TokenDance Gateway"
base_url = "https://api.vectorcontrol.tech/v1"
wire_api = "responses"
api_key = "SHOULD_NOT_LEAK"
`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(claudeHome, "settings.json"), []byte(`{
  "model": "opus[1m]",
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "SHOULD_NOT_LEAK",
    "ANTHROPIC_BASE_URL": "https://api.vectorcontrol.tech",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-7[1M]",
    "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME": "deepseek-v4-pro",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-haiku-4-5",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME": "glm-5.1"
  }
}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(claudeHome, "cc-haha", "providers.json"), []byte(`{
  "providers": [{
    "name": "MetAPI / Opus",
    "baseUrl": "https://api.vectorcontrol.tech/v1",
    "apiKey": "SHOULD_NOT_LEAK",
    "models": { "main": "claude-opus-4-6", "opus": "" }
  }]
}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ccSwitchHome, "settings.json"), []byte(`{
  "currentProviderClaude": "SHOULD_NOT_LEAK"
}`), 0o600); err != nil {
		t.Fatal(err)
	}

	h := newTestHandler()
	req := httptest.NewRequest(http.MethodGet, "/v1/model-catalog", nil)
	rec := httptest.NewRecorder()

	h.GetModelCatalog(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
	body := rec.Body.String()
	if strings.Contains(body, "SHOULD_NOT_LEAK") {
		t.Fatalf("model catalog leaked secret material: %s", body)
	}
	for _, want := range []string{"gpt-5.5", "opus[1m]", "deepseek-v4-pro", "claude-opus-4-6", "cc-switch"} {
		if !strings.Contains(body, want) {
			t.Fatalf("model catalog missing %q in %s", want, body)
		}
	}
}
