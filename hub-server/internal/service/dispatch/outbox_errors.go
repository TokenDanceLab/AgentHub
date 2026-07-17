package dispatch

import "errors"

// OutboxUnavailableErrorMessage is the historical nil-safe outbox port error text.
const OutboxUnavailableErrorMessage = "dispatch outbox unavailable"

// ErrOutboxUnavailable returns the historical error when dispatch outbox is nil.
func ErrOutboxUnavailable() error {
	return errors.New(OutboxUnavailableErrorMessage)
}
