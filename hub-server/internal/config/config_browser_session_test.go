package config

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestBrowserSessionConfigurationFailsClosed(t *testing.T) {
	base := Config{Server: ServerConfig{Env: "production"}, AccountOIDC: AccountOIDCConfig{ClientID: "client", RedirectURI: "https://hub.example.com/callback"}, BrowserSession: BrowserSessionConfig{Origin: "https://hub.example.com", RedirectURI: "https://hub.example.com/callback", PostLogoutRedirectURI: "https://hub.example.com" + BrowserLogoutCallbackPath, Secure: true, TTL: 12 * time.Hour}}
	require.NoError(t, base.validateBrowserSession())
	for name, change := range map[string]func(*Config){
		"insecure-cookie":       func(c *Config) { c.BrowserSession.Secure = false },
		"http":                  func(c *Config) { c.BrowserSession.Origin = "http://hub.example.com" },
		"missing-origin":        func(c *Config) { c.BrowserSession.Origin = "" },
		"wildcard":              func(c *Config) { c.BrowserSession.Origin = "https://*.example.com" },
		"cross-origin-callback": func(c *Config) { c.BrowserSession.RedirectURI = "https://evil.example/callback" },
		"wrong-logout-path":     func(c *Config) { c.BrowserSession.PostLogoutRedirectURI = "https://hub.example.com/" },
		"unbounded-ttl":         func(c *Config) { c.BrowserSession.TTL = 48 * time.Hour },
		"unregistered-callback": func(c *Config) { c.AccountOIDC.RedirectURI = "https://hub.example.com/other" },
	} {
		t.Run(name, func(t *testing.T) { cfg := base; change(&cfg); require.Error(t, cfg.validateBrowserSession()) })
	}
}

func TestBrowserSessionEnvOnlyConfiguration(t *testing.T) {
	t.Setenv("AGENTHUB_BROWSER_SESSION_ORIGIN", "https://hub.example.com")
	t.Setenv("AGENTHUB_BROWSER_SESSION_REDIRECT_URI", "https://hub.example.com/callback")
	t.Setenv("AGENTHUB_BROWSER_SESSION_POST_LOGOUT_REDIRECT_URI", "https://hub.example.com"+BrowserLogoutCallbackPath)
	t.Setenv("AGENTHUB_BROWSER_SESSION_TTL", "6h")
	cfg, err := Load(filepath.Join(t.TempDir(), "missing.yaml"))
	require.NoError(t, err)
	require.Equal(t, "https://hub.example.com", cfg.BrowserSession.Origin)
	require.True(t, cfg.BrowserSession.Secure)
	require.Equal(t, 6*time.Hour, cfg.BrowserSession.TTL)
}
