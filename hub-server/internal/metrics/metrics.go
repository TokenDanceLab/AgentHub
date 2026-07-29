package metrics

import (
	"sync"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
)

var (
	HTTPRequestsTotal                      *prometheus.CounterVec
	HTTPDuration                           *prometheus.HistogramVec
	WSConnections                          prometheus.Gauge
	WSDroppedFrames                        prometheus.Counter
	WSRateLimitedMsgs                      prometheus.Counter
	WSKickedConns                          prometheus.Counter
	DBPoolInUse                            prometheus.Gauge
	RedisPoolHitsTotal                     prometheus.Counter // G11: was Gauge redis_pool_hits; PoolStats().Hits is cumulative → Counter
	EventBusQueueLen                       prometheus.Gauge
	EventBusPanics                         prometheus.Counter
	TeamFaultEscalationReviewEventFailures prometheus.Counter

	// WSSendFrameBypass counts WebSocket frames sent via handler.sendFrame,
	// which bypasses Manager.PushToConn and therefore the per-connection
	// seq_id stamping contract (G12 KNOWN DEFECT). The frame_type label
	// carries the ws.Frame.Type value so operators can see which frame
	// types escape seq_id stamping. Observability-only: this metric does
	// not change the bypass control flow.
	WSSendFrameBypass *prometheus.CounterVec

	// G3 — Delivery outbox retry / dead-letter / redispatch observability.
	DeliveryOutboxRetryAttempts      prometheus.Counter
	DeliveryOutboxDeadLetters        *prometheus.CounterVec
	DeliveryOutboxRedispatchFailures prometheus.Counter
	DeliveryOutboxScanFailures       prometheus.Counter

	// G4 — Edge HTTP dispatch failure observability (6 failure categories).
	AgentDispatchEdgeHTTPFailures *prometheus.CounterVec

	// G9 — JWT / WS auth verification failure observability (security).
	JWTVerificationFailures *prometheus.CounterVec
	WSAuthFailures          *prometheus.CounterVec
	JTIBlacklistCheckErrors prometheus.Counter

	once sync.Once
)

func Register() {
	once.Do(func() {
		HTTPRequestsTotal = prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "http_requests_total",
				Help: "Total number of HTTP requests.",
			},
			[]string{"method", "path", "status"},
		)

		HTTPDuration = prometheus.NewHistogramVec(
			prometheus.HistogramOpts{
				Name:    "http_request_duration_seconds",
				Help:    "HTTP request duration in seconds.",
				Buckets: prometheus.DefBuckets,
			},
			[]string{"method", "path", "status"},
		)

		WSConnections = prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "ws_connections",
				Help: "Current number of WebSocket connections.",
			},
		)

		WSDroppedFrames = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "ws_dropped_frames_total",
				Help: "Total number of WebSocket frames dropped due to full send buffer.",
			},
		)

		WSRateLimitedMsgs = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "ws_rate_limited_messages_total",
				Help: "Total number of WebSocket messages dropped due to per-connection rate limiting.",
			},
		)

		WSKickedConns = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "ws_kicked_connections_total",
				Help: "Total number of WebSocket connections kicked due to per-user concurrent connection limit.",
			},
		)

		DBPoolInUse = prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "db_pool_in_use",
				Help: "Number of database connections currently in use.",
			},
		)

		RedisPoolHitsTotal = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "redis_pool_hits_total",
				Help: "Total cumulative Redis connection pool hits (was Gauge redis_pool_hits; PoolStats().Hits is monotonic).",
			},
		)

		EventBusQueueLen = prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "eventbus_queue_length",
				Help: "Pending events in the event bus queue.",
			},
		)

		EventBusPanics = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "eventbus_panics_total",
				Help: "Total number of panics recovered in the event bus.",
			},
		)

		TeamFaultEscalationReviewEventFailures = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "team_fault_escalation_review_event_failures_total",
				Help: "Total number of team.escalation.review events that failed to append during fault escalation handling.",
			},
		)

		WSSendFrameBypass = prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "ws_sendframe_bypass_total",
				Help: "Total WebSocket frames sent via handler.sendFrame, bypassing Manager.PushToConn seq_id stamping (G12).",
			},
			[]string{"frame_type"},
		)

		// G3 — Delivery outbox observability counters.
		DeliveryOutboxRetryAttempts = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "delivery_outbox_retry_attempts_total",
				Help: "Total number of delivery outbox entries scheduled for retry.",
			},
		)

		DeliveryOutboxDeadLetters = prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "delivery_outbox_dead_letter_total",
				Help: "Total number of delivery outbox entries moved to dead-letter (terminal).",
			},
			[]string{"reason"},
		)

		DeliveryOutboxRedispatchFailures = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "delivery_outbox_redispatch_failures_total",
				Help: "Total number of delivery outbox redispatch attempts that failed.",
			},
		)

		DeliveryOutboxScanFailures = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "delivery_outbox_scan_failures_total",
				Help: "Total number of delivery outbox retry-scan failures.",
			},
		)

		// G4 — Edge HTTP dispatch failure counter (6 failure categories).
		AgentDispatchEdgeHTTPFailures = prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "agent_dispatch_edge_http_failures_total",
				Help: "Total number of Edge HTTP dispatch failures by reason.",
			},
			[]string{"reason"},
		)

		// G9 — JWT / WS auth verification failure counters (security).
		JWTVerificationFailures = prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "jwt_verification_failures_total",
				Help: "Total number of JWT verification failures by reason.",
			},
			[]string{"reason"},
		)

		WSAuthFailures = prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "ws_auth_failures_total",
				Help: "Total number of WebSocket auth failures by reason.",
			},
			[]string{"reason"},
		)

		JTIBlacklistCheckErrors = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "jti_blacklist_check_errors_total",
				Help: "Total number of access-token jti blacklist check errors (Redis fail-open path).",
			},
		)

		prometheus.MustRegister(HTTPRequestsTotal)
		prometheus.MustRegister(HTTPDuration)
		prometheus.MustRegister(WSConnections)
		prometheus.MustRegister(WSDroppedFrames)
		prometheus.MustRegister(WSRateLimitedMsgs)
		prometheus.MustRegister(WSKickedConns)
		prometheus.MustRegister(DBPoolInUse)
		prometheus.MustRegister(RedisPoolHitsTotal)
		prometheus.MustRegister(EventBusQueueLen)
		prometheus.MustRegister(EventBusPanics)
		prometheus.MustRegister(TeamFaultEscalationReviewEventFailures)
		prometheus.MustRegister(WSSendFrameBypass)
		prometheus.MustRegister(DeliveryOutboxRetryAttempts)
		prometheus.MustRegister(DeliveryOutboxDeadLetters)
		prometheus.MustRegister(DeliveryOutboxRedispatchFailures)
		prometheus.MustRegister(DeliveryOutboxScanFailures)
		prometheus.MustRegister(AgentDispatchEdgeHTTPFailures)
		prometheus.MustRegister(JWTVerificationFailures)
		prometheus.MustRegister(WSAuthFailures)
		prometheus.MustRegister(JTIBlacklistCheckErrors)
		// Built-in collectors may already be registered; ignore if so.
		_ = prometheus.Register(collectors.NewGoCollector())
		_ = prometheus.Register(collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))
	})
}
