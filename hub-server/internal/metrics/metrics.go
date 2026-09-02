package metrics

import (
	"sync"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"

	"github.com/agenthub/pkg/outboundmetrics"
	"github.com/agenthub/pkg/safego"
)

// init wires the shared panic-recovery launcher to the Hub's panic counter.
// pkg/safego stays server-agnostic; the Hub attaches its observability hook
// here so a recovered goroutine panic increments goroutine_panic_recoveries
// for alerting (nil-guarded so builds that never call Register don't panic).
func init() {
	safego.SetPanicObserver(func(name string, panicValue any, stack string) {
		if GoroutinePanicRecoveries != nil {
			GoroutinePanicRecoveries.Inc()
		}
	})
}

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

	// G3-Gauge — Delivery outbox backlog by status. Refreshed every retry
	// tick by the retry loop (ScanRetryableDeliveries path) so operators see
	// pending/sent/retrying/dead population growth without polling the DB.
	// Distinct from the cumulative counters above: a Gauge shows the current
	// in-flight backlog, not lifetime totals.
	DeliveryOutboxBacklog *prometheus.GaugeVec

	// G4 — Edge HTTP dispatch failure observability (6 failure categories).
	AgentDispatchEdgeHTTPFailures *prometheus.CounterVec

	// G9 — JWT / WS auth verification failure observability (security).
	JWTVerificationFailures     *prometheus.CounterVec
	WSAuthFailures              *prometheus.CounterVec
	JTIBlacklistCheckErrors     prometheus.Counter
	RefreshBlacklistCheckErrors prometheus.Counter

	// RefreshTokenReuseTotal counts refresh attempts that presented an
	// already-revoked refresh-token row (#2154 F2 step ①). Signal-only:
	// the response stays AuthRefreshInvalid and no cascade revocation
	// happens. Reuse of a rotated-away token is structurally undetectable
	// in the DB (UpsertRefreshToken ON CONFLICT overwrites the old hash),
	// so this signal covers logout-revoked rows only.
	RefreshTokenReuseTotal prometheus.Counter

	// G1 — WS non-buffer-full delivery failures (marshal / conn closed / conn not found).
	WSDeliveryFailures *prometheus.CounterVec

	// G2 — WS disconnect / reconnect / stale-close counters.
	WSDisconnects prometheus.Counter
	WSReconnects  prometheus.Counter
	WSStaleClose  prometheus.Counter

	// G5 — Agent dispatch offline push failures (6 routes).
	AgentDispatchOfflinePushFailures *prometheus.CounterVec

	// G6 — Team assignment timeout + state-transition failure counters.
	TeamAssignmentTimeouts                prometheus.Counter
	TeamAssignmentStateTransitionFailures *prometheus.CounterVec

	// G7 — EventBus submit failures (pool full / closed) and events abandoned
	// when Close hits its drain deadline (#1548).
	EventBusSubmitFailures prometheus.Counter
	EventBusDroppedOnClose prometheus.Counter

	// G10 — Admin server up gauge (1 = running, 0 = not started / failed).
	AdminServerUp prometheus.Gauge

	// G8 — DB slow-query / error counters. The slow-query counter increments
	// for every slow query regardless of rows-affected; the slog Warn is
	// silenced when rows==0 (to avoid log flooding) but the metric is not —
	// operators must see slow-query rate even for empty result sets.
	DBErrors      prometheus.Counter
	DBSlowQueries prometheus.Counter

	// G8 — Optional DB pool idle gauge, set periodically in
	// app.startMetricsCollector alongside DBPoolInUse.
	// NOTE: sql.DBStats has no StaleConns field (that is a Redis pool
	// concept); only db_pool_idle is exposed for the DB pool.
	DBPoolIdle prometheus.Gauge

	// DB pool exhaustion observability (#2154 Gauss P1-1): cumulative
	// WaitCount / WaitDuration deltas per collector tick. A nonzero wait
	// rate means callers blocked on pool exhaustion — the signal that the
	// old 2-connection default hid completely.
	DBPoolWaitTotal        prometheus.Counter
	DBPoolWaitSecondsTotal prometheus.Counter

	// Audit-D (2026-07-29) — Swallowed-error observability for the three
	// error-swallowing sites flagged by Audit-D §1.1: dead-letter move,
	// notification delivery, running-task heartbeat, and session touch.
	// These do NOT change control flow; they only make previously silent
	// best-effort failures visible. Distinct from G3
	// delivery_outbox_dead_letter_total (which counts successful moves).
	DispatchDeadLetterMoveFailures prometheus.Counter
	NotificationDeliveryFailures   *prometheus.CounterVec
	AgentHeartbeatFailures         prometheus.Counter
	SessionTouchFailures           prometheus.Counter

	// Audit-D2 (#1543) — Async audit queue reliability. The audit retry
	// queue previously dropped events silently when full, drained without
	// bound on shutdown, and retried with a non-cancellable sleep. These
	// metrics make every loss/retry visible. AuditQueueDepth is maintained
	// by audit.Record (enqueue) and the retryLoop (dequeue); it is set to
	// the remaining count when a bounded drain abandons events.
	AuditQueueDrops       prometheus.Counter
	AuditQueueDepth       prometheus.Gauge
	AuditRetries          prometheus.Counter
	AuditFinalFailures    prometheus.Counter
	AuditFileSinkFailures prometheus.Counter

	// HubTaskApprovalDecisionsTotal counts task approval decisions made via
	// RunEventService.DecideTaskApproval. Label: decision (approve|deny).
	HubTaskApprovalDecisionsTotal *prometheus.CounterVec

	// ClientPendingDropped counts offline pending tasks evicted by the
	// pending_tasks Redis queue cap (LTRIM at 256 entries). Incremented by
	// app/events.go pushPendingTasks requeue path via the
	// PushPendingTaskWithEviction helper so operators can alert when the
	// offline queue is saturated and silently dropping oldest tasks.
	ClientPendingDropped prometheus.Counter

	// HTTPPanicRecoveries counts panics recovered by the Gin CustomRecovery
	// middleware and the admin RecoveryHTTPHandler. A non-zero rate signals a
	// handler bug that would otherwise crash the process. Distinct from
	// eventbus_panics_total (bus goroutine) so operators can attribute panics
	// to the HTTP path vs. the async bus path.
	HTTPPanicRecoveries prometheus.Counter

	// WSRouteSetFailures counts SetRoute failures swallowed in onRouteSet
	// (app/events.go). A non-zero rate means the Redis route table is not
	// tracking this connection, so downstream routing / online-status
	// broadcast is skipped to avoid advertising a route that does not exist.
	WSRouteSetFailures prometheus.Counter

	// GoroutinePanicRecoveries counts panics recovered by the safeGo helper
	// in long-lived / spawned goroutines (WS readLoop, dispatch launch, etc).
	// Distinct from http_panic_recoveries_total (HTTP request goroutine) and
	// eventbus_panics_total (bus worker) so operators can attribute panics to
	// the goroutine that owns the bug.
	GoroutinePanicRecoveries prometheus.Counter

	// OutboundMetrics is the unified outbound HTTP metrics contract (#1595):
	// outbound_requests_total / outbound_request_duration_seconds with
	// provider/purpose/category/status labels, shared with the Edge server.
	// Nil-safe — call sites may record before Register() runs.
	OutboundMetrics *outboundmetrics.Recorder

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

		// G3-Gauge — current backlog per status, refreshed by the retry tick.
		DeliveryOutboxBacklog = prometheus.NewGaugeVec(
			prometheus.GaugeOpts{
				Name: "delivery_outbox_backlog",
				Help: "Current number of delivery_outbox rows by status (pending/sent/retrying/dead), refreshed each retry tick.",
			},
			[]string{"status"},
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

		// #2064 item ①: symmetric counter for refresh-token blacklist check
		// errors. Wiring point is in service/auth (see BLOCKED.md); the metric
		// is registered here so dashboards can query it once wired.
		RefreshBlacklistCheckErrors = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "refresh_blacklist_check_errors_total",
				Help: "Total number of refresh-token blacklist check errors (Redis fail-open/fail-closed path, #2064).",
			},
		)

		// #2154 F2 step ①: revoked refresh-token row reuse signal. Observability
		// only — no control-flow change (wired in service/auth RefreshToken);
		// never logs the token or its hash, only user_id/device_type dimensions.
		RefreshTokenReuseTotal = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "refresh_token_reuse_total",
				Help: "Total number of refresh attempts presenting an already-revoked refresh token row (#2154 F2 step ①; signal-only, no cascade revocation).",
			},
		)

		// G1 — WS non-buffer-full delivery failures by reason.
		WSDeliveryFailures = prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "ws_delivery_failures_total",
				Help: "Total number of WebSocket delivery failures (non-buffer-full): marshal_error, conn_closed, conn_not_found.",
			},
			[]string{"reason"},
		)

		// G2 — WS disconnect / reconnect / stale-close counters.
		WSDisconnects = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "ws_disconnects_total",
				Help: "Total number of WebSocket disconnections (Unregister).",
			},
		)
		WSReconnects = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "ws_reconnects_total",
				Help: "Total number of WebSocket reconnects detected via SetAuth oldConnID replacement.",
			},
		)
		WSStaleClose = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "ws_stale_close_total",
				Help: "Total number of WebSocket connections closed as stale (max missed pongs reached).",
			},
		)

		// G5 — Agent dispatch offline push failures by route.
		AgentDispatchOfflinePushFailures = prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "agent_dispatch_offline_push_failures_total",
				Help: "Total number of agent dispatch offline-queue push failures by route.",
			},
			[]string{"route"},
		)

		// G6 — Team assignment timeout + state-transition failure counters.
		TeamAssignmentTimeouts = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "team_assignment_timeouts_total",
				Help: "Total number of timed-out team assignments successfully terminated to failed.",
			},
		)
		TeamAssignmentStateTransitionFailures = prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "team_assignment_state_transition_failures_total",
				Help: "Total number of team assignment dispatched→failed state-transition failures by phase.",
			},
			[]string{"phase"},
		)

		// G7 — EventBus submit failures (pool full / closed).
		EventBusSubmitFailures = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "eventbus_submit_failures_total",
				Help: "Total number of EventBus pool Submit failures (pool full or closed).",
			},
		)

		// G7 (#1548) — events abandoned when Close hits its drain deadline.
		EventBusDroppedOnClose = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "eventbus_dropped_on_close_total",
				Help: "Total number of pending eventbus handlers abandoned when Close reached its drain deadline.",
			},
		)

		// G10 — Admin server up gauge.
		AdminServerUp = prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "admin_server_up",
				Help: "1 if the admin server (pprof /metrics /debug) is running, 0 if not started or failed.",
			},
		)

		// G8 — DB slow-query / error counters.
		DBErrors = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "db_errors_total",
				Help: "Total number of database errors surfaced by the GORM logger Trace error branch.",
			},
		)
		DBSlowQueries = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "db_slow_queries_total",
				Help: "Total number of slow database queries (elapsed > SlowThreshold). Increments regardless of rows-affected; the slog Warn is silenced when rows==0 but the metric is not.",
			},
		)

		// G8 — Optional DB pool idle gauge (set periodically in app.startMetricsCollector).
		// sql.DBStats has no StaleConns; only idle is exposed for the DB pool.
		DBPoolIdle = prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "db_pool_idle",
				Help: "Number of idle database connections in the pool.",
			},
		)
		DBPoolWaitTotal = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "db_pool_wait_total",
				Help: "Total number of connections waited for (sql.DBStats.WaitCount deltas).",
			},
		)
		DBPoolWaitSecondsTotal = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "db_pool_wait_seconds_total",
				Help: "Total time blocked waiting for a pool connection, seconds (sql.DBStats.WaitDuration deltas).",
			},
		)

		// Audit-D — Swallowed-error counters for dead-letter move, notification
		// delivery, running-task heartbeat, and session touch failures.
		// Observability-only; no control-flow change at the call sites.
		DispatchDeadLetterMoveFailures = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "dispatch_dead_letter_move_failures_total",
				Help: "Total number of delivery dead-letter move failures swallowed by DispatchService.moveDeliveryToDeadLetter (distinct from delivery_outbox_dead_letter_total, which counts successful moves).",
			},
		)

		NotificationDeliveryFailures = prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "notification_delivery_failures_total",
				Help: "Total number of swallowed notification delivery failures by reason (agent_done, friend_request).",
			},
			[]string{"reason"},
		)

		AgentHeartbeatFailures = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "agent_heartbeat_failures_total",
				Help: "Total number of swallowed running-task heartbeat (BumpRunningTaskExpireAt) failures.",
			},
		)

		SessionTouchFailures = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "session_touch_failures_total",
				Help: "Total number of swallowed session last_message_at touch (TouchSessionLastMessage) failures.",
			},
		)

		// Audit-D2 — Async audit queue reliability metrics (#1543).
		AuditQueueDrops = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "audit_queue_drops_total",
				Help: "Total number of audit events dropped because the async retry queue was full.",
			},
		)
		AuditQueueDepth = prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "audit_queue_depth",
				Help: "Number of audit events currently pending in the async retry queue.",
			},
		)
		AuditRetries = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "audit_retries_total",
				Help: "Total number of transient audit persistence failures retried.",
			},
		)
		AuditFinalFailures = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "audit_final_failures_total",
				Help: "Total number of audit events dropped after exhausting retries or aborting on shutdown/lifecycle cancellation.",
			},
		)
		AuditFileSinkFailures = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "audit_file_sink_failures_total",
				Help: "Total number of JSONL audit file sink write failures (async and sync paths).",
			},
		)
		ClientPendingDropped = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "client_pending_dropped_total",
				Help: "Total number of offline pending tasks evicted by the pending_tasks Redis queue cap (LTRIM).",
			},
		)

		HTTPPanicRecoveries = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "http_panic_recoveries_total",
				Help: "Total number of HTTP handler panics recovered by CustomRecovery / RecoveryHTTPHandler.",
			},
		)

		WSRouteSetFailures = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "ws_route_set_failures_total",
				Help: "Total number of Redis SetRoute failures in onRouteSet; online-status broadcast is skipped on failure.",
			},
		)

		GoroutinePanicRecoveries = prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "goroutine_panic_recoveries_total",
				Help: "Total number of panics recovered by the safeGo helper in long-lived / spawned goroutines.",
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
		prometheus.MustRegister(DeliveryOutboxBacklog)
		prometheus.MustRegister(AgentDispatchEdgeHTTPFailures)
		prometheus.MustRegister(JWTVerificationFailures)
		prometheus.MustRegister(WSAuthFailures)
		prometheus.MustRegister(JTIBlacklistCheckErrors)
		prometheus.MustRegister(RefreshBlacklistCheckErrors)
		prometheus.MustRegister(RefreshTokenReuseTotal)
		prometheus.MustRegister(WSDeliveryFailures)
		prometheus.MustRegister(WSDisconnects)
		prometheus.MustRegister(WSReconnects)
		prometheus.MustRegister(WSStaleClose)
		prometheus.MustRegister(AgentDispatchOfflinePushFailures)
		prometheus.MustRegister(TeamAssignmentTimeouts)
		prometheus.MustRegister(TeamAssignmentStateTransitionFailures)
		prometheus.MustRegister(EventBusSubmitFailures)
		prometheus.MustRegister(EventBusDroppedOnClose)
		prometheus.MustRegister(AdminServerUp)
		prometheus.MustRegister(DBErrors)
		prometheus.MustRegister(DBSlowQueries)
		prometheus.MustRegister(DBPoolIdle)
		prometheus.MustRegister(DBPoolWaitTotal)
		prometheus.MustRegister(DBPoolWaitSecondsTotal)
		prometheus.MustRegister(DispatchDeadLetterMoveFailures)
		prometheus.MustRegister(NotificationDeliveryFailures)
		prometheus.MustRegister(AgentHeartbeatFailures)
		prometheus.MustRegister(SessionTouchFailures)
		prometheus.MustRegister(AuditQueueDrops)

		HubTaskApprovalDecisionsTotal = prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "hub_task_approval_decisions_total",
				Help: "Total task approval decisions (approve/deny) via DecideTaskApproval.",
			},
			[]string{"decision"},
		)
		prometheus.MustRegister(HubTaskApprovalDecisionsTotal)
		prometheus.MustRegister(AuditQueueDepth)
		prometheus.MustRegister(AuditRetries)
		prometheus.MustRegister(AuditFinalFailures)
		prometheus.MustRegister(AuditFileSinkFailures)
		prometheus.MustRegister(ClientPendingDropped)
		prometheus.MustRegister(HTTPPanicRecoveries)
		prometheus.MustRegister(WSRouteSetFailures)
		prometheus.MustRegister(GoroutinePanicRecoveries)
		// Unified outbound metrics contract (#1595): registered on the
		// default registry alongside the other Hub metrics.
		OutboundMetrics = outboundmetrics.NewRecorder(prometheus.DefaultRegisterer)
		// Built-in collectors may already be registered; ignore if so.
		_ = prometheus.Register(collectors.NewGoCollector())
		_ = prometheus.Register(collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))
	})
}
