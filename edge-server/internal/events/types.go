package events

const (
	defaultMaxHistory           = 10000
	subscriberChannelBufferSize = 256
	defaultWorkerCount          = 4
	observerJobBufferSize       = 1024
)

// GapEventType is the event type for a gap-detection control message sent to a
// subscriber when one or more events were dropped because the subscriber channel
// was full. The payload is a *GapPayload.
const GapEventType = "system.gap"

// GapPayload describes a range of dropped events for a subscriber.
type GapPayload struct {
	FirstDroppedSeq int64 `json:"firstDroppedSeq"`
	LastDroppedSeq  int64 `json:"lastDroppedSeq"`
	DroppedCount    int64 `json:"droppedCount"`
}

// observerJob is a unit of work dispatched to the observer worker pool.
type observerJob struct {
	fn  func(EventEnvelope)
	evt EventEnvelope
}

// EventEnvelope is the standard event wrapper for all WebSocket events.
type EventEnvelope struct {
	Version string         `json:"version"`
	ID      string         `json:"id"`
	Seq     int64          `json:"seq"`
	Type    string         `json:"type"`
	Scope   map[string]any `json:"scope"`
	TraceID string         `json:"traceId"`
	SentAt  string         `json:"sentAt"`
	Payload any            `json:"payload"`
}

// subscriber receives events on its channel.
type subscriber struct {
	id          int64
	ch          chan EventEnvelope
	gapDetected bool  // true when events were dropped since last successful send
	firstGapSeq int64 // seq of first dropped event in the gap
	lastGapSeq  int64 // seq of last dropped event in the gap
}

type observer struct {
	id int64
	fn func(EventEnvelope)
}
