package dispatch

import "net/http"

// EdgeRunsPath is the relative path for Edge HTTP run creation.
const EdgeRunsPath = "/v1/runs"

// EdgeHTTPResponseBodyLimit is the max bytes read from an Edge /v1/runs response.
const EdgeHTTPResponseBodyLimit = 64 * 1024

// EdgeHTTPClientTimeoutSeconds is the HTTP client timeout for Edge dispatch.
const EdgeHTTPClientTimeoutSeconds = 10

// CapabilityTokenHeader is the dual-token auth header for Hub→Edge run-start.
// #nosec G101 -- constant header name, not a credential
const CapabilityTokenHeader = "X-AgentHub-Capability-Token"

// EdgeRunsURL joins a base Edge URL with EdgeRunsPath.
func EdgeRunsURL(edgeBaseURL string) string {
	return edgeBaseURL + EdgeRunsPath
}

// IsEdgeHTTPSuccessStatus reports whether an Edge /v1/runs status code is success.
func IsEdgeHTTPSuccessStatus(statusCode int) bool {
	return statusCode == http.StatusAccepted || statusCode == http.StatusOK
}

// EdgeHTTPHeaders builds Content-Type / Authorization / capability headers for
// Hub→Edge HTTP run creation. Empty authBearer or capabilityToken omits that header.
// http.Client and request construction stay orchestration-side.
func EdgeHTTPHeaders(authBearer, capabilityToken string) http.Header {
	h := make(http.Header)
	h.Set("Content-Type", "application/json")
	if authBearer != "" {
		h.Set("Authorization", "Bearer "+authBearer)
	}
	if capabilityToken != "" {
		h.Set(CapabilityTokenHeader, capabilityToken)
	}
	return h
}

// DeviceNotRoutableErrorMessage is the TargetNotRoutable message when the bound
// device row is missing or not routable (historical validateDispatchTarget text).
const DeviceNotRoutableErrorMessage = "execution target device is not routable"
