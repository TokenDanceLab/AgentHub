package dispatch

import "net/http"

// EdgeRunsPath is the relative path for Edge HTTP run creation.
const EdgeRunsPath = "/v1/runs"

// EdgeHTTPResponseBodyLimit is the max bytes read from an Edge /v1/runs response.
const EdgeHTTPResponseBodyLimit = 64 * 1024

// EdgeHTTPClientTimeoutSeconds is the HTTP client timeout for Edge dispatch.
const EdgeHTTPClientTimeoutSeconds = 10

// CapabilityTokenHeader is the dual-token auth header for Hub→Edge run-start.
const CapabilityTokenHeader = "X-AgentHub-Capability-Token"

// EdgeRunsURL joins a base Edge URL with EdgeRunsPath.
func EdgeRunsURL(edgeBaseURL string) string {
	return edgeBaseURL + EdgeRunsPath
}

// IsEdgeHTTPSuccessStatus reports whether an Edge /v1/runs status code is success.
func IsEdgeHTTPSuccessStatus(statusCode int) bool {
	return statusCode == http.StatusAccepted || statusCode == http.StatusOK
}

// DeviceNotRoutableErrorMessage is the TargetNotRoutable message when the bound
// device row is missing or not routable (historical validateDispatchTarget text).
const DeviceNotRoutableErrorMessage = "execution target device is not routable"
