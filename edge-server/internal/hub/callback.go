// Package hub provides the Edge→Hub direct callback client.
//
// When configured, the CallbackClient enables the Edge server to report
// run lifecycle events directly to the Hub server, bypassing the Desktop relay:
//
//	Edge ──POST──> Hub /edge/agent-tasks/:id/ack    (task acknowledged)
//	Edge ──POST──> Hub /edge/agent-tasks/:id/stream  (streaming output chunks)
//	Edge ──POST──> Hub /edge/agent-tasks/:id/done    (task completed)
//	Edge ──POST──> Hub /edge/agent-tasks/:id/fail    (task failed)
//
// Callbacks are fire-and-forget with retry: failures are logged but never
// block the run lifecycle. Each callback retries up to 3 times with
// exponential backoff (1s, 2s, 4s).
package hub

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// CallbackClient reports Edge run lifecycle events to the Hub server.
// It is safe for concurrent use.
type CallbackClient struct {
	hubURL    string
	authToken string
	client    *http.Client
}

// TaskResult carries the final result of a completed task.
type TaskResult struct {
	RunID        string `json:"run_id"`
	FinalContent string `json:"final_content"`
}

// NewCallbackClient creates a new CallbackClient.
// hubURL is the base URL of the Hub server (e.g. "https://hub.example.com").
// authToken is the JWT bearer token for authenticating with Hub (must encode device_type=desktop).
func NewCallbackClient(hubURL, authToken string) *CallbackClient {
	return &CallbackClient{
		hubURL:    strings.TrimRight(hubURL, "/"),
		authToken: authToken,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// TaskAck sends an acknowledgement that the Edge server has received the task
// and started a run for it. Maps taskID → runID on the Hub side.
func (c *CallbackClient) TaskAck(ctx context.Context, taskID string, runID string) error {
	return c.callback(ctx, taskID, "ack", map[string]string{
		"run_id": runID,
	})
}

// TaskStream sends a streaming output chunk for an in-progress task.
func (c *CallbackClient) TaskStream(ctx context.Context, taskID string, runID string, content string) error {
	return c.callback(ctx, taskID, "stream", map[string]string{
		"run_id":  runID,
		"content": content,
	})
}

// TaskStreamReader sends streaming output from an io.Reader for an in-progress task.
// It reads and sends chunks of the reader's content, each as a separate stream callback.
// The reader is consumed fully; errors reading the reader are logged but do not fail the callback.
func (c *CallbackClient) TaskStreamReader(ctx context.Context, taskID string, runID string, output io.Reader) error {
	buf := make([]byte, 32*1024)
	for {
		n, err := output.Read(buf)
		if n > 0 {
			chunk := string(buf[:n])
			if streamErr := c.TaskStream(ctx, taskID, runID, chunk); streamErr != nil {
				slog.Warn("hub callback stream chunk failed", "taskId", taskID, "runId", runID, "err", streamErr)
				// Continue despite errors — best-effort streaming
			}
		}
		if err != nil {
			if err != io.EOF {
				slog.Warn("hub callback stream read error", "taskId", taskID, "runId", runID, "err", err)
			}
			return nil // Read errors are not propagated — callbacks are best-effort
		}
	}
}

// TaskDone reports that the task has completed successfully.
func (c *CallbackClient) TaskDone(ctx context.Context, taskID string, result TaskResult) error {
	return c.callback(ctx, taskID, "done", map[string]string{
		"run_id":        result.RunID,
		"final_content": result.FinalContent,
	})
}

// TaskFail reports that the task has failed with a reason.
func (c *CallbackClient) TaskFail(ctx context.Context, taskID string, runID string, reason string) error {
	return c.callback(ctx, taskID, "fail", map[string]string{
		"run_id": runID,
		"error":  reason,
	})
}

// callback sends a POST request to the Hub callback endpoint.
// It retries on transient errors up to 3 times with exponential backoff.
func (c *CallbackClient) callback(ctx context.Context, taskID string, action string, body map[string]string) error {
	url := fmt.Sprintf("%s/edge/agent-tasks/%s/%s", c.hubURL, taskID, action)

	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("hub callback marshal: %w", err)
	}

	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			backoff := time.Duration(1<<uint(attempt-1)) * time.Second // 1s, 2s, 4s
			slog.Debug("hub callback retry", "url", url, "attempt", attempt+1, "backoff", backoff)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoff):
			}
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
		if err != nil {
			lastErr = fmt.Errorf("hub callback request: %w", err)
			continue
		}
		req.Header.Set("Content-Type", "application/json")
		if c.authToken != "" {
			req.Header.Set("Authorization", "Bearer "+c.authToken)
		}

		resp, err := c.client.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("hub callback post: %w", err)
			continue
		}

		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			// Validate Hub response format: {"code": "OK", ...} or {"code": "..."}
			var hubResp struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			}
			if json.Unmarshal(respBody, &hubResp) == nil && hubResp.Code == "OK" {
				return nil
			}
			// Non-OK code from Hub is an application-level failure; do not retry
			if hubResp.Code != "" && hubResp.Code != "OK" {
				return fmt.Errorf("hub callback rejected: code=%s message=%s body=%s", hubResp.Code, hubResp.Message, string(respBody))
			}
			// 2xx without JSON body — accept as success
			return nil
		}

		// 4xx errors are not retryable (bad request, auth failure, etc.)
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
			return fmt.Errorf("hub callback client error HTTP %d: %s", resp.StatusCode, string(respBody))
		}

		// 5xx errors are retryable
		lastErr = fmt.Errorf("hub callback server error HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	return fmt.Errorf("hub callback failed after 3 attempts: %w", lastErr)
}
