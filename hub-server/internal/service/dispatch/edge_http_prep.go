package dispatch

import (
	"encoding/json"
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
	edgeURLEnv, authTokenEnv string,
	prompt, agentType, systemPrompt, hubTaskID, deliveryID string,
	messages, pinned []Message,
	outputSchema *json.RawMessage,
	capabilityToken string,
) (parts EdgeHTTPRequestParts, insecure bool, err error) {
	edgeURL := ResolveEdgeHTTPURL(edgeURLEnv)
	if IsInsecureNonLoopbackEdge(edgeURL) {
		return EdgeHTTPRequestParts{EdgeURL: edgeURL}, true, nil
	}
	body, err := MarshalEdgeRunRequest(
		prompt, agentType, systemPrompt, hubTaskID, deliveryID,
		messages, pinned, outputSchema,
	)
	if err != nil {
		return EdgeHTTPRequestParts{EdgeURL: edgeURL}, false, err
	}
	return EdgeHTTPRequestParts{
		EdgeURL: edgeURL,
		RunsURL: EdgeRunsURL(edgeURL),
		Body:    body,
		Headers: EdgeHTTPHeaders(EdgeAuthBearerToken(authTokenEnv), capabilityToken),
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
