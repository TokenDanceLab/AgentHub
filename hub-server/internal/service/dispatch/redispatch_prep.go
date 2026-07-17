package dispatch

// RedispatchPrepFailure classifies PrepareRedispatchPayload errors into the
// historical dead-letter kind + unwrap used by redispatchDelivery logging.
// Non-prep errors fall back to payload-unmarshal kind (defensive).
func RedispatchPrepFailure(err error) (kind string, unwrap error) {
	if err == nil {
		return "", nil
	}
	if prep, ok := err.(*PayloadPrepError); ok {
		return prep.Kind, prep.Err
	}
	return DeadLetterKindPayloadUnmarshal, err
}

// IsPayloadMarshalDeadLetter is true when redispatch prep failed on re-marshal
// (historical log branch split in redispatchDelivery).
func IsPayloadMarshalDeadLetter(kind string) bool {
	return kind == DeadLetterKindPayloadMarshal
}

// RedeliveryConnFacts captures pure connection observations after a route
// lookup for ClassifyRedeliveryRoute. Callers still own FindByConnID side-effects.
type RedeliveryConnFacts struct {
	ConnFound     bool
	ConnUserMatch bool
}

// ObserveRedeliveryConn builds RedeliveryConnFacts from looked-up connection
// identity. When conn is unavailable (nil lookup), both flags are false.
func ObserveRedeliveryConn(connFound bool, connUserID, triggeredByUserID string) RedeliveryConnFacts {
	if !connFound {
		return RedeliveryConnFacts{}
	}
	return RedeliveryConnFacts{
		ConnFound:     true,
		ConnUserMatch: IsMatchingRedeliveryConn(connUserID, triggeredByUserID),
	}
}

// RedeliveryOfflineLogKind selects historical offline-queue log wording for
// redispatch fallthrough (device-bound vs inviter fallback).
func RedeliveryOfflineLogKind(preferDevice bool) string {
	if preferDevice {
		return "offline"
	}
	return "fallback"
}
