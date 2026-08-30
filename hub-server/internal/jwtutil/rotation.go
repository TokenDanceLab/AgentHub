package jwtutil

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"sync"
	"time"
)

// Clock abstracts time source for rotation tests.
type Clock interface {
	Now() time.Time
}

// RealClock uses the system clock.
type RealClock struct{}

func (RealClock) Now() time.Time { return time.Now() }

// RotationConfig controls key rotation behavior.
type RotationConfig struct {
	// GracePeriod is how long an old key remains verifiable after being
	// superseded. Must be >= the maximum access-token TTL so in-flight
	// tokens survive the transition.
	GracePeriod time.Duration

	// KeyBytes is the byte-length of each generated HMAC secret.
	// 32 bytes (256 bits) matches HS256 security level.
	KeyBytes int
}

// DefaultRotationConfig returns conservative defaults.
func DefaultRotationConfig() RotationConfig {
	return RotationConfig{
		GracePeriod: 30 * time.Minute, // default access_ttl(15m) + 15m buffer
		KeyBytes:    32,
	}
}

// Rotator orchestrates key generation, activation, and deferred removal on
// a KeyManager. It is safe for concurrent use. Scheduling (periodic tick) is
// external — see the scheduler in app/wiring or a dedicated ticker wrapper.
type Rotator struct {
	km    *KeyManager
	clock Clock
	cfg   RotationConfig

	mu      sync.Mutex
	pending []pendingRemoval // old kids awaiting grace-period expiry
}

type pendingRemoval struct {
	kid      string
	removeAt time.Time
}

// NewRotator creates a Rotator bound to the given KeyManager.
func NewRotator(km *KeyManager, clock Clock, cfg RotationConfig) *Rotator {
	if clock == nil {
		clock = RealClock{}
	}
	if cfg.KeyBytes <= 0 {
		cfg.KeyBytes = 32
	}
	return &Rotator{km: km, clock: clock, cfg: cfg}
}

// RotateOnce performs a single key rotation:
//  1. Generate a new kid + secret
//  2. AddKey (register)
//  3. SetActiveKey (new kid signs future tokens)
//  4. Schedule previous active kid for removal after GracePeriod
//
// On any failure the previous state is preserved (no partial rotation).
// Returns the newly activated kid.
func (r *Rotator) RotateOnce() (string, error) {
	prevKid := r.km.ActiveKeyID()

	newKid, err := generateKid()
	if err != nil {
		return "", fmt.Errorf("generate kid: %w", err)
	}
	newSecret, err := generateSecret(r.cfg.KeyBytes)
	if err != nil {
		return "", fmt.Errorf("generate secret: %w", err)
	}

	if err := r.km.AddKey(newKid, newSecret); err != nil {
		return "", fmt.Errorf("add key: %w", err)
	}
	if err := r.km.SetActiveKey(newKid); err != nil {
		// Roll back added key to avoid orphan entries.
		_ = r.km.RemoveKey(newKid) // best-effort; ignore error
		return "", fmt.Errorf("set active: %w", err)
	}

	// Schedule previous key removal after grace period. Skip when prevKid
	// equals newKid (shouldn't happen but defensive).
	if prevKid != "" && prevKid != newKid {
		r.mu.Lock()
		r.pending = append(r.pending, pendingRemoval{
			kid:      prevKid,
			removeAt: r.clock.Now().Add(r.cfg.GracePeriod),
		})
		r.mu.Unlock()
	}
	return newKid, nil
}

// Tick processes pending key removals whose grace period has expired at the
// given time. Returns the number of keys removed and any errors encountered
// (removal failures do not stop processing of subsequent entries).
func (r *Rotator) Tick(now time.Time) (removed int, errs []error) {
	r.mu.Lock()
	remaining := r.pending[:0]
	toRemove := make([]string, 0, len(r.pending))
	for _, p := range r.pending {
		if !now.Before(p.removeAt) {
			toRemove = append(toRemove, p.kid)
		} else {
			remaining = append(remaining, p)
		}
	}
	r.pending = remaining
	r.mu.Unlock()

	for _, kid := range toRemove {
		if err := r.km.RemoveKey(kid); err != nil {
			errs = append(errs, fmt.Errorf("remove key %q: %w", kid, err))
		} else {
			removed++
		}
	}
	return removed, errs
}

// PendingCount reports how many old keys are still within their grace period.
func (r *Rotator) PendingCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.pending)
}

// generateKid produces a URL-safe random key ID (16 bytes → 22 chars base64url).
func generateKid() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "k-" + base64.RawURLEncoding.EncodeToString(b), nil
}

// generateSecret produces a cryptographically random secret of n bytes,
// returned as a base64url-encoded string (safe for map storage / env vars).
func generateSecret(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
