package config

import (
	"log/slog"
	"time"
)

// Residual pure-helper peel #1134: TokenDance ID OIDC/OAuth2 config section.

// TokenDanceIDConfig holds OIDC/OAuth2 configuration for TokenDance ID integration.
type TokenDanceIDConfig struct {
	// IssuerURL is the TokenDance ID issuer base URL (e.g. https://id.tokendancelab.com).
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
	// TokenURL overrides the OIDC token exchange endpoint. Derived from
	// issuer_url/oidc/token when empty. Production points it at the DNS-only
	// id-token.tokendancelab.com machine entry to bypass the public edge
	// challenge (Bot Fight) that blocks non-JS clients (2026-08-08).
	// Env: AGENTHUB_TOKENDANCE_ID_TOKEN_URL.
	TokenURL string `mapstructure:"token_url"`
	// HTTPTimeout bounds the OIDC token-exchange and JWKS fetch requests
	// (#1564). Zero falls back to 10s. Env: AGENTHUB_TOKENDANCE_ID_HTTP_TIMEOUT.
	HTTPTimeout time.Duration `mapstructure:"http_timeout"`
	// MaxResponseBodyBytes is the fail-closed cap on provider token/JWKS
	// response bodies (#1564). Zero falls back to 64 KiB.
	// Env: AGENTHUB_TOKENDANCE_ID_MAX_RESPONSE_BODY_BYTES.
	MaxResponseBodyBytes int64 `mapstructure:"max_response_body_bytes"`
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
		slog.String("token_url", t.TokenURL),
		slog.Duration("http_timeout", t.HTTPTimeout),
		slog.Int64("max_response_body_bytes", t.MaxResponseBodyBytes),
	)
}
