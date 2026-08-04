package service

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/agenthub/pkg/outboundmetrics"
	"github.com/agenthub/pkg/reqlog"

	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/dispatch"
)

func (s *DispatchService) dispatchToEdgeHTTP(ctx context.Context, task *model.PendingAgentTask, dp *dispatchPayload) string {
	// Pure Edge HTTP prep (#946); client/request side-effects stay here.
	// URL/token come from the injected edgeCfg (composition root), never
	// os.Getenv (#1549).
	parts, insecure, err := dispatch.PrepareEdgeHTTPRequest(
		s.edgeCfg.URL,
		s.edgeCfg.AuthToken,
		dp.Prompt, dp.AgentType, dp.SystemPrompt, task.ID, dp.DeliveryID,
		dp.Messages, dp.PinnedMessages, dp.OutputSchema,
		s.issueRunStartCapability(dp),
	)
	if insecure {
		// AH-SR-053: non-loopback cleartext rejected.
		slog.Error(dispatch.EdgeHTTPLogInsecureCleartext, "edge_url", parts.EdgeURL)
		if metrics.AgentDispatchEdgeHTTPFailures != nil {
			metrics.AgentDispatchEdgeHTTPFailures.WithLabelValues("insecure_cleartext").Inc()
		}
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderEdge, outboundmetrics.PurposeDispatch, outboundmetrics.CategoryFailure, "insecure_cleartext")
		return ""
	}
	if err != nil {
		slog.Error(dispatch.EdgeHTTPLogMarshalFailed, "task_id", task.ID, "error", err)
		if metrics.AgentDispatchEdgeHTTPFailures != nil {
			metrics.AgentDispatchEdgeHTTPFailures.WithLabelValues("marshal_failed").Inc()
		}
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderEdge, outboundmetrics.PurposeDispatch, outboundmetrics.CategoryFailure, "marshal_failed")
		return ""
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, parts.RunsURL, bytes.NewReader(parts.Body))
	if err != nil {
		slog.Error(dispatch.EdgeHTTPLogCreateReqFailed, "task_id", task.ID, "error", err)
		if metrics.AgentDispatchEdgeHTTPFailures != nil {
			metrics.AgentDispatchEdgeHTTPFailures.WithLabelValues("req_create_failed").Inc()
		}
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderEdge, outboundmetrics.PurposeDispatch, outboundmetrics.CategoryFailure, "req_create_failed")
		return ""
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
		return ""
	}
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
		return ""
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, dispatch.EdgeHTTPResponseBodyLimit))
	plan := dispatch.PlanEdgeHTTPClientResponse(resp.StatusCode, respBody)
	if plan.NonSuccess {
		slog.Warn(plan.LogMessage, "task_id", task.ID, "status", resp.StatusCode, "body", string(respBody))
		if metrics.AgentDispatchEdgeHTTPFailures != nil {
			metrics.AgentDispatchEdgeHTTPFailures.WithLabelValues("non_success").Inc()
		}
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderEdge, outboundmetrics.PurposeDispatch, outboundmetrics.CategoryFailure, "non_success")
		return ""
	}
	if plan.DecodeFail {
		slog.Warn(plan.LogMessage, "task_id", task.ID, "error", plan.DecodeErr)
		if metrics.AgentDispatchEdgeHTTPFailures != nil {
			metrics.AgentDispatchEdgeHTTPFailures.WithLabelValues("decode_fail").Inc()
		}
		metrics.OutboundMetrics.Record(outboundmetrics.ProviderEdge, outboundmetrics.PurposeDispatch, outboundmetrics.CategoryFailure, "decode_fail")
		return ""
	}
	metrics.OutboundMetrics.Record(outboundmetrics.ProviderEdge, outboundmetrics.PurposeDispatch, outboundmetrics.CategorySuccess, outboundmetrics.StatusOK)
	metrics.OutboundMetrics.Observe(outboundmetrics.ProviderEdge, outboundmetrics.PurposeDispatch, outboundmetrics.CategorySuccess, outboundmetrics.StatusOK, time.Since(started))
	slog.Info(dispatch.EdgeHTTPLogDispatched, "task_id", task.ID, "edge_run_id", plan.RunID, "url", parts.RunsURL)
	return plan.RunID
}
