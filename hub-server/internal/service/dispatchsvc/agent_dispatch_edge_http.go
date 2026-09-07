package dispatchsvc

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/agenthub/pkg/outboundmetrics"
	"github.com/agenthub/pkg/reqlog"

	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/dispatch"
)

type edgeHTTPDispatchResult struct {
	RunID          string
	CallbackOwner  string
	SafeToFallback bool
}

func (s *DispatchService) dispatchToEdgeHTTP(ctx context.Context, task *model.PendingAgentTask, dp *dispatchPayload) edgeHTTPDispatchResult {
	miss := edgeHTTPDispatchResult{SafeToFallback: task == nil || task.EdgeDeviceID == ""}
	deviceID := strings.TrimSpace(s.edgeCfg.DeviceID)
	if task != nil && task.EdgeDeviceID != "" && task.EdgeDeviceID != deviceID {
		return edgeHTTPDispatchResult{}
	}
	// Pure Edge HTTP prep (#946); client/request side-effects stay here.
	// URL/token come from the injected edgeCfg (composition root), never
	// os.Getenv (#1549).
	if task == nil || dp == nil || strings.TrimSpace(s.edgeCfg.DeviceID) == "" {
		return miss
	}
	payload := *dp
	payload.TaskID = task.ID
	if dispatch.RequiresDesktopTeamRouting(payload) {
		return miss
	}
	// Workspace selection is part of the task, not a Hub-side fallback.
	if strings.TrimSpace(dispatch.BuildEdgeRunRequest(payload).WorkDir) == "" {
		return miss
	}
	parts, insecure, err := dispatch.PrepareEdgeHTTPRequest(
		s.edgeCfg.URL,
		s.edgeCfg.AuthToken,
		payload,
		s.issueRunStartCapability(dp),
	)
	if insecure {
		// AH-SR-053: non-loopback cleartext rejected.
		slog.Error(dispatch.EdgeHTTPLogInsecureCleartext, "edge_url", parts.EdgeURL)
		if metrics.AgentDispatchEdgeHTTPFailures != nil {
			metrics.AgentDispatchEdgeHTTPFailures.WithLabelValues("insecure_cleartext").Inc()
		}
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderEdge, outboundmetrics.PurposeDispatch, outboundmetrics.CategoryFailure, "insecure_cleartext")
		return miss
	}
	if err != nil {
		slog.Error(dispatch.EdgeHTTPLogMarshalFailed, "task_id", task.ID, "error", err)
		if metrics.AgentDispatchEdgeHTTPFailures != nil {
			metrics.AgentDispatchEdgeHTTPFailures.WithLabelValues("marshal_failed").Inc()
		}
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderEdge, outboundmetrics.PurposeDispatch, outboundmetrics.CategoryFailure, "marshal_failed")
		return miss
	}

	ctx, cancel := context.WithTimeout(ctx, parts.Timeout)
	defer cancel()
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, parts.RunsURL, bytes.NewReader(parts.Body))
	if err != nil {
		slog.Error(dispatch.EdgeHTTPLogCreateReqFailed, "task_id", task.ID, "error", err)
		if metrics.AgentDispatchEdgeHTTPFailures != nil {
			metrics.AgentDispatchEdgeHTTPFailures.WithLabelValues("req_create_failed").Inc()
		}
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderEdge, outboundmetrics.PurposeDispatch, outboundmetrics.CategoryFailure, "req_create_failed")
		return miss
	}
	httpReq.Header = parts.Headers
	// Correlation contract (#1595): propagate the caller's request id so the
	// Edge side can join its logs to the originating Hub request.
	reqlog.SetRequestIDHeader(ctx, httpReq.Header)

	// Shared client created once at the composition root: connection reuse
	// and a single configured timeout instead of a fresh client per dispatch
	// (#1549/#1594). A nil client is a wiring gap (only legal in partial
	// tests) — fail like an unreachable edge instead of panicking.
	if s.edgeClient == nil {
		slog.Error(dispatch.EdgeHTTPLogUnreachable, "task_id", task.ID, "url", parts.RunsURL, "error", "edgeClient not wired at the composition root")
		if metrics.AgentDispatchEdgeHTTPFailures != nil {
			metrics.AgentDispatchEdgeHTTPFailures.WithLabelValues("unreachable").Inc()
		}
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderEdge, outboundmetrics.PurposeDispatch, outboundmetrics.CategoryFailure, "unreachable")
		return miss
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
		return edgeHTTPDispatchResult{}
	}
	owned, err := repository.DirectCallbackDeviceMatchesTask(s.db.WithContext(ctx), task.ID, deviceID)
	if err != nil {
		slog.Error("edge direct callback device lookup failed", "task_id", task.ID, "error", err)
		return edgeHTTPDispatchResult{}
	}
	if !owned {
		return miss
	}
	if !s.edgeBreaker.Allow() {
		slog.Warn(dispatch.EdgeHTTPLogUnreachable, "task_id", task.ID, "url", parts.RunsURL, "error", "edge circuit breaker open")
		if metrics.AgentDispatchEdgeHTTPFailures != nil {
			metrics.AgentDispatchEdgeHTTPFailures.WithLabelValues("breaker_open").Inc()
		}
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderEdge, outboundmetrics.PurposeDispatch, outboundmetrics.CategoryFailure, "breaker_open")
		return miss
	}
	if !s.directCallbackRouteReady(ctx, parts) {
		s.edgeBreaker.RecordFailure()
		slog.Info("edge http dispatch: callback ownership route is unavailable", "task_id", task.ID)
		return miss
	}

	// Reserve the actual executor before POST: a timeout/invalid receipt must
	// never let a retry start this task on an unrelated inviter Desktop.
	if err := repository.ReservePendingTaskDirectDevice(s.db.WithContext(ctx), task.ID, deviceID); err != nil {
		s.edgeBreaker.RecordSuccess() // health succeeded; reservation failure is not an Edge outage
		slog.Error("edge direct device reservation failed", "task_id", task.ID, "error", err)
		return edgeHTTPDispatchResult{}
	}
	task.EdgeDeviceID = deviceID
	dp.EdgeDeviceID = deviceID
	started := time.Now()
	resp, err := s.edgeClient.Do(httpReq)
	if err != nil {
		// G4: Edge unreachable is a classic silent-outage scenario; raised from
		// Debug to Warn so production can see it (#audit-G4). Counter quantifies rate.
		slog.Warn(dispatch.EdgeHTTPLogUnreachable, "task_id", task.ID, "url", parts.RunsURL, "error", err)
		if metrics.AgentDispatchEdgeHTTPFailures != nil {
			metrics.AgentDispatchEdgeHTTPFailures.WithLabelValues("unreachable").Inc()
		}
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderEdge, outboundmetrics.PurposeDispatch, outboundmetrics.CategoryFailure, "unreachable")
		s.edgeBreaker.RecordFailure()
		return edgeHTTPDispatchResult{}
	}
	defer resp.Body.Close()

	respBody, readErr := io.ReadAll(io.LimitReader(resp.Body, dispatch.EdgeHTTPResponseBodyLimit))
	if readErr != nil {
		s.edgeBreaker.RecordFailure()
		return edgeHTTPDispatchResult{}
	}
	plan := dispatch.PlanEdgeHTTPClientResponse(resp.StatusCode, respBody)
	if plan.NonSuccess {
		slog.Warn(plan.LogMessage, "task_id", task.ID, "status", resp.StatusCode, "body_summary", SummarizeBodyForLog(respBody))
		if metrics.AgentDispatchEdgeHTTPFailures != nil {
			metrics.AgentDispatchEdgeHTTPFailures.WithLabelValues("non_success").Inc()
		}
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderEdge, outboundmetrics.PurposeDispatch, outboundmetrics.CategoryFailure, "non_success")
		s.edgeBreaker.RecordFailure()
		return edgeHTTPDispatchResult{}
	}
	if plan.DecodeFail {
		slog.Warn(plan.LogMessage, "task_id", task.ID, "error", plan.DecodeErr)
		if metrics.AgentDispatchEdgeHTTPFailures != nil {
			metrics.AgentDispatchEdgeHTTPFailures.WithLabelValues("decode_fail").Inc()
		}
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderEdge, outboundmetrics.PurposeDispatch, outboundmetrics.CategoryFailure, "decode_fail")
		s.edgeBreaker.RecordFailure()
		return edgeHTTPDispatchResult{}
	}
	s.edgeBreaker.RecordSuccess()
	owner := edgeDispatchReceiptOwner(respBody)
	if plan.RunID == "" || owner == "" {
		return edgeHTTPDispatchResult{}
	}
	metrics.OutboundMetrics.Record(outboundmetrics.ProviderEdge, outboundmetrics.PurposeDispatch, outboundmetrics.CategorySuccess, outboundmetrics.StatusOK)
	metrics.OutboundMetrics.Observe(outboundmetrics.ProviderEdge, outboundmetrics.PurposeDispatch, outboundmetrics.CategorySuccess, outboundmetrics.StatusOK, time.Since(started))
	slog.Info(dispatch.EdgeHTTPLogDispatched, "task_id", task.ID, "edge_run_id", plan.RunID, "url", parts.RunsURL)
	return edgeHTTPDispatchResult{RunID: plan.RunID, CallbackOwner: owner}
}
