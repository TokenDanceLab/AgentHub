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
// Callbacks are fire-and-forget with a bounded retry policy (#1564): failures
// are logged and journaled but never block the run lifecycle. The transport
// policy (timeout, retry budget, response body cap, redirect policy) is
// injected from the composition root; the client is built once and reused so
// connections are pooled.
package hub

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/agenthub/edge-server/internal/errcode"
)

// CallbackConfig is the explicit transport policy for the Edge→Hub callback
// client, assembled at the composition root (#1564). Zero fields fall back to
// DefaultCallbackConfig semantics.
type CallbackConfig struct {
	// Timeout bounds each individual request (default 30s).
	Timeout time.Duration
	// MaxAttempts is the total number of attempts including the first
	// (default 3).
	MaxAttempts int
	// RetryBaseDelay is the exponential backoff base between attempts
	// (default 1s → 1s, 2s, ...).
	RetryBaseDelay time.Duration
	// RetryBudget is the total wall-clock envelope for retries, capped by
	// the caller's context deadline when one exists (default 10s).
	RetryBudget time.Duration
	// MaxResponseBodyBytes is the fail-closed cap on Hub response bodies
	// (default 64 KiB). Responses exceeding it are treated as errors and
	// never retried.
	MaxResponseBodyBytes int64
}

// DefaultCallbackConfig returns the historical callback semantics as an
// explicit config: 30s timeout, 3 attempts, 1s/2s exponential backoff,
// 10s total retry budget, 64 KiB response cap.
func DefaultCallbackConfig() CallbackConfig {
	return CallbackConfig{
		Timeout:              30 * time.Second,
		MaxAttempts:          3,
		RetryBaseDelay:       time.Second,
		RetryBudget:          10 * time.Second,
		MaxResponseBodyBytes: 64 * 1024,
	}
}

// withDefaults fills zero-valued fields with the default policy.
func (c CallbackConfig) withDefaults() CallbackConfig {
	d := DefaultCallbackConfig()
	if c.Timeout <= 0 {
		c.Timeout = d.Timeout
	}
	if c.MaxAttempts <= 0 {
		c.MaxAttempts = d.MaxAttempts
	}
	if c.RetryBaseDelay <= 0 {
		c.RetryBaseDelay = d.RetryBaseDelay
	}
	if c.RetryBudget <= 0 {
		c.RetryBudget = d.RetryBudget
	}
	if c.MaxResponseBodyBytes <= 0 {
		c.MaxResponseBodyBytes = d.MaxResponseBodyBytes
	}
	return c
}

// CallbackClient reports Edge run lifecycle events to the Hub server.
// It is safe for concurrent use.
type CallbackClient struct {
	hubURL        string
	authToken     string
	cfg           CallbackConfig
	client        *http.Client
	journal       *DeliveryJournal
	sqliteJournal *SQLiteDeliveryJournal
}

// TaskResult carries the final result of a completed task.
type TaskResult struct {
	RunID        string `json:"run_id"`
	FinalContent string `json:"final_content"`
}

func summarizeHubResponse(status int, body []byte, category string) string {
	hash := sha256.Sum256(body)
	return fmt.Sprintf(
		"status=%d body_len=%d body_sha256_prefix=%s category=%s",
		status,
		len(body),
		hex.EncodeToString(hash[:])[:12],
		category,
	)
}

// Callback attempt outcome categories (unified classification contract #1564).
// Categories are stable strings used in journal entries and error messages;
// they never include response body content or credentials.
const (
	callbackCategoryOK           = "ok"
	callbackCategoryAppRejected  = "app_rejected"
	callbackCategoryClientError  = "client_error"
	callbackCategoryRateLimited  = "rate_limited"
	callbackCategoryServerError  = "server_error"
	callbackCategoryRedirect     = "redirect_error"
	callbackCategoryBodyTooLarge = "body_too_large"
	callbackCategoryNetwork      = "network_error"
	callbackCategoryTimeout      = "timeout_error"
)

// callbackActionRetryable reports whether retrying a callback action is safe.
// ack/done/fail are guarded by task-status transitions on the Hub side, so a
// retried delivery either completes the transition or is rejected without
// double-applying. stream chunks are content appends without a client_msg_id
// in the payload — a retry could duplicate the chunk, so stream is
// deliberately not retried (#1564).
func callbackActionRetryable(action string) bool {
	return action != "stream"
}

// parseRetryAfter parses an HTTP Retry-After header (delta-seconds or HTTP
// date). ok=false when absent or unparseable — callers must not guess.
func parseRetryAfter(value string) (time.Duration, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	if n, err := strconv.Atoi(value); err == nil && n >= 0 {
		return time.Duration(n) * time.Second, true
	}
	if t, err := http.ParseTime(value); err == nil {
		delay := time.Until(t)
		if delay < 0 {
			delay = 0
		}
		return delay, true
	}
	return 0, false
}

// readLimitedResponse reads at most max bytes and fails closed when the
// source exceeds the cap (no body content is retained past the limit).
func readLimitedResponse(r io.Reader, max int64) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(r, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > max {
		return nil, fmt.Errorf("response body exceeds %d bytes", max)
	}
	return body, nil
}

// NewCallbackClient creates a CallbackClient with an explicit transport
// policy injected by the composition root (#1564). The http.Client must be
// built by the caller (edgehttp.NewClient) — the callback package never
// constructs clients; connection reuse, the bounded timeout and redirect
// refusal are all owned by the injected client.
func NewCallbackClient(hubURL, authToken string, client *http.Client, cfg CallbackConfig) *CallbackClient {
	cfg = cfg.withDefaults()
	if client == nil {
		panic("hub: NewCallbackClient requires a non-nil *http.Client (construct it at the composition root, e.g. edgehttp.NewClient)")
	}
	return &CallbackClient{
		hubURL:    strings.TrimRight(hubURL, "/"),
		authToken: authToken,
		cfg:       cfg,
		client:    client,
		journal:   NewDeliveryJournal(1000),
	}
}

// WithJournal replaces the delivery journal (tests / durable impl later).
func (c *CallbackClient) WithJournal(j *DeliveryJournal) *CallbackClient {
	if c != nil {
		c.journal = j
	}
	return c
}

// Journal exposes the Edge→Hub delivery journal for reconciliation.
func (c *CallbackClient) Journal() *DeliveryJournal {
	if c == nil {
		return nil
	}
	return c.journal
}

// DurableSnapshot returns journal entries with seq > afterSeq, preferring SQLite
// when enabled so reconciliation survives process restarts.
func (c *CallbackClient) DurableSnapshot(afterSeq uint64) ([]DeliveryJournalEntry, error) {
	if c == nil {
		return nil, nil
	}
	if c.sqliteJournal != nil {
		return c.sqliteJournal.Snapshot(afterSeq)
	}
	if c.journal == nil {
		return nil, nil
	}
	return c.journal.Snapshot(afterSeq), nil
}

// EnableSQLiteJournal swaps the in-memory journal for a durable SQLite journal.
// On failure, keeps the existing in-memory journal and returns the error.
func (c *CallbackClient) EnableSQLiteJournal(path string) error {
	if c == nil {
		return nil
	}
	sj, err := OpenSQLiteDeliveryJournal(path)
	if err != nil {
		return err
	}
	// Bridge: copy is not required; new durable journal starts fresh or reloads via Snapshot.
	// Replace memory journal with adapter that records into sqlite AND keeps memory optional.
	c.journal = &DeliveryJournal{max: 1000} // keep memory mirror for fast Snapshot in-process
	c.sqliteJournal = sj
	return nil
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
				slog.Warn("hub callback stream chunk failed", "taskId", taskID, "runId", runID, "error", streamErr)
				// Continue despite errors — best-effort streaming
			}
		}
		if err != nil {
			if err != io.EOF {
				slog.Warn("hub callback stream read error", "taskId", taskID, "runId", runID, "error", err)
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

// retryBudget returns the total wall-clock envelope for retry waits, capped
// by the caller's deadline when one exists. Zero means no retries are
// affordable beyond the current attempt (#1564).
func (c *CallbackClient) retryBudget(ctx context.Context) time.Duration {
	budget := c.cfg.RetryBudget
	if deadline, ok := ctx.Deadline(); ok {
		remaining := time.Until(deadline)
		if remaining < budget {
			budget = remaining
		}
	}
	if budget < 0 {
		return 0
	}
	return budget
}

// callback sends a POST request to the Hub callback endpoint.
// It retries on transient failures under a total wall-clock budget: 5xx and
// network errors are retried for idempotent actions, Retry-After (429/503) is
// honored and stops the sequence when it overruns the budget, and 4xx (except
// 429 with Retry-After) / 3xx / oversize responses are terminal.
func (c *CallbackClient) callback(ctx context.Context, taskID string, action string, body map[string]string) error {
	url := fmt.Sprintf("%s/edge/agent-tasks/%s/%s", c.hubURL, taskID, action)
	runID := ""
	if body != nil {
		runID = body["run_id"]
	}

	payload, err := json.Marshal(body)
	if err != nil {
		c.recordJournal(taskID, runID, action, false, "hub callback marshal failed", 1)
		return fmt.Errorf("hub callback marshal: %w", err)
	}

	// The payload (taskID in the URL, runID in the body) is the callback's
	// idempotency key: every retry re-sends byte-identical content.
	retryableAction := callbackActionRetryable(action)
	budget := c.retryBudget(ctx)
	startedAt := time.Now()
	var lastErr error
	var lastRetryAfter time.Duration

	for attempt := 0; attempt < c.cfg.MaxAttempts; attempt++ {
		if attempt > 0 {
			delay := c.retryDelay(attempt, lastRetryAfter)
			elapsed := time.Since(startedAt)
			if elapsed+delay > budget {
				// Retry budget exhausted — Retry-After or backoff would overrun.
				lastErr = fmt.Errorf("hub callback retry budget exhausted (elapsed=%s budget=%s)", elapsed.Round(time.Millisecond), budget.Round(time.Millisecond))
				break
			}
			slog.Debug("hub callback retry", "url", url, "attempt", attempt+1, "backoff", delay)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(delay):
			}
		}

		done, retryable, retryAfter, err := c.doAttempt(ctx, url, payload, taskID, runID, action, attempt+1, retryableAction)
		if done {
			return err
		}
		if retryable {
			lastErr = err
			lastRetryAfter = retryAfter
			continue
		}
<<<<<<< HEAD
		return err
=======
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
		_ = resp.Body.Close()

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			// Validate Hub response format: {"code": "ok", ...} or {"code": "..."}
			var hubResp struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			}
			if json.Unmarshal(respBody, &hubResp) == nil && hubResp.Code == errcode.OK.Code {
				c.recordJournal(taskID, runID, action, true, "", attempt+1)
				return nil
			}
			// Non-OK code from Hub is an application-level failure; do not retry
			if hubResp.Code != "" && hubResp.Code != errcode.OK.Code {
				errMsg := summarizeHubResponse(resp.StatusCode, respBody, "app_rejected")
				c.recordJournal(taskID, runID, action, false, errMsg, attempt+1)
				return fmt.Errorf("hub callback rejected: %s", errMsg)
			}
			// 2xx without JSON body — accept as success
			c.recordJournal(taskID, runID, action, true, "", attempt+1)
			return nil
		}

		// 4xx errors are not retryable (bad request, auth failure, etc.)
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
			errMsg := summarizeHubResponse(resp.StatusCode, respBody, "client_error")
			c.recordJournal(taskID, runID, action, false, errMsg, attempt+1)
			return fmt.Errorf("hub callback client error: %s", errMsg)
		}

		// 5xx errors are retryable
		lastErr = fmt.Errorf("hub callback server error: %s", summarizeHubResponse(resp.StatusCode, respBody, "server_error"))
>>>>>>> 06a51469 (fix(security): 分诊并清零 Hub/Edge gosec 告警，security scan 改 hard fail (#1574))
	}

	errMsg := ""
	if lastErr != nil {
		errMsg = lastErr.Error()
	}
	c.recordJournal(taskID, runID, action, false, errMsg, c.cfg.MaxAttempts)
	return fmt.Errorf("hub callback failed after %d attempts: %w", c.cfg.MaxAttempts, lastErr)
}

// retryDelay computes the backoff for the given attempt, preferring a server
// Retry-After delay when the server supplied one (bounded by the budget check
// in the caller).
func (c *CallbackClient) retryDelay(attempt int, lastRetryAfter time.Duration) time.Duration {
	backoff := c.cfg.RetryBaseDelay << uint(attempt-1) // 1s, 2s, 4s, ...
	if lastRetryAfter > backoff {
		return lastRetryAfter
	}
	return backoff
}

// doAttempt performs one callback POST and classifies the outcome. It returns
// done=true when the attempt is terminal (success, terminal error, oversize
// response, caller cancellation); otherwise it returns whether the attempt is
// retryable along with any Retry-After hint and the error to record.
func (c *CallbackClient) doAttempt(ctx context.Context, url string, payload []byte, taskID string, runID string, action string, attempt int, retryableAction bool) (done bool, retryable bool, retryAfter time.Duration, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return false, true, 0, fmt.Errorf("hub callback request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if c.authToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.authToken)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			// Caller deadline/cancellation — retrying is pointless.
			return true, false, 0, fmt.Errorf("hub callback timeout: %w", err)
		}
		return false, true, 0, fmt.Errorf("hub callback post: %w", err)
	}

	respBody, readErr := readLimitedResponse(resp.Body, c.cfg.MaxResponseBodyBytes)
	_ = resp.Body.Close()
	if readErr != nil {
		// Fail-closed: an oversize response is a protocol anomaly; never
		// retried, body content never surfaces in logs (#1564).
		errMsg := fmt.Sprintf("status=%d body_len=over_limit limit=%d category=%s", resp.StatusCode, c.cfg.MaxResponseBodyBytes, callbackCategoryBodyTooLarge)
		c.recordJournal(taskID, runID, action, false, errMsg, attempt)
		return true, false, 0, fmt.Errorf("hub callback response too large: %s", errMsg)
	}

	category, canRetry, retryAfter := classifyCallbackResponse(resp.StatusCode, resp.Header.Get("Retry-After"))

	if category == callbackCategoryOK {
		// Validate Hub response format: {"code": "ok", ...} or {"code": "..."}
		var hubResp struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		if json.Unmarshal(respBody, &hubResp) == nil && hubResp.Code == errcode.OK.Code {
			c.recordJournal(taskID, runID, action, true, "", attempt)
			return true, false, 0, nil
		}
		// Non-OK code from Hub is an application-level failure; do not retry
		if hubResp.Code != "" && hubResp.Code != errcode.OK.Code {
			errMsg := summarizeHubResponse(resp.StatusCode, respBody, callbackCategoryAppRejected)
			c.recordJournal(taskID, runID, action, false, errMsg, attempt)
			return true, false, 0, fmt.Errorf("hub callback rejected: %s", errMsg)
		}
		// 2xx without JSON body — accept as success
		c.recordJournal(taskID, runID, action, true, "", attempt)
		return true, false, 0, nil
	}

	if canRetry && retryableAction {
		return false, true, retryAfter, fmt.Errorf("hub callback server error: %s", summarizeHubResponse(resp.StatusCode, respBody, category))
	}

	// Terminal: 4xx (except 429 with Retry-After), 3xx, or a retryable
	// status on a non-idempotent action (stream).
	errMsg := summarizeHubResponse(resp.StatusCode, respBody, category)
	switch category {
	case callbackCategoryClientError, callbackCategoryRateLimited:
		c.recordJournal(taskID, runID, action, false, errMsg, attempt)
		return true, false, 0, fmt.Errorf("hub callback client error: %s", errMsg)
	case callbackCategoryRedirect:
		c.recordJournal(taskID, runID, action, false, errMsg, attempt)
		return true, false, 0, fmt.Errorf("hub callback redirect error: %s", errMsg)
	default:
		c.recordJournal(taskID, runID, action, false, errMsg, attempt)
		return true, false, 0, fmt.Errorf("hub callback not retried (%s): %s", category, errMsg)
	}
}

// classifyCallbackResponse maps an HTTP response to the unified outcome
// contract: category, whether the attempt is retryable, and the Retry-After
// delay when the server supplied one. 4xx are terminal except 429 with an
// explicit Retry-After; 5xx are retryable; 3xx are terminal (redirects are
// refused at the client, so a 3xx here means the Hub misbehaved).
func classifyCallbackResponse(statusCode int, retryAfterHeader string) (category string, retryable bool, retryAfter time.Duration) {
	switch {
	case statusCode >= 200 && statusCode < 300:
		return callbackCategoryOK, false, 0
	case statusCode >= 300 && statusCode < 400:
		return callbackCategoryRedirect, false, 0
	case statusCode == http.StatusTooManyRequests:
		if delay, ok := parseRetryAfter(retryAfterHeader); ok {
			return callbackCategoryRateLimited, true, delay
		}
		return callbackCategoryRateLimited, false, 0
	case statusCode >= 400 && statusCode < 500:
		return callbackCategoryClientError, false, 0
	case statusCode >= 500:
		delay, ok := parseRetryAfter(retryAfterHeader)
		if !ok {
			return callbackCategoryServerError, true, 0
		}
		return callbackCategoryServerError, true, delay
	default:
		return callbackCategoryServerError, false, 0
	}
}

func (c *CallbackClient) recordJournal(taskID, runID, action string, ok bool, errMsg string, attempts int) {
	if c == nil {
		return
	}
	if c.journal != nil {
		c.journal.Record(taskID, runID, action, ok, errMsg, attempts)
	}
	if c.sqliteJournal != nil {
		if _, err := c.sqliteJournal.Record(taskID, runID, action, ok, errMsg, attempts); err != nil {
			// best-effort durability; never block callback path
			slog.Warn("durable delivery journal write failed", "taskId", taskID, "action", action, "error", err)
		}
	}
}
