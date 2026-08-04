// Package outboundmetrics defines the reusable outbound HTTP metrics and
// correlation contract (#1595). Every production outbound call site records
// through a Recorder so metric names and label dimensions stay uniform across
// Hub and Edge, independent of the server-local metrics registry.
//
// Contract:
//   - outbound_requests_total{provider,purpose,category,status}
//   - outbound_request_duration_seconds{provider,purpose,category,status}
//   - correlation: outbound requests propagate the caller's request_id as the
//     X-Request-ID header (see pkg/reqlog.SetRequestIDHeader); logs use the
//     same request_id key.
//
// Recorder is nil-safe: an unset recorder is a no-op, so call sites can record
// unconditionally without wiring changes. Build one recorder per server at the
// composition root and register it on the server's registry.
package outboundmetrics

import (
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Metric names and label names are a stable contract — renaming breaks
// dashboards and the #1595 documentation in
// docs/architecture/08-outbound-http.md.
const (
	MetricRequestsTotal   = "outbound_requests_total"
	MetricDurationSeconds = "outbound_request_duration_seconds"
	LabelProvider         = "provider"
	LabelPurpose          = "purpose"
	LabelCategory         = "category"
	LabelStatus           = "status"
)

// Provider label values identify the fixed operator-configurable endpoint
// owner (not the transport).
const (
	ProviderEdge          = "edge"           // Hub→Edge dispatch
	ProviderHub           = "hub"            // Edge→Hub callback, Edge MCP sync
	ProviderTokenDanceID  = "tokendance_id"  // OIDC token exchange, JWKS fetch
	ProviderModelProvider = "model_provider" // SDK adapters (openai/anthropic)
)

// Purpose label values describe the intent of the outbound call.
const (
	PurposeDispatch      = "dispatch"
	PurposeCallback      = "callback"
	PurposeTokenExchange = "token_exchange"
	PurposeJWKSFetch     = "jwks_fetch"
	PurposeMCPSync       = "mcp_sync"
)

// Category label values are the coarse outcome class.
const (
	CategorySuccess = "success"
	CategoryFailure = "failure"
)

// Common status label values. Call sites reuse these where possible; a
// purpose-specific outcome may use its own stable string (e.g. the callback
// outcome categories).
const (
	StatusOK           = "ok"
	StatusNetworkError = "network_error"
	StatusTimeout      = "timeout_error"
	StatusBodyTooLarge = "body_too_large"
	StatusNonSuccess   = "non_success"
	StatusDecodeFail   = "decode_fail"
)

// Recorder instruments outbound calls against the #1595 contract metrics.
// All methods are nil-safe: a nil *Recorder (unconfigured server metrics) is
// a no-op.
type Recorder struct {
	requests *prometheus.CounterVec
	duration *prometheus.HistogramVec
}

// NewRecorder creates the contract metrics on reg. A nil reg uses
// prometheus.DefaultRegisterer. Build exactly one recorder per registry —
// constructing twice on the same registry panics (promauto).
func NewRecorder(reg prometheus.Registerer) *Recorder {
	if reg == nil {
		reg = prometheus.DefaultRegisterer
	}
	factory := promauto.With(reg)
	return &Recorder{
		requests: factory.NewCounterVec(
			prometheus.CounterOpts{
				Name: MetricRequestsTotal,
				Help: "Total number of production outbound HTTP calls by provider, purpose, outcome category and status.",
			},
			[]string{LabelProvider, LabelPurpose, LabelCategory, LabelStatus},
		),
		duration: factory.NewHistogramVec(
			prometheus.HistogramOpts{
				Name:    MetricDurationSeconds,
				Help:    "Duration of production outbound HTTP calls in seconds by provider, purpose, outcome category and status.",
				Buckets: prometheus.DefBuckets,
			},
			[]string{LabelProvider, LabelPurpose, LabelCategory, LabelStatus},
		),
	}
}

// Record increments the requests counter for one outbound call outcome.
// status carries the granular outcome (e.g. StatusOK, "unreachable",
// "body_too_large").
func (r *Recorder) Record(provider, purpose, category, status string) {
	if r == nil {
		return
	}
	r.requests.WithLabelValues(provider, purpose, category, status).Inc()
}

// Observe records the duration of one outbound call with the same label
// dimensions as Record.
func (r *Recorder) Observe(provider, purpose, category, status string, d time.Duration) {
	if r == nil {
		return
	}
	r.duration.WithLabelValues(provider, purpose, category, status).Observe(d.Seconds())
}
