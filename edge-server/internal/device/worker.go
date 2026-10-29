package device

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/runnerctx"
)

// TextRun is intentionally narrower than the local run API. Paired devices do
// not accept local profiles, runtime overrides, provider configuration or tools.
type TextRun struct {
	ProjectID          string              `json:"projectId"`
	ThreadID           string              `json:"threadId"`
	Prompt             string              `json:"prompt"`
	AgentID            string              `json:"agentId"`
	Model              string              `json:"model"`
	WorkDir            string              `json:"workDir"`
	CallbackOwner      string              `json:"callbackOwner"`
	HubTaskID          string              `json:"hubTaskId"`
	DeliveryID         string              `json:"deliveryId"`
	Continue           *bool               `json:"continue,omitempty"`
	Messages           []runnerctx.Message `json:"messages,omitempty"`
	PinnedMessages     []runnerctx.Message `json:"pinnedMessages,omitempty"`
	SystemPrompt       string              `json:"systemPrompt,omitempty"`
	AppendSystemPrompt string              `json:"appendSystemPrompt,omitempty"`
	ReasoningEffort    string              `json:"reasoningEffort,omitempty"`
	MaxThinkingTokens  int                 `json:"maxThinkingTokens,omitempty"`
	TraceID            string              `json:"trace_id,omitempty"`
}

type Execution interface {
	Admit(context.Context, TextRun) (string, error)
	Retained(taskID string) bool
	// Cancel returns complete only once no executing work remains. An empty
	// run ID must resolve by persisted Hub task identity, not arbitrary runs.
	Cancel(context.Context, Control) (runID string, complete bool, err error)
}

type Worker struct {
	Client     *Client
	Credential Credential
	Allowlist  []string
	Journal    *Journal
	Execution  Execution
}

func (w *Worker) validateDelivery(d Delivery) (TextRun, error) {
	var r TextRun
	decoder := json.NewDecoder(bytes.NewReader(d.RunRequest))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&r) != nil || decoder.Decode(new(any)) != io.EOF {
		return r, errors.New("invalid text run request")
	}
	if !validIdentifier(d.ID) || !validIdentifier(d.TaskID) || r.HubTaskID != d.TaskID || r.DeliveryID != d.ID || r.CallbackOwner != "edge" {
		return r, errors.New("delivery identity mismatch")
	}
	if r.AgentID != "openai-sdk" || r.AgentID != w.Credential.RuntimeID {
		return r, errors.New("delivery runtime differs from enrolled runtime")
	}
	if r.Continue != nil && *r.Continue {
		return r, errors.New("paired text runs cannot resume a local runtime session")
	}
	if r.ProjectID != "paired-"+w.Credential.DeviceID || !strings.HasPrefix(r.ThreadID, "hub-") || !validIdentifier(r.ThreadID) {
		return r, errors.New("invalid enrolled session scope")
	}
	workspace, err := Workspace(r.WorkDir, w.Allowlist)
	if err != nil || workspace != w.Credential.WorkspaceRoot || r.WorkDir != w.Credential.WorkspaceRoot {
		return r, errors.New("delivery workspace differs from enrolled workspace")
	}
	if strings.TrimSpace(r.Model) == "" {
		return r, errors.New("delivery requires an explicit model")
	}
	return r, nil
}

// Run stops admitting work when credentials expire/revoke. It deliberately does
// not cancel existing jobs: credential failure is not user cancellation.
func (w *Worker) Run(ctx context.Context) error {
	if w.Client == nil || w.Journal == nil || w.Execution == nil {
		return errors.New("device worker missing dependency")
	}
	if err := w.Credential.Validate(); err != nil {
		return err
	}
	ctx, cancel := context.WithDeadline(ctx, w.Credential.ExpiresAt)
	defer cancel()
	for {
		err := w.Client.Heartbeat(ctx)
		if err == nil {
			break
		}
		if errors.Is(err, ErrUnauthorized) {
			return err
		}
		if !wait(ctx, 2*time.Second) {
			if !time.Now().Before(w.Credential.ExpiresAt) {
				return ErrUnauthorized
			}
			return ctx.Err()
		}
	}
	type pollResult struct {
		batch Batch
		err   error
	}
	results := make(chan pollResult)
	go func() {
		for {
			batch, err := w.Client.Poll(ctx)
			select {
			case results <- pollResult{batch, err}:
			case <-ctx.Done():
				return
			}
			if err != nil && !wait(ctx, 2*time.Second) {
				return
			}
			// A bounded minimum interval also protects against an empty immediate
			// poll response from a proxy or an older Hub implementation.
			if err == nil && !wait(ctx, 200*time.Millisecond) {
				return
			}
		}
	}()
	controls := time.NewTicker(250 * time.Millisecond)
	heartbeat := time.NewTicker(30 * time.Second)
	defer controls.Stop()
	defer heartbeat.Stop()
	for {
		select {
		case <-ctx.Done():
			if !time.Now().Before(w.Credential.ExpiresAt) {
				return ErrUnauthorized
			}
			return ctx.Err()
		case <-heartbeat.C:
			if err := w.Client.Heartbeat(ctx); errors.Is(err, ErrUnauthorized) {
				return err
			} else if err != nil {
				slog.Warn("Edge device heartbeat unavailable")
			}
		case <-controls.C:
			if err := w.reconcileControls(ctx); err != nil {
				return err
			}
		case result := <-results:
			if errors.Is(result.err, ErrUnauthorized) {
				return result.err
			}
			if result.err != nil {
				slog.Warn("Edge device poll unavailable; retrying")
				continue
			}
			if err := w.applyBatch(ctx, result.batch); err != nil {
				return err
			}
		}
	}
}

func (w *Worker) applyBatch(ctx context.Context, b Batch) error {
	// Persist all cancellation fences before admitting any task in this batch.
	for _, c := range b.Controls {
		if err := w.Journal.Record(c); err != nil {
			return errors.New("cannot persist device control; polling stopped")
		}
	}
	if err := w.reconcileControls(ctx); err != nil {
		return err
	}
	for _, d := range b.Deliveries {
		if err := ctx.Err(); err != nil {
			return err
		}
		cancelled, err := w.Journal.Cancelled(d.TaskID)
		if err != nil {
			return errors.New("cannot check device cancellation fence")
		}
		if cancelled {
			continue
		}
		r, err := w.validateDelivery(d)
		if err != nil {
			return fmt.Errorf("device delivery rejected; polling stopped: %w", err)
		}
		fresh, runID, err := w.Journal.BeginAdmission(d.TaskID, d.ID, r.ProjectID+"/"+r.ThreadID)
		if err != nil {
			return errors.New("cannot persist device admission intent")
		}
		if runID == "" {
			if !fresh && !w.Execution.Retained(d.TaskID) {
				return errors.New("prior device admission is uncertain; manual reconciliation required")
			}
			runID, err = w.Execution.Admit(ctx, r)
			if err != nil {
				// These are guaranteed pre-executor checks in runcontrol.Create.
				// Never release the intent for unknown/persistence/start errors.
				var admissionErr *errcode.Error
				if errors.As(err, &admissionErr) && (admissionErr.Code == errcode.ErrActiveRunExists.Code || admissionErr.Code == errcode.ErrCallbackUnavailable.Code || admissionErr.Code == errcode.ErrExecutorUnavailable.Code || admissionErr.Code == errcode.ErrInvalidAgentID.Code) {
					if err := w.Journal.Rejected(d.TaskID); err != nil {
						return errors.New("cannot persist rejected device admission")
					}
				}
				slog.Warn("Edge delivery admission unavailable; Hub may retry", "task_id", d.TaskID)
				continue
			}
			if err := w.Journal.Admitted(d.TaskID, runID); err != nil {
				return errors.New("cannot persist device admission receipt")
			}
		}
		// Admission replay must resend the receipt after a lost initial ack,
		// including after restart. It must never start another executor.
		if _, err := w.Client.request(ctx, "POST", "/edge/device/tasks/"+d.TaskID+"/ack", map[string]string{"run_id": runID}, nil); errors.Is(err, ErrUnauthorized) {
			return err
		}
	}
	return nil
}

func (w *Worker) reconcileControls(ctx context.Context) error {
	controls, err := w.Journal.Pending()
	if err != nil {
		return errors.New("cannot read device control journal")
	}
	for _, c := range controls {
		requestedRun := c.RunID
		admittedRun, admitted, err := w.Journal.Admission(c.TaskID)
		if err != nil {
			return errors.New("cannot read device admission evidence")
		}
		if c.RunID == "" {
			c.RunID = admittedRun
		}
		runID, complete, cancelErr := w.Execution.Cancel(ctx, c)
		if admitted && admittedRun == "" && !w.Execution.Retained(c.TaskID) {
			// The run may have been admitted just before a crash and then lost
			// from the local store. Absence cannot prove it never executed.
			complete, cancelErr = false, errors.New("prior admission outcome unknown")
		}
		if !complete && cancelErr == nil {
			continue
		}
		if runID != "" && requestedRun == "" {
			// The admission ACK may have been lost before Hub requested cancel.
			// Bind the durable original run first; control ACKs require an exact
			// Hub task/run match and must never imply a new execution.
			if _, err := w.Client.request(ctx, "POST", "/edge/device/tasks/"+c.TaskID+"/ack", map[string]string{"run_id": runID}, nil); err != nil {
				if errors.Is(err, ErrUnauthorized) {
					return err
				}
				continue
			}
			if admitted && admittedRun == "" {
				if err := w.Journal.Admitted(c.TaskID, runID); err != nil {
					return errors.New("cannot recover device admission identity")
				}
			}
			// Persist the resolved control identity before sending its ACK. If
			// that response is lost after Hub cancels the task, retrying must
			// resend only the control ACK, not a now-rejected task ACK.
			c.RunID = runID
			if err := w.Journal.Record(c); err != nil {
				return errors.New("cannot persist resolved device control identity")
			}
		}
		status, reason := "applied", ""
		if cancelErr != nil {
			status, reason = "failed", "execution cancellation could not be verified"
		}
		c.RunID = runID
		if err := w.Client.AckControl(ctx, c, status, reason); err != nil {
			if errors.Is(err, ErrUnauthorized) {
				return err
			}
			continue
		}
		if err := w.Journal.Acknowledged(c.ID); err != nil {
			return errors.New("cannot persist device control acknowledgement")
		}
	}
	return nil
}

func wait(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
