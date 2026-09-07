package dispatchsvc

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/agenthub/pkg/outboundmetrics"

	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/dispatch"
)

// Direct execution requires a runtime that enforces callback ownership and has
// a configured callback path. A normal health response from an old Edge is not
// sufficient: it could accept work without anyone responsible for the result.
func (s *DispatchService) directCallbackRouteReady(ctx context.Context, parts dispatch.EdgeHTTPRequestParts) bool {
	deviceID := strings.TrimSpace(s.edgeCfg.DeviceID)
	if deviceID == "" {
		return false
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parts.EdgeURL+"/v1/health", nil)
	if err != nil {
		return false
	}
	request.Header = parts.Headers.Clone()
	response, err := s.edgeClient.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return false
	}
	var health struct {
		EdgeID       string `json:"edgeId"`
		Capabilities struct {
			RunCallbackOwnership bool `json:"runCallbackOwnership"`
			DirectHubCallbacks   bool `json:"directHubCallbacks"`
		} `json:"capabilities"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, dispatch.EdgeHTTPResponseBodyLimit)).Decode(&health) != nil {
		return false
	}
	return health.EdgeID == deviceID && health.Capabilities.RunCallbackOwnership && health.Capabilities.DirectHubCallbacks
}

func edgeDispatchReceiptOwner(body []byte) string {
	var response struct {
		Data struct {
			CallbackOwner string `json:"callbackOwner"`
		} `json:"data"`
	}
	if json.Unmarshal(body, &response) == nil {
		switch response.Data.CallbackOwner {
		case "edge", "desktop":
			return response.Data.CallbackOwner
		}
	}
	return ""
}

// prepareDirectCallbackRoute checks callback authority and durably reserves
// the destination before execution. Failure reports whether another route is
// still safe; database uncertainty never grants fallback authority.
func (s *DispatchService) prepareDirectCallbackRoute(ctx context.Context, task *model.PendingAgentTask, dp *dispatchPayload, parts dispatch.EdgeHTTPRequestParts) (ready, safeToFallback bool) {
	deviceID := strings.TrimSpace(s.edgeCfg.DeviceID)
	if task.EdgeDeviceID != "" && task.EdgeDeviceID != deviceID {
		return false, false
	}
	// Per-Edge circuit breaker: when Edge is down, consecutive dispatches would
	// each block for the full HTTP client timeout (~30s), exhausting the
	// dispatch semaphore and stalling the TTL/redispatch path. The breaker
	// fails fast (no HTTP call) while open and admits a single half-open probe
	// after edgeBreakerOpenDuration to test recovery. Pre-HTTP failures
	// (insecure/marshal/req_create/edgeClient-nil) are config issues and do
	// not trip the breaker; only client.Do/non_success/decode_fail indicate
	// Edge health and are recorded.
	if s.db == nil {
		return false, false
	}
	owned, err := repository.DirectCallbackDeviceMatchesTask(s.db.WithContext(ctx), task.ID, deviceID)
	if err != nil {
		slog.Error("edge direct callback device lookup failed", "task_id", task.ID, "error", err)
		return false, false
	}
	if !owned {
		return false, task.EdgeDeviceID == ""
	}
	if !s.edgeBreaker.Allow() {
		slog.Warn(dispatch.EdgeHTTPLogUnreachable, "task_id", task.ID, "url", parts.RunsURL, "error", "edge circuit breaker open")
		if metrics.AgentDispatchEdgeHTTPFailures != nil {
			metrics.AgentDispatchEdgeHTTPFailures.WithLabelValues("breaker_open").Inc()
		}
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderEdge, outboundmetrics.PurposeDispatch, outboundmetrics.CategoryFailure, "breaker_open")
		return false, task.EdgeDeviceID == ""
	}
	if !s.directCallbackRouteReady(ctx, parts) {
		s.edgeBreaker.RecordFailure()
		slog.Info("edge http dispatch: callback ownership route is unavailable", "task_id", task.ID)
		return false, task.EdgeDeviceID == ""
	}

	// Reserve the actual executor before POST: a timeout/invalid receipt must
	// never let a retry start this task on an unrelated inviter Desktop.
	if err := repository.ReservePendingTaskDirectDevice(s.db.WithContext(ctx), task.ID, deviceID); err != nil {
		s.edgeBreaker.RecordSuccess() // health succeeded; reservation failure is not an Edge outage
		slog.Error("edge direct device reservation failed", "task_id", task.ID, "error", err)
		return false, false
	}
	task.EdgeDeviceID = deviceID
	dp.EdgeDeviceID = deviceID
	return true, false
}
