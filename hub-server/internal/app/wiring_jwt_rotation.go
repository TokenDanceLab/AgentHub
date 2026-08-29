package app

import (
	"context"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/jwtutil"
	"github.com/agenthub/hub-server/internal/metrics"
)

// maybeStartJWTRotation starts the JWT key rotation scheduler when explicitly
// enabled via AGENTHUB_JWT_ROTATION_ENABLED=true. Default is disabled (safe
// opt-in). See BLOCKED.md B1 for middleware migration prerequisite before
// enabling in production.
func (a *App) maybeStartJWTRotation(ctx context.Context) {
	if !envBool(os.Getenv(config.JWTRotationEnabledEnvVar)) {
		slog.Info("jwt rotation scheduler disabled (set AGENTHUB_JWT_ROTATION_ENABLED=true to enable)")
		return
	}

	interval := envDuration(os.Getenv(config.JWTRotationIntervalEnvVar), config.DefaultJWTRotationInterval)
	grace := envDuration(os.Getenv(config.JWTRotationGracePeriodEnvVar), config.DefaultJWTRotationGracePeriod)

	// Build a KeyManager from current config secrets. When no multi-key
	// config exists, bootstrap with the single legacy secret so rotation
	// has a starting point.
	secrets := a.Config.JWT.Secrets
	activeKid := a.Config.JWT.ActiveKeyID
	if len(secrets) == 0 && a.Config.JWT.Secret != "" {
		secrets = map[string]string{"default": a.Config.JWT.Secret}
		activeKid = "default"
	}
	if len(secrets) == 0 {
		slog.Error("jwt rotation: no JWT secrets configured; scheduler not started")
		return
	}
	km, err := jwtutil.NewKeyManager(secrets, activeKid)
	if err != nil {
		slog.Error("jwt rotation: failed to create KeyManager", "error", err)
		return
	}

	metrics.RegisterJWTRotation()

	rotator := jwtutil.NewRotator(km, jwtutil.RealClock{}, jwtutil.RotationConfig{
		GracePeriod: grace,
		KeyBytes:    32,
	})
	observer := func(ok bool, pending int, rotErr error) {
		if ok {
			if metrics.JWTRotationsTotal != nil {
				metrics.JWTRotationsTotal.Inc()
			}
		} else {
			cat := "unknown"
			if rotErr != nil {
				cat = classifyRotationError(rotErr)
			}
			if metrics.JWTRotationFailuresTotal != nil {
				metrics.JWTRotationFailuresTotal.WithLabelValues(cat).Inc()
			}
		}
		if metrics.JWTRotationPendingKeys != nil {
			metrics.JWTRotationPendingKeys.Set(float64(pending))
		}
	}

	sched := jwtutil.NewScheduler(rotator, jwtutil.SchedulerConfig{
		Interval:    interval,
		GracePeriod: grace,
	}, observer)

	slog.Info("jwt rotation scheduler starting",
		"interval", interval,
		"grace_period", grace,
		"initial_keys", km.KeyCount(),
	)
	a.bg.Go(func() error {
		sched.Run(ctx)
		return nil
	})
}

func envBool(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "true", "1", "yes":
		return true
	default:
		return false
	}
}

func envDuration(v string, fallback time.Duration) time.Duration {
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		return fallback
	}
	return d
}

func classifyRotationError(err error) string {
	msg := err.Error()
	switch {
	case contains(msg, "generate kid"):
		return "generate_kid"
	case contains(msg, "generate secret"):
		return "generate_secret"
	case contains(msg, "add key"):
		return "add_key"
	case contains(msg, "set active"):
		return "set_active"
	default:
		return "other"
	}
}

func contains(s, substr string) bool { return len(s) >= len(substr) && searchString(s, substr) }

func searchString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// Ensure strconv import is used (for potential future parsing).
var _ = strconv.ParseBool
