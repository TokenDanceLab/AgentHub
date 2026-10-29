package config

import (
	"fmt"
	"net/url"
	"strings"
	"time"
)

// BrowserSessionConfig enables the same-origin browser surface when Origin is
// configured. Native OIDC/bearer clients do not depend on browser cookies.
type BrowserSessionConfig struct {
	Origin                string        `mapstructure:"origin"`
	RedirectURI           string        `mapstructure:"redirect_uri"`
	PostLogoutRedirectURI string        `mapstructure:"post_logout_redirect_uri"`
	Secure                bool          `mapstructure:"secure"`
	TTL                   time.Duration `mapstructure:"ttl"`
}

const BrowserLogoutCallbackPath = "/client/auth/browser/logout/account/callback"

func (b BrowserSessionConfig) Enabled() bool { return b.Origin != "" }

func (c *Config) validateBrowserSession() error {
	b := c.BrowserSession
	if !b.Enabled() {
		if b.RedirectURI != "" || b.PostLogoutRedirectURI != "" {
			return fmt.Errorf("browser_session.origin is required")
		}
		return nil
	}
	origin, err := parseBrowserOrigin(b.Origin)
	if err != nil {
		return err
	}
	if err := b.validateTransport(origin, c.Server.Env); err != nil {
		return err
	}
	if b.TTL <= 0 || b.TTL > 24*time.Hour {
		return fmt.Errorf("browser_session.ttl must be positive and at most 24h")
	}
	if c.AccountOIDC.ClientID == "" {
		return fmt.Errorf("browser sessions require Account OIDC")
	}
	allowed := append([]string{c.AccountOIDC.RedirectURI}, c.AccountOIDC.AllowedRedirectURIs...)
	return b.validateCallbacks(allowed)
}

func parseBrowserOrigin(raw string) (*url.URL, error) {
	origin, err := url.Parse(raw)
	if err != nil || origin.Host == "" || origin.User != nil || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" || (origin.Scheme != "https" && origin.Scheme != "http") {
		return nil, fmt.Errorf("browser_session.origin must be an exact HTTP(S) origin")
	}
	if strings.ContainsAny(origin.Hostname(), "*?{}") {
		return nil, fmt.Errorf("browser_session.origin must not contain wildcards")
	}
	return origin, nil
}

func (b BrowserSessionConfig) validateTransport(origin *url.URL, env string) error {
	loopback := origin.Hostname() == "localhost" || origin.Hostname() == "127.0.0.1" || origin.Hostname() == "::1"
	if !loopback && (origin.Scheme != "https" || !b.Secure) {
		return fmt.Errorf("public browser sessions require HTTPS and secure cookies")
	}
	production := strings.EqualFold(env, "production") || strings.EqualFold(env, "prod") || strings.EqualFold(env, "release")
	if production && (!b.Secure || origin.Scheme != "https" || loopback) {
		return fmt.Errorf("production browser sessions require a public HTTPS origin and secure cookies")
	}
	return nil
}

func (b BrowserSessionConfig) validateCallbacks(allowed []string) error {
	for _, raw := range []string{b.RedirectURI, b.PostLogoutRedirectURI} {
		u, err := url.Parse(raw)
		if err != nil || u.Scheme+"://"+u.Host != b.Origin || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path == "" {
			return fmt.Errorf("browser callbacks must be exact paths on browser_session.origin")
		}
	}
	logout, _ := url.Parse(b.PostLogoutRedirectURI)
	if logout.Path != BrowserLogoutCallbackPath {
		return fmt.Errorf("browser logout callback must use %s", BrowserLogoutCallbackPath)
	}
	for _, callback := range allowed {
		if callback == b.RedirectURI {
			return nil
		}
	}
	return fmt.Errorf("browser redirect must be in the Account OIDC redirect allowlist")
}

func (b BrowserSessionConfig) CookieName() string {
	if b.Secure {
		return "__Host-agenthub_session"
	}
	return "agenthub_session_dev"
}

func (b BrowserSessionConfig) FlowCookieName() string {
	if b.Secure {
		return "__Host-agenthub_flow"
	}
	return "agenthub_flow_dev"
}

func (b BrowserSessionConfig) LogoutCookieName() string {
	if b.Secure {
		return "__Host-agenthub_logout"
	}
	return "agenthub_logout_dev"
}
