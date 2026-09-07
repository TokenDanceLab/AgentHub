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
	"math/rand"
	"net/http"
	"strings"
	"time"

	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/httputil"
	"github.com/agenthub/pkg/outboundmetrics"
	"github.com/agenthub/pkg/reqlog"
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
	tokenSource   func() string // live token override (edge auto-refresh); nil = static authToken
	cfg           CallbackConfig
	client        *http.Client
	journal       *DeliveryJournal
	sqliteJournal *SQLiteDeliveryJournal
	// outbound records every attempt against the unified outbound metrics
	// contract (#1595); nil is a no-op.
	outbound *outboundmetrics.Recorder
}

// SetTokenSource installs a live token provider. When set, every outbound
// callback reads the bearer token from the source at send time instead of the
// static authToken, so a rotated access token (edge auto-refresh) flows to the
// next attempt without a client rebuild.
func (c *CallbackClient) SetTokenSource(source func() string) {
	c.tokenSource = source
}

// currentAuthToken resolves the bearer token for an outbound request: the live
// token source wins, falling back to the static token.
func (c *CallbackClient) currentAuthToken() string {
	if c.tokenSource != nil {
		if live := c.tokenSource(); live != "" {
			return live
		}
	}
	return c.authToken
}

// Configured reports whether direct task callbacks have a destination and a
// current credential. It exposes no credential and makes no connectivity claim.
func (c *CallbackClient) Configured() bool {
	return c != nil && strings.TrimSpace(c.hubURL) != "" && strings.TrimSpace(c.currentAuthToken()) != ""
}

// TaskResult carries the final result of a completed task.
type TaskResult struct {
	RunID        string `json:"run_id"`
	FinalContent string `json:"final_content"`
}

// taskStreamEventBody is the typed stream request body sent by
// CallbackClient.TaskStreamEvent. Payload is embedded as a JSON object, never
// stringified, so the Hub handler can persist and rebroadcast it structurally.
type taskStreamEventBody struct {
	RunID       string          `json:"run_id"`
	EventType   string          `json:"event_type"`
	Payload     json.RawMessage `json:"payload"`
	ClientMsgID string          `json:"client_msg_id"`
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
// double-applying. stream chunks carry a deterministic client_msg_id (UUIDv5
// of runID+chunkIdx from fireHubStream) so the Hub's #130 idempotent
// stream-to-message dedup makes a retry safe to deliver; however stream is
// still deliberately not retried (#1564) because the structured path's
// per-call chunk index only stays stable within a single stream pass — a
// retried whole-stream delivery would re-emit the same client_msg_id sequence
// and the Hub would correctly dedup, but the conservative choice is to keep
// stream non-retryable and let the journal record the attempt for
// reconciliation.
func callbackActionRetryable(action string) bool {
	return action != "stream"
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

// WithMetrics attaches the unified outbound metrics recorder (#1595). nil is
// a no-op, so an unwired client keeps working without observability.
func (c *CallbackClient) WithMetrics(r *outboundmetrics.Recorder) *CallbackClient {
	if c != nil {
		c.outbound = r
	}
	return c
}

// recordOutcome records one callback attempt against the #1595 contract.
// category is success/failure; status carries the granular outcome (reusing
// the callback outcome categories).
func (c *CallbackClient) recordOutcome(category, status string, startedAt time.Time) {
	if c == nil || c.outbound == nil {
		return
	}
	c.outbound.Record(outboundmetrics.ProviderHub, outboundmetrics.PurposeCallback, category, status)
	c.outbound.Observe(outboundmetrics.ProviderHub, outboundmetrics.PurposeCallback, category, status, time.Since(startedAt))
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
	return c.callback(ctx, taskID, "ack", runID, map[string]string{
		"run_id": runID,
	})
}

// TaskStream sends a streaming output chunk for an in-progress task. The
// clientMsgID is a deterministic UUIDv5 derived from (runID, chunkIdx) by
// fireHubStream so the Hub can deduplicate replayed stream chunks (#130
// idempotent stream-to-message). An empty clientMsgID is a no-op for dedup
// (older callers that cannot derive one still work, they just lose replay
// protection). The body carries client_msg_id alongside run_id and content.
func (c *CallbackClient) TaskStream(ctx context.Context, taskID string, runID string, clientMsgID string, content string) error {
	return c.callback(ctx, taskID, "stream", runID, map[string]string{
		"run_id":        runID,
		"client_msg_id": clientMsgID,
		"content":       content,
	})
}

// TaskStreamEvent sends one typed Edge runtime event through the shared task
// stream endpoint. Payload must be a JSON object; the caller supplies an
// already sanitized RawMessage and a deterministic client_msg_id. Unlike the
// legacy TaskStream path, typed events are retried through the shared callback
// retry loop because their client_msg_id is stable per event and the Hub dedups
// by that key.
func (c *CallbackClient) TaskStreamEvent(ctx context.Context, taskID string, runID string, clientMsgID string, eventType string, payload json.RawMessage) error {
	trimmed := bytes.TrimSpace(payload)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return fmt.Errorf("hub callback typed stream payload must be a JSON object")
	}
	return c.callbackWithRetry(ctx, taskID, "stream", runID, taskStreamEventBody{
		RunID:       runID,
		EventType:   eventType,
		Payload:     trimmed,
		ClientMsgID: clientMsgID,
	}, true)
}

// TaskDone reports that the task has completed successfully.
func (c *CallbackClient) TaskDone(ctx context.Context, taskID string, result TaskResult) error {
	return c.callback(ctx, taskID, "done", result.RunID, map[string]string{
		"run_id":        result.RunID,
		"final_content": result.FinalContent,
	})
}

// TaskFail reports that the task has failed with a reason.
func (c *CallbackClient) TaskFail(ctx context.Context, taskID string, runID string, reason string) error {
	return c.callback(ctx, taskID, "fail", runID, map[string]string{
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

// callback sends a POST request to the Hub callback endpoint with the action's
// default retry policy.
func (c *CallbackClient) callback(ctx context.Context, taskID string, action string, runID string, body any) error {
	return c.callbackWithRetry(ctx, taskID, action, runID, body, callbackActionRetryable(action))
}

// callbackWithRetry sends a POST request to the Hub callback endpoint.
// It retries on transient failures under a total wall-clock budget: 5xx and
// network errors are retried when the caller marks the action idempotent,
// Retry-After (429/503) is honored and stops the sequence when it overruns the
// budget, and 4xx (except 429 with Retry-After) / 3xx / oversize responses are
// terminal. The body may be any JSON-marshalable value; existing string-only
// callbacks and the typed stream request share this single serializer and
// retry loop.
func (c *CallbackClient) callbackWithRetry(ctx context.Context, taskID string, action string, runID string, body any, retryableAction bool) error {
	url := fmt.Sprintf("%s/edge/agent-tasks/%s/%s", c.hubURL, taskID, action)

	payload, err := json.Marshal(body)
	if err != nil {
		c.recordJournal(taskID, runID, action, false, "hub callback marshal failed", 1)
		return fmt.Errorf("hub callback marshal: %w", err)
	}

	// The payload (taskID in the URL, runID in the body) is the callback's
	// idempotency key: every retry re-sends byte-identical content.
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
		return err
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
// in the caller). When using the local exponential backoff, ±25% jitter is
// applied so that a fleet of Edge instances retrying after a Hub-wide outage
// do not thunder the Hub simultaneously on recovery.
func (c *CallbackClient) retryDelay(attempt int, lastRetryAfter time.Duration) time.Duration {
	backoff := c.cfg.RetryBaseDelay << uint(attempt-1) // 1s, 2s, 4s, ...
	if lastRetryAfter > backoff {
		return lastRetryAfter
	}
	return applyCallbackJitter(backoff)
}

// callbackJitterFraction is the symmetric jitter fraction (±25%) applied to
// callback backoff, matching the delivery outbox retry jitter envelope.
const callbackJitterFraction = 0.25

// applyCallbackJitter applies a symmetric ±25% jitter to delay. A zero/negative
// delay is returned unchanged.
func applyCallbackJitter(delay time.Duration) time.Duration {
	if delay <= 0 {
		return delay
	}
	jitter := int64(float64(delay) * callbackJitterFraction)
	if jitter <= 0 {
		return delay
	}
	// rand.Int63n(2*jitter+1) ∈ [0, 2*jitter]; shift to [-jitter, +jitter].
	// #nosec G404 -- backoff jitter only; randomness is not security-sensitive.
	delta := rand.Int63n(2*jitter+1) - jitter
	return delay + time.Duration(delta)
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
	if token := c.currentAuthToken(); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	// Correlation contract (#1595): propagate the caller's request id so the
	// Hub side can join callback logs to the originating Edge request.
	reqlog.SetRequestIDHeader(ctx, req.Header)
	startedAt := time.Now()

	resp, err := c.client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			// Caller deadline/cancellation — retrying is pointless.
			c.recordOutcome(outboundmetrics.CategoryFailure, callbackCategoryTimeout, startedAt)
			return true, false, 0, fmt.Errorf("hub callback timeout: %w", err)
		}
		c.recordOutcome(outboundmetrics.CategoryFailure, callbackCategoryNetwork, startedAt)
		return false, true, 0, fmt.Errorf("hub callback post: %w", err)
	}

	respBody, readErr := readLimitedResponse(resp.Body, c.cfg.MaxResponseBodyBytes)
	_ = resp.Body.Close()
	if readErr != nil {
		// Fail-closed: an oversize response is a protocol anomaly; never
		// retried, body content never surfaces in logs (#1564).
		errMsg := fmt.Sprintf("status=%d body_len=over_limit limit=%d category=%s", resp.StatusCode, c.cfg.MaxResponseBodyBytes, callbackCategoryBodyTooLarge)
		c.recordJournal(taskID, runID, action, false, errMsg, attempt)
		c.recordOutcome(outboundmetrics.CategoryFailure, callbackCategoryBodyTooLarge, startedAt)
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
			c.recordOutcome(outboundmetrics.CategorySuccess, callbackCategoryOK, startedAt)
			return true, false, 0, nil
		}
		// Non-OK code from Hub is an application-level failure; do not retry
		if hubResp.Code != "" && hubResp.Code != errcode.OK.Code {
			errMsg := summarizeHubResponse(resp.StatusCode, respBody, callbackCategoryAppRejected)
			c.recordJournal(taskID, runID, action, false, errMsg, attempt)
			c.recordOutcome(outboundmetrics.CategoryFailure, callbackCategoryAppRejected, startedAt)
			return true, false, 0, fmt.Errorf("hub callback rejected: %s", errMsg)
		}
		// 2xx without JSON body — accept as success
		c.recordJournal(taskID, runID, action, true, "", attempt)
		c.recordOutcome(outboundmetrics.CategorySuccess, callbackCategoryOK, startedAt)
		return true, false, 0, nil
	}

	if canRetry && retryableAction {
		c.recordOutcome(outboundmetrics.CategoryFailure, callbackCategoryServerError, startedAt)
		return false, true, retryAfter, fmt.Errorf("hub callback server error: %s", summarizeHubResponse(resp.StatusCode, respBody, category))
	}

	// Terminal: 4xx (except 429 with Retry-After), 3xx, or a retryable
	// status on a non-idempotent action (stream).
	errMsg := summarizeHubResponse(resp.StatusCode, respBody, category)
	switch category {
	case callbackCategoryClientError, callbackCategoryRateLimited:
		c.recordJournal(taskID, runID, action, false, errMsg, attempt)
		c.recordOutcome(outboundmetrics.CategoryFailure, category, startedAt)
		return true, false, 0, fmt.Errorf("hub callback client error: %s", errMsg)
	case callbackCategoryRedirect:
		c.recordJournal(taskID, runID, action, false, errMsg, attempt)
		c.recordOutcome(outboundmetrics.CategoryFailure, callbackCategoryRedirect, startedAt)
		return true, false, 0, fmt.Errorf("hub callback redirect error: %s", errMsg)
	default:
		c.recordJournal(taskID, runID, action, false, errMsg, attempt)
		c.recordOutcome(outboundmetrics.CategoryFailure, callbackCategoryServerError, startedAt)
		return true, false, 0, fmt.Errorf("hub callback not retried (%s): %s", category, errMsg)
	}
}

// callbackRetryAfterCeiling is this path's explicit Retry-After policy: no
// fixed cap. A server hint here is bounded by the wall-clock retry budget
// (retryBudget, itself clamped to the caller's deadline), so an extreme hint
// stops the sequence through the budget check instead of being silently
// truncated. The SDK adapter makes the opposite choice — a 30s cap, because a
// run carries its own deadline. Both now hand their ceiling to the same shared
// parser, which makes the difference a visible argument rather than a
// divergence between two byte-identical copies (#2244).
const callbackRetryAfterCeiling = httputil.NoCeiling

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
		if delay, ok := httputil.ParseRetryAfter(retryAfterHeader); ok {
			return callbackCategoryRateLimited, true, httputil.CapHint(delay, callbackRetryAfterCeiling)
		}
		return callbackCategoryRateLimited, false, 0
	case statusCode >= 400 && statusCode < 500:
		return callbackCategoryClientError, false, 0
	case statusCode >= 500:
		delay, ok := httputil.ParseRetryAfter(retryAfterHeader)
		if !ok {
			return callbackCategoryServerError, true, 0
		}
		return callbackCategoryServerError, true, httputil.CapHint(delay, callbackRetryAfterCeiling)
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
