package config

import "log/slog"

// Residual pure-helper peel #1134: TokenDance ID OIDC/OAuth2 config section.

// TokenDanceIDConfig holds OIDC/OAuth2 configuration for TokenDance ID integration.
type TokenDanceIDConfig struct {
	// IssuerURL is the TokenDance ID issuer base URL (e.g. https://id.vectorcontrol.tech).
	IssuerURL string `mapstructure:"issuer_url"`
	// JWKSURI overrides the JWKS endpoint. Derived from issuer_url/oidc/jwks when empty.
	JWKSURI string `mapstructure:"jwks_uri"`
	// ClientID is the OIDC client ID registered with TokenDance ID for AgentHub.
	ClientID string `mapstructure:"client_id"`
	// ClientSecret is the OIDC client secret. Must be set via environment variable, never in config YAML.
	ClientSecret string `mapstructure:"client_secret"`
	// RedirectURI is the Hub-owned OIDC callback URL.
	RedirectURI string `mapstructure:"redirect_uri"`
	// AllowedRedirectURIs lists additional browser/native callbacks accepted for one OIDC round trip.
	AllowedRedirectURIs []string `mapstructure:"allowed_redirect_uris"`
}

// LogValue implements slog.LogValuer to redact secrets when config is logged.
func (t TokenDanceIDConfig) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("issuer_url", t.IssuerURL),
		slog.String("jwks_uri", t.JWKSURI),
		slog.String("client_id", t.ClientID),
		slog.String("client_secret", "[REDACTED]"),
		slog.String("redirect_uri", t.RedirectURI),
		slog.Any("allowed_redirect_uris", t.AllowedRedirectURIs),
	)
}
