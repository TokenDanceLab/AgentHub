package service

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"

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
		return ""
	}
	if err != nil {
		slog.Error(dispatch.EdgeHTTPLogMarshalFailed, "task_id", task.ID, "error", err)
		if metrics.AgentDispatchEdgeHTTPFailures != nil {
			metrics.AgentDispatchEdgeHTTPFailures.WithLabelValues("marshal_failed").Inc()
		}
		return ""
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, parts.RunsURL, bytes.NewReader(parts.Body))
	if err != nil {
		slog.Error(dispatch.EdgeHTTPLogCreateReqFailed, "task_id", task.ID, "error", err)
		if metrics.AgentDispatchEdgeHTTPFailures != nil {
			metrics.AgentDispatchEdgeHTTPFailures.WithLabelValues("req_create_failed").Inc()
		}
		return ""
	}
	httpReq.Header = parts.Headers

	// Shared client created once at construction: connection reuse and a
	// single configured timeout instead of a fresh client per dispatch (#1549).
	resp, err := s.edgeClient.Do(httpReq)
	if err != nil {
		// G4: Edge unreachable is a classic silent-outage scenario; raised from
		// Debug to Warn so production can see it (#audit-G4). Counter quantifies rate.
		slog.Warn(dispatch.EdgeHTTPLogUnreachable, "task_id", task.ID, "url", parts.RunsURL, "error", err)
		if metrics.AgentDispatchEdgeHTTPFailures != nil {
			metrics.AgentDispatchEdgeHTTPFailures.WithLabelValues("unreachable").Inc()
		}
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
		return ""
	}
	if plan.DecodeFail {
		slog.Warn(plan.LogMessage, "task_id", task.ID, "error", plan.DecodeErr)
		if metrics.AgentDispatchEdgeHTTPFailures != nil {
			metrics.AgentDispatchEdgeHTTPFailures.WithLabelValues("decode_fail").Inc()
		}
		return ""
	}
	slog.Info(dispatch.EdgeHTTPLogDispatched, "task_id", task.ID, "edge_run_id", plan.RunID, "url", parts.RunsURL)
	return plan.RunID
}
