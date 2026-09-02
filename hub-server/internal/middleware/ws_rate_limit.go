package middleware

import (
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	sharederr "github.com/agenthub/pkg/errcode"
)

// wsIPLimiter tracks per-IP rate limiters for WebSocket connection attempts.
// Each IP gets a token-bucket limiter allowing WSIPRateLimitPerMinute connections
// per minute with a burst equal to the same value.
//
// A process-wide default instance (wsIPRL) is used by the production router via
// WSIPRateLimit(). Tests must construct an isolated instance with
// NewWSIPRateLimiter and pass it to WSIPRateLimitWithLimiter so that the shared
// token buckets do not leak state across test runs (see -count=N).
type wsIPLimiter struct {
	mu       sync.Mutex
	limiters map[string]*ipEntry
	stopCh   chan struct{}
	stopOnce sync.Once
}

type ipEntry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// wsIPRL is the process-wide default limiter used by WSIPRateLimit(). It is
// initialized lazily by newDefaultWSIPRateLimiter so that the background cleanup
// goroutine is only started once and only in non-test contexts that actually
// mount the production middleware.
var (
	wsIPRL       *wsIPLimiter
	wsIPRLInitMu sync.Once
)

// newDefaultWSIPRateLimiter returns the singleton default limiter, starting its
// background cleanup goroutine on first call.
func newDefaultWSIPRateLimiter() *wsIPLimiter {
	wsIPRLInitMu.Do(func() {
		wsIPRL = newWSIPRateLimiter()
	})
	return wsIPRL
}

// newWSIPRateLimiter constructs an isolated wsIPLimiter with its own token
// buckets and background cleanup goroutine. Callers (especially tests) must
// call Stop() when done to stop the goroutine.
func newWSIPRateLimiter() *wsIPLimiter {
	l := &wsIPLimiter{
		limiters: make(map[string]*ipEntry),
		stopCh:   make(chan struct{}),
	}
	go l.cleanup()
	return l
}

// NewWSIPRateLimiter is the exported constructor for tests and other isolated
// callers. It returns a fresh limiter with its own cleanup goroutine; the
// caller MUST call Stop() (e.g. via t.Cleanup) to release it.
//
//nolint:revive // intentional: test constructor returns the concrete type so tests can drive it directly.
func NewWSIPRateLimiter() *wsIPLimiter {
	return newWSIPRateLimiter()
}

// getLimiter returns (or creates) the rate.Limiter for the given IP.
func (l *wsIPLimiter) getLimiter(ip string) *rate.Limiter {
	l.mu.Lock()
	defer l.mu.Unlock()

	if entry, ok := l.limiters[ip]; ok {
		entry.lastSeen = time.Now()
		return entry.limiter
	}

	// Allow WSIPRateLimitPerMinute connections per minute. Burst equals the
	// per-minute limit so a client can burst up to the limit immediately.
	r := rate.Every(time.Minute / time.Duration(config.WSIPRateLimitPerMinute))
	limiter := rate.NewLimiter(r, config.WSIPRateLimitPerMinute)
	l.limiters[ip] = &ipEntry{limiter: limiter, lastSeen: time.Now()}
	return limiter
}

// Reset drops all per-IP token buckets so the limiter starts fresh. Tests use
// this between subtests when reusing a single instance, though constructing a
// new instance per test is preferred.
func (l *wsIPLimiter) Reset() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.limiters = make(map[string]*ipEntry)
}

// cleanup removes limiters not used in the last 10 minutes.
func (l *wsIPLimiter) cleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			l.mu.Lock()
			cutoff := time.Now().Add(-10 * time.Minute)
			for ip, entry := range l.limiters {
				if entry.lastSeen.Before(cutoff) {
					delete(l.limiters, ip)
				}
			}
			l.mu.Unlock()
		case <-l.stopCh:
			return
		}
	}
}

// Stop shuts down the background cleanup goroutine. It is safe to call multiple
// times (only the first call closes the channel). If not called, the goroutine
// runs for the lifetime of the process.
func (l *wsIPLimiter) Stop() {
	// sync.Once: the previous check-then-close select could double-close
	// stopCh when two callers raced (double-close panics, #2154).
	l.stopOnce.Do(func() { close(l.stopCh) })
}

// StopWSIPRateLimiter stops the cleanup goroutine of the process-wide default
// limiter, if it was initialized. Wired into App.Shutdown (#2154): the goroutine
// no longer outlives the graceful-shutdown window. Safe to call when the
// limiter was never mounted (no-op); if never called, the goroutine still exits
// with the process.
func StopWSIPRateLimiter() {
	if wsIPRL != nil {
		wsIPRL.Stop()
	}
}

// WSIPRateLimit is a Gin middleware that enforces per-IP rate limiting for
// WebSocket upgrade requests using the process-wide default limiter. It must
// be placed BEFORE the WS handler in the middleware chain so that HTTP 429 is
// returned without attempting the upgrade.
func WSIPRateLimit() gin.HandlerFunc {
	return WSIPRateLimitWithLimiter(newDefaultWSIPRateLimiter())
}

// WSIPRateLimitWithLimiter returns a Gin middleware backed by the given
// wsIPLimiter. Tests pass an isolated instance so token buckets do not leak
// across runs; the caller is responsible for calling limiter.Stop().
func WSIPRateLimitWithLimiter(l *wsIPLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()
		limiter := l.getLimiter(ip)
		if !limiter.Allow() {
			slog.Warn("ws rate limit: too many connection attempts from IP",
				"client_ip", ip,
				"limit", config.WSIPRateLimitPerMinute,
			)
			c.Header("Retry-After", "60")
			fail(c, errcode.New(sharederr.WSRateLimited,
				fmt.Sprintf("too many WebSocket connections from this IP (limit: %d/min)", config.WSIPRateLimitPerMinute),
				http.StatusTooManyRequests))
			c.Abort()
			return
		}
		c.Next()
	}
}

// WSUserConnLimiter tracks active WebSocket connections per user and enforces
// the WSMaxConnsPerUser limit. When the limit is exceeded the oldest connection
// is kicked (by closing it) to make room for the new one.
type WSUserConnLimiter struct {
	mu     sync.Mutex
	conns  map[string][]string // user_id -> sorted list of conn IDs (oldest first)
	kickFn func(connID string)
}

// NewWSUserConnLimiter creates a new per-user connection limiter. kickFn is
// called to close a connection that exceeds the limit (e.g. close the WS conn
// and unregister from the manager).
func NewWSUserConnLimiter(kickFn func(connID string)) *WSUserConnLimiter {
	return &WSUserConnLimiter{
		conns:  make(map[string][]string),
		kickFn: kickFn,
	}
}

// Acquire registers a new connection for the given user. If the user already
// has WSMaxConnsPerUser connections, the oldest one is kicked. The caller must
// call Release when the connection ends.
func (l *WSUserConnLimiter) Acquire(userID, connID string) {
	if userID == "" {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	conns := l.conns[userID]
	conns = append(conns, connID)

	// Kick oldest connections if over limit.
	for len(conns) > config.WSMaxConnsPerUser {
		oldestConnID := conns[0]
		conns = conns[1:]
		slog.Warn("ws: kicking oldest connection for user (concurrent limit exceeded)",
			"user_id", userID,
			"kicked_conn_id", oldestConnID,
			"max_conns", config.WSMaxConnsPerUser,
		)
		if l.kickFn != nil {
			// Kick outside the lock to avoid deadlock.
			go l.kickFn(oldestConnID)
		}
	}

	l.conns[userID] = conns
}

// Release removes a connection from the user's active set. Idempotent.
func (l *WSUserConnLimiter) Release(userID, connID string) {
	if userID == "" {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	conns := l.conns[userID]
	for i, id := range conns {
		if id == connID {
			l.conns[userID] = append(conns[:i], conns[i+1:]...)
			break
		}
	}
	if len(l.conns[userID]) == 0 {
		delete(l.conns, userID)
	}
}
