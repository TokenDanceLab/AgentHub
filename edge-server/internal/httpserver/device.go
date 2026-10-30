package httpserver

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/agenthub/edge-server/internal/api"
	"github.com/agenthub/edge-server/internal/device"
	"github.com/agenthub/edge-server/internal/edgehttp"
	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/runcontrol"
	"github.com/agenthub/edge-server/internal/store"
)

// enrolledExecution uses the same admission core as PostRuns but only copies
// explicitly approved text fields. No skills, local memory, provider sessions,
// MCP, local profile or cc-switch configuration is discovered for Hub text work.
type enrolledExecution struct{ handler *api.Handler }

func (e enrolledExecution) Retained(taskID string) bool {
	_, ok := e.handler.Store.GetRunByHubTaskID(taskID)
	return ok
}

func (e enrolledExecution) Admit(ctx context.Context, r device.TextRun) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	h := e.handler
	if _, ok := h.Store.GetProject(r.ProjectID); !ok {
		if _, err := h.Store.CreateProject(r.ProjectID, "Paired Hub", ""); err != nil {
			return "", err
		}
	}
	if _, ok := h.Store.GetThread(r.ThreadID); !ok {
		if _, err := h.Store.CreateThread(r.ThreadID, r.ProjectID, "Hub conversation", "direct", "", ""); err != nil {
			return "", err
		}
	}
	run, err := runcontrol.Create(h.Store, h.Executor, h.Bus, runcontrol.CreateParams{
		ProjectID: r.ProjectID, ThreadID: r.ThreadID, Prompt: r.Prompt, AgentID: r.AgentID, Model: r.Model, WorkDir: r.WorkDir,
		HubTaskID: r.HubTaskID, CallbackOwner: "edge", WorkspaceAllowlist: h.WorkspaceAllowlist,
		AgentExists: func(id string) bool {
			if h.AdapterRegistry == nil {
				return false
			}
			a, ok := h.AdapterRegistry.Get(id)
			return ok && a.Available()
		},
		ValidateAdmission: func() *errcode.Error {
			c, ok := h.CallbackClient.(interface{ Configured() bool })
			if !ok || !c.Configured() {
				return errcode.ErrCallbackUnavailable
			}
			return nil
		},
		AuthorizeReplay: func(existing store.Run) *errcode.Error {
			if existing.ProjectID != r.ProjectID || existing.ThreadID != r.ThreadID || existing.CallbackOwner != "edge" {
				return errcode.ErrDeliveryConflict
			}
			return nil
		},
		BuildContext: func(run store.Run) lifecycle.RunProcessContext {
			return lifecycle.RunProcessContext{
				Run: run, Prompt: r.Prompt, AgentID: r.AgentID, Model: r.Model, WorkDir: r.WorkDir, HubTaskID: r.HubTaskID, DeliveryID: r.DeliveryID,
				Messages: r.Messages, PinnedMessages: r.PinnedMessages, SystemPrompt: r.SystemPrompt, AppendSystemPrompt: r.AppendSystemPrompt,
				ReasoningEffort: r.ReasoningEffort, MaxThinkingTokens: r.MaxThinkingTokens, TraceID: r.TraceID,
			}
		},
	})
	return run.ID, err
}

func (e enrolledExecution) Cancel(ctx context.Context, c device.Control) (string, bool, error) {
	if err := ctx.Err(); err != nil {
		return "", false, err
	}
	run, ok := e.handler.Store.GetRunByHubTaskID(c.TaskID)
	if !ok {
		if c.RunID != "" {
			return c.RunID, false, errors.New("assigned run unavailable")
		}
		// Worker durably fenced this task before calling us, so it cannot be
		// admitted later even if the Hub's delivery races this empty result.
		return "", true, nil
	}
	if (c.RunID != "" && run.ID != c.RunID) || run.CallbackOwner != "edge" {
		return run.ID, false, errors.New("control run identity mismatch")
	}
	if store.IsTerminalRunStatus(run.Status) {
		return run.ID, true, nil
	}
	result := e.handler.Executor.Cancel(run.ID)
	if !result.Found {
		return run.ID, false, errors.New("running executor unavailable")
	}
	return run.ID, store.IsTerminalRunStatus(result.Status), nil
}

func startEnrolledWorker(cfg Config, h *api.Handler) (func(), error) {
	if cfg.DeviceCredential == nil {
		return func() {}, nil
	}
	c, err := device.NewClient(cfg.DeviceCredential.HubURL, cfg.DeviceCredential.Secret, edgehttp.NewClient(30*time.Second))
	if err != nil {
		return nil, err
	}
	journal, err := device.OpenJournal(cfg.DeviceJournalPath)
	if err != nil {
		return nil, errors.New("cannot open enrolled device journal")
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	worker := device.Worker{Client: c, Credential: *cfg.DeviceCredential, Allowlist: cfg.WorkspaceAllowlist, Journal: journal, Execution: enrolledExecution{h}}
	go func() {
		defer close(done)
		if err := worker.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
			slog.Error("enrolled Edge polling stopped; existing jobs remain unchanged", "reason", err)
		}
	}()
	return func() { cancel(); <-done; _ = journal.Close() }, nil
}
