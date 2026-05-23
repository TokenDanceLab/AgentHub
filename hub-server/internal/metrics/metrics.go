package metrics

import (
	"sync"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
)

var (
	HTTPRequestsTotal *prometheus.CounterVec
	HTTPDuration      *prometheus.HistogramVec
	WSConnections     prometheus.Gauge
	DBPoolInUse       prometheus.Gauge
	RedisPoolHits     prometheus.Gauge
	EventBusQueueLen  prometheus.Gauge
	EventBusPanics    prometheus.Counter

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

		DBPoolInUse = prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "db_pool_in_use",
				Help: "Number of database connections currently in use.",
			},
		)

		RedisPoolHits = prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "redis_pool_hits",
				Help: "Number of Redis pool connections in use.",
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

		prometheus.MustRegister(HTTPRequestsTotal)
		prometheus.MustRegister(HTTPDuration)
		prometheus.MustRegister(WSConnections)
		prometheus.MustRegister(DBPoolInUse)
		prometheus.MustRegister(RedisPoolHits)
		prometheus.MustRegister(EventBusQueueLen)
		prometheus.MustRegister(EventBusPanics)
		// Built-in collectors may already be registered; ignore if so.
		prometheus.Register(collectors.NewGoCollector())
		prometheus.Register(collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))
	})
}
