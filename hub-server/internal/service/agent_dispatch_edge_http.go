package service

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"os"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/dispatch"
)

func (s *DispatchService) dispatchToEdgeHTTP(ctx context.Context, task *model.PendingAgentTask, dp *dispatchPayload) string {
	// Pure Edge HTTP prep (#946); client/request side-effects stay here.
	parts, insecure, err := dispatch.PrepareEdgeHTTPRequest(
		os.Getenv("AGENTHUB_EDGE_URL"),
		os.Getenv("AGENTHUB_EDGE_AUTH_TOKEN"),
		dp.Prompt, dp.AgentType, dp.SystemPrompt, task.ID, dp.DeliveryID,
		dp.Messages, dp.PinnedMessages, dp.OutputSchema,
		s.issueRunStartCapability(dp),
	)
	if insecure {
		// AH-SR-053: non-loopback cleartext rejected.
		slog.Error(dispatch.EdgeHTTPLogInsecureCleartext, "edge_url", parts.EdgeURL)
		return ""
	}
	if err != nil {
		slog.Error(dispatch.EdgeHTTPLogMarshalFailed, "task_id", task.ID, "error", err)
		return ""
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, parts.RunsURL, bytes.NewReader(parts.Body))
	if err != nil {
		slog.Error(dispatch.EdgeHTTPLogCreateReqFailed, "task_id", task.ID, "error", err)
		return ""
	}
	httpReq.Header = parts.Headers

	client := &http.Client{Timeout: parts.Timeout}
	resp, err := client.Do(httpReq)
	if err != nil {
		slog.Debug(dispatch.EdgeHTTPLogUnreachable, "task_id", task.ID, "url", parts.RunsURL, "error", err)
		return ""
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, dispatch.EdgeHTTPResponseBodyLimit))
	plan := dispatch.PlanEdgeHTTPClientResponse(resp.StatusCode, respBody)
	if plan.NonSuccess {
		slog.Warn(plan.LogMessage, "task_id", task.ID, "status", resp.StatusCode, "body", string(respBody))
		return ""
	}
	if plan.DecodeFail {
		slog.Warn(plan.LogMessage, "task_id", task.ID, "error", plan.DecodeErr)
		return ""
	}
	slog.Info(dispatch.EdgeHTTPLogDispatched, "task_id", task.ID, "edge_run_id", plan.RunID, "url", parts.RunsURL)
	return plan.RunID
}
