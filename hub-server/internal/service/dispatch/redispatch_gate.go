package dispatch

// RedispatchTaskGateKind classifies post-prep redispatchDelivery decisions after
// task lookup / status checks. Side-effects (dead-letter, retry route) stay
// orchestration-side. Soft route failures remain in retryDispatchToTarget (#999).
type RedispatchTaskGateKind int

const (
	// RedispatchGateRetry: task is still redispatchable (queued/dispatched).
	RedispatchGateRetry RedispatchTaskGateKind = iota
	// RedispatchGateDeadLetterLookup: task row missing / lookup error → dead-letter.
	RedispatchGateDeadLetterLookup
	// RedispatchGateDeadLetterStatus: task not retryable (includes running #1000).
	RedispatchGateDeadLetterStatus
)

// RedispatchTaskGate is the pure gate decision for redispatchDelivery after payload prep.
type RedispatchTaskGate struct {
	Kind             RedispatchTaskGateKind
	LogMessage       string
	DeadLetterReason string
}

// PlanRedispatchTaskGate decides retry vs intentional dead-letter from pure lookup
// and status facts. Running is non-retryable (#1000). Soft offline-queue failures
// are not decided here — they stay on the retry path (#999).
func PlanRedispatchTaskGate(lookupErr error, taskStatus string) RedispatchTaskGate {
	if lookupErr != nil {
		return RedispatchTaskGate{
			Kind:             RedispatchGateDeadLetterLookup,
			LogMessage:       RedispatchLogTaskLookupFailed,
			DeadLetterReason: DeadLetterReason(DeadLetterKindTaskLookup, lookupErr),
		}
	}
	if !IsRetryableTaskStatus(taskStatus) {
		return RedispatchTaskGate{
			Kind:             RedispatchGateDeadLetterStatus,
			LogMessage:       RedispatchLogTaskTerminal,
			DeadLetterReason: DeadLetterTaskStatus(taskStatus),
		}
	}
	return RedispatchTaskGate{Kind: RedispatchGateRetry}
}
