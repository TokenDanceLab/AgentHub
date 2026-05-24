package adapters

import (
	"context"
	"io"
	"log/slog"

	"github.com/agenthub/edge-server/internal/store"
)

// DispatchAwareParser wraps an NDJSON stream and intercepts task_dispatched
// events. When a dispatch is detected, it calls the SubAgentSpawner to create
// a new run for the sub-agent.
//
// This implements the AgentTree pattern: orchestrator → sub-agent spawn → result.
type DispatchAwareParser struct {
	inner   *NDJSONStreamParser
	spawner SubAgentSpawner
	run     store.Run
	depth   int // current delegation depth
}

// NewDispatchAwareParser creates a parser that intercepts sub-agent dispatch
// events and spawns new runs via the provided spawner.
func NewDispatchAwareParser(inner *NDJSONStreamParser, spawner SubAgentSpawner, run store.Run, depth int) *DispatchAwareParser {
	return &DispatchAwareParser{
		inner:   inner,
		spawner: spawner,
		run:     run,
		depth:   depth,
	}
}

// Parse reads NDJSON from r, intercepting task_dispatched events.
func (p *DispatchAwareParser) Parse(ctx context.Context, r io.Reader) error {
	// We wrap the inner parser by creating a custom emitter that intercepts
	// task_dispatched events before they reach the event bus.
	//
	// The inner parser already emits task_dispatched events. We wrap its
	// emitter to detect these events and trigger sub-agent spawn.
	wrapped := &dispatchEmitter{
		inner:   p.inner.emitter,
		spawner: p.spawner,
		run:     p.run,
		depth:   p.depth,
	}
	p.inner.emitter = wrapped
	return p.inner.Parse(ctx, r)
}

// dispatchEmitter wraps an EventEmitter to intercept task_dispatched.
type dispatchEmitter struct {
	inner   EventEmitter
	spawner SubAgentSpawner
	run     store.Run
	depth   int
}

func (d *dispatchEmitter) Emit(eventType string, scope map[string]any, payload any) {
	// Intercept task_dispatched to spawn a sub-agent run
	if eventType == BusEventTaskDispatched && d.spawner != nil {
		if taskID, ok := extractDispatchTask(payload); ok {
			task := SubAgentTask{
				TaskID:      taskID,
				Description: extractString(payload, "description"),
				Prompt:      extractString(payload, "description"), // task description IS the prompt
				Depth:       d.depth + 1,
				ParentRunID: d.run.ID,
			}
			// Try to resolve agent from description
			if agentID := extractString(payload, "taskType"); agentID != "" {
				task.AgentID = agentID
			}

			agentInstID, runID, err := d.spawner.SpawnSubAgent(d.run, task)
			if err != nil {
				slog.Error("failed to spawn sub-agent",
					"taskId", taskID,
					"targetAgent", task.AgentID,
					"err", err,
				)
				// Emit a dispatch error so the orchestrator knows
				d.inner.Emit("run.agent.task_dispatch_failed", scope, map[string]any{
					"taskId": taskID,
					"error":  err.Error(),
				})
				return
			}
			slog.Info("sub-agent spawned",
				"taskId", taskID,
				"agentInstanceId", agentInstID,
				"runId", runID,
				"depth", d.depth+1,
			)
			// Enrich the dispatch event with the spawned agent info
			if mp, ok := payload.(map[string]any); ok {
				mp["agentInstanceId"] = agentInstID
				mp["subAgentRunId"] = runID
			}
		}
	}
	d.inner.Emit(eventType, scope, payload)
}

func extractDispatchTask(payload any) (taskID string, ok bool) {
	mp, ok := payload.(map[string]any)
	if !ok {
		return "", false
	}
	taskID, _ = mp["taskId"].(string)
	return taskID, taskID != ""
}

func extractString(payload any, key string) string {
	mp, ok := payload.(map[string]any)
	if !ok {
		return ""
	}
	s, _ := mp[key].(string)
	return s
}
