package dispatch

import (
	"net/http"
	"time"
)

// EdgeHTTPRequestParts is the pure prep surface for Hub→Edge /v1/runs before
// http.Client / NewRequestWithContext side-effects.
type EdgeHTTPRequestParts struct {
	EdgeURL string
	RunsURL string
	Body    []byte
	Headers http.Header
	Timeout time.Duration
}

// PrepareEdgeHTTPRequest builds URL/body/headers/timeout for Edge HTTP dispatch.
// insecure=true when AH-SR-053 rejects non-loopback cleartext (caller logs + aborts).
// err is set only on body marshal failure.
func PrepareEdgeHTTPRequest(
	edgeURL, authToken string,
	payload Payload,
	capabilityToken string,
) (parts EdgeHTTPRequestParts, insecure bool, err error) {
	edgeURL = ResolveEdgeHTTPURL(edgeURL)
	if IsInsecureNonLoopbackEdge(edgeURL) {
		return EdgeHTTPRequestParts{EdgeURL: edgeURL}, true, nil
	}
	body, err := MarshalEdgeRunRequest(payload)
	if err != nil {
		return EdgeHTTPRequestParts{EdgeURL: edgeURL}, false, err
	}
	return EdgeHTTPRequestParts{
		EdgeURL: edgeURL,
		RunsURL: EdgeRunsURL(edgeURL),
		Body:    body,
		Headers: EdgeHTTPHeaders(EdgeAuthBearerToken(authToken), capabilityToken),
		Timeout: time.Duration(EdgeHTTPClientTimeoutSeconds) * time.Second,
	}, false, nil
}

// EdgeHTTPDispatchResult classifies an Edge /v1/runs HTTP response into a run id
// or a failure branch (non-success status vs decode error). empty runID with
// nonSuccess=false and decodeErr=nil means success body with empty runId.
func EdgeHTTPDispatchResult(statusCode int, respBody []byte) (runID string, nonSuccess bool, decodeErr error) {
	if !IsEdgeHTTPSuccessStatus(statusCode) {
		return "", true, nil
	}
	runID, err := ParseEdgeRunID(respBody)
	if err != nil {
		return "", false, err
	}
	return runID, false, nil
}

// Historical edge HTTP dispatch slog messages (AH-SR-053 + client side-effects).
const (
	EdgeHTTPLogInsecureCleartext = "edge http dispatch: non-loopback URL without TLS, dispatch payloads sent in cleartext"
	EdgeHTTPLogMarshalFailed     = "edge http dispatch: failed to marshal request"
	EdgeHTTPLogCreateReqFailed   = "edge http dispatch: failed to create request"
	EdgeHTTPLogUnreachable       = "edge http dispatch: edge server unreachable"
	EdgeHTTPLogNonSuccess        = "edge http dispatch: edge returned non-success"
	EdgeHTTPLogDecodeFailed      = "edge http dispatch: failed to decode response"
	EdgeHTTPLogDispatched        = "edge http dispatch: task dispatched to local Edge"
)
