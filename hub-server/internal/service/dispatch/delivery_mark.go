package dispatch

// DeliveryMarkAfterDispatch is true when a delivery was recorded and should be
// marked sent after a successful dispatch path (HTTP / WS / offline queue).
// Empty deliveryID means outbox record failed and durability is degraded.
func DeliveryMarkAfterDispatch(deliveryID string) bool {
	return deliveryID != ""
}

// ShouldIssueCapabilityToken is true when ResolveCapabilityMint returned Ok.
// Kept as a named predicate so orchestration reads as pure decision → mint.
func ShouldIssueCapabilityToken(resolved CapabilityMintResolved) bool {
	return resolved.Ok
}

// IsHTTPEdgeDispatchSuccess is true when local Edge HTTP returned a run id.
func IsHTTPEdgeDispatchSuccess(edgeRunID string) bool {
	return edgeRunID != ""
}
