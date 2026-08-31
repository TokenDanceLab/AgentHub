package hub

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"
)

// TokenProvider owns the Edge's Hub session bearer token and rotates it via
// the Hub refresh endpoint before expiry (#1410). The Edge is a long-lived
// process but Hub access tokens are short-lived (dev default 15m); without
// rotation every callback starts 401ing once the token expires.
//
// Single-owner rule: Hub refresh tokens rotate on use, so the token handed to
// the Edge must NOT be the same refresh token the Desktop keeps for its own
// session — whoever refreshes first invalidates the other's copy. Production
// launchers should mint a dedicated Hub session for the Edge (same user,
// separate device) and pass that pair via --hub-token/--hub-refresh-token;
// a Desktop that owns its session instead pushes freshly minted pairs through
// SetTokens when it refreshes.
//
// The provider is deliberately minimal and read-heavy: AccessToken() is called
// on every outbound callback, so it must not block on network I/O. Rotation
// happens on a background goroutine that only writes the pair under the lock.
type TokenProvider struct {
	mu           sync.RWMutex
	accessToken  string
	refreshToken string
	hubURL       string
	client       *http.Client

	stop     chan struct{}
	stopOnce sync.Once
	// stopWG tracks the rotation goroutine so Stop() can wait for an
	// in-flight refresh to drain before returning — otherwise tests and
	// process shutdown leak live HTTP requests (httptest.Server.Close
	// blocks on the still-active connection, observed on slow hosts).
	stopWG sync.WaitGroup
	// lastErr mirrors the most recent rotation error for diagnostics.
	lastErr string
}

// tokenRefreshLead is how far before expiry the rotation kicks in. Must stay
// comfortably above the Hub refresh round-trip plus clock skew. 2 minutes
// covers the worst-case NTP offset between Edge local clock and Hub issuance
// clock (#2135 F3).
const tokenRefreshLead = 2 * time.Minute

// tokenRefreshRetryInterval is the retry cadence after a failed rotation.
const tokenRefreshRetryInterval = 30 * time.Second

// refreshEndpoint is the Hub client-auth refresh route (desktop/web session
// tokens rotate through the same endpoint).
const refreshEndpoint = "/client/auth/refresh"

// NewTokenProvider builds a provider over the given credentials. A non-nil
// http.Client is required (composition root injects it).
func NewTokenProvider(hubURL, accessToken, refreshToken string, client *http.Client) *TokenProvider {
	return &TokenProvider{
		accessToken:  accessToken,
		refreshToken: refreshToken,
		hubURL:       strings.TrimRight(hubURL, "/"),
		client:       client,
		stop:         make(chan struct{}),
	}
}

// AccessToken returns the current bearer token. Never blocks on network I/O.
func (p *TokenProvider) AccessToken() string {
	if p == nil {
		return ""
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.accessToken
}

// SetTokens replaces the pair (e.g. the Desktop pushes freshly minted session
// tokens when reconnecting). Safe for concurrent use.
func (p *TokenProvider) SetTokens(accessToken, refreshToken string) {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.accessToken = accessToken
	p.refreshToken = refreshToken
	p.lastErr = ""
}

// LastError returns the most recent rotation error ("" when healthy).
func (p *TokenProvider) LastError() string {
	if p == nil {
		return ""
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.lastErr
}

// StartAutoRefresh launches the background rotation loop. It schedules the
// first refresh shortly before the access token's exp claim; after each
// successful rotation it re-schedules from the new token's exp. When the exp
// claim cannot be parsed it falls back to a conservative 5-minute cadence.
func (p *TokenProvider) StartAutoRefresh() {
	if p == nil {
		return
	}
	p.stopWG.Add(1)
	go func() {
		defer p.stopWG.Done()
		delay := p.nextRefreshDelay()
		for {
			select {
			case <-p.stop:
				return
			case <-time.After(delay):
			}
			if ok := p.refresh(); ok {
				delay = p.nextRefreshDelay()
			} else {
				delay = tokenRefreshRetryInterval
			}
		}
	}()
}

// Stop terminates the rotation loop and waits for an in-flight refresh to
// drain. Idempotent.
func (p *TokenProvider) Stop() {
	if p == nil {
		return
	}
	p.stopOnce.Do(func() {
		close(p.stop)
	})
	p.stopWG.Wait()
}

// nextRefreshDelay computes the sleep until the next rotation from the current
// access token's exp claim.
func (p *TokenProvider) nextRefreshDelay() time.Duration {
	p.mu.RLock()
	token := p.accessToken
	p.mu.RUnlock()

	exp, ok := jwtExpirySeconds(token)
	if !ok {
		return 5 * time.Minute // unparsable exp: conservative fallback cadence
	}
	delay := time.Until(time.Unix(exp, 0)) - tokenRefreshLead
	if delay < 0 {
		return 0
	}
	return delay
}

// refresh performs one rotation attempt against the Hub refresh endpoint.
// It returns true when the pair was rotated successfully.
func (p *TokenProvider) refresh() bool {
	p.mu.RLock()
	refreshToken := p.refreshToken
	p.mu.RUnlock()
	if refreshToken == "" {
		return false // nothing to rotate with — the Desktop must supply new tokens
	}

	body, err := json.Marshal(map[string]string{"refresh_token": refreshToken})
	if err != nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.hubURL+refreshEndpoint, bytes.NewReader(body))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		p.setLastErr(err.Error())
		return false
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		p.setLastErr(err.Error())
		return false
	}
	if resp.StatusCode != http.StatusOK {
		p.setLastErr("refresh status " + resp.Status)
		return false
	}
	var payload struct {
		Code string `json:"code"`
		Data struct {
			AccessToken  string `json:"access_token"`
			RefreshToken string `json:"refresh_token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(respBody, &payload); err != nil {
		p.setLastErr("refresh decode: " + err.Error())
		return false
	}
	if payload.Data.AccessToken == "" {
		p.setLastErr("refresh response missing access_token")
		return false
	}
	p.SetTokens(payload.Data.AccessToken, payload.Data.RefreshToken)
	slog.Info("hub token rotated", "exp_in", p.expiresIn().Round(time.Second))
	return true
}

// expiresIn reports how long the current access token stays valid (0 when the
// exp claim is unparsable).
func (p *TokenProvider) expiresIn() time.Duration {
	p.mu.RLock()
	token := p.accessToken
	p.mu.RUnlock()
	exp, ok := jwtExpirySeconds(token)
	if !ok {
		return 0
	}
	remaining := time.Until(time.Unix(exp, 0))
	if remaining < 0 {
		return 0
	}
	return remaining
}

func (p *TokenProvider) setLastErr(msg string) {
	p.mu.Lock()
	p.lastErr = msg
	p.mu.Unlock()
	slog.Warn("hub token refresh failed", "error", msg)
}

// jwtExpirySeconds extracts the exp claim (unix seconds) from an unsigned JWT
// without verifying the signature — scheduling only, never authorization.
func jwtExpirySeconds(token string) (int64, bool) {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return 0, false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return 0, false
	}
	var claims struct {
		Exp int64 `json:"exp"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return 0, false
	}
	if claims.Exp <= 0 {
		return 0, false
	}
	return claims.Exp, true
}
