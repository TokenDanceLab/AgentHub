package config

import (
	"log/slog"
	"time"
)

// AccountOIDCConfig is the Hub-side relying-party configuration for TokenDance
// Account. Provider endpoints are discovered from IssuerURL; no internal
// Account endpoint or arbitrary request-supplied issuer is configurable.
type AccountOIDCConfig struct {
	// IssuerURL is the canonical Account issuer used for discovery and exact
	// authorization-response issuer validation.
	IssuerURL string `mapstructure:"issuer_url"`
	// ClientID is the confidential AgentHub OIDC client registered in Account.
	ClientID string `mapstructure:"client_id"`
	// ClientSecret stays server-side and is only used for a Basic-authenticated
	// token exchange. It must come from the deployment secret store.
	ClientSecret string `mapstructure:"client_secret"`
	// RedirectURI is the primary browser callback used when a client omits one.
	RedirectURI string `mapstructure:"redirect_uri"`
	// AllowedRedirectURIs lists exact additional callbacks accepted for this
	// client. Desktop loopback callbacks use a fixed registered port.
	AllowedRedirectURIs []string `mapstructure:"allowed_redirect_uris"`
	// HTTPTimeout bounds discovery, token, UserInfo and JWKS requests.
	HTTPTimeout time.Duration `mapstructure:"http_timeout"`
	// MaxResponseBodyBytes is the fail-closed cap for provider responses.
	MaxResponseBodyBytes int64 `mapstructure:"max_response_body_bytes"`
}

// LogValue implements slog.LogValuer to redact secrets when config is logged.
func (a AccountOIDCConfig) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("issuer_url", a.IssuerURL),
		slog.String("client_id", a.ClientID),
		slog.String("client_secret", "[REDACTED]"),
		slog.String("redirect_uri", a.RedirectURI),
		slog.Any("allowed_redirect_uris", a.AllowedRedirectURIs),
		slog.Duration("http_timeout", a.HTTPTimeout),
		slog.Int64("max_response_body_bytes", a.MaxResponseBodyBytes),
	)
}
