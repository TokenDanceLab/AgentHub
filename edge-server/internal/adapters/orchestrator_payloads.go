package adapters

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/store"
)

// attachSiblingContexts injects sibling agent context into each dispatch event
// so every sub-agent knows what others in the same batch are doing.
func attachSiblingContexts(events []dispatchEvent) []dispatchEvent {
	for i := range events {
		var siblings []SiblingInfo
		for j := range events {
			if i == j {
				continue
			}
			siblings = append(siblings, SiblingInfo{
				AgentName:   events[j].Agent,
				TaskDesc:    events[j].Task,
				TargetFiles: events[j].TargetFiles,
			})
		}
		events[i].siblings = siblings
	}
	return events
}

// cloneDispatchForAgent copies a dispatch event and retargets the agent.
func cloneDispatchForAgent(orig dispatchEvent, altID string) dispatchEvent {
	return dispatchEvent{
		Action:      "dispatch",
		Agent:       altID,
		Task:        orig.Task,
		Role:        orig.Role,
		ThreadID:    orig.ThreadID,
		Model:       orig.Model,
		SubtaskID:   orig.SubtaskID,
		TargetFiles: orig.TargetFiles,
		DependsOn:   orig.DependsOn,
	}
}

// defaultDispatchRole returns the role or the stable default "worker".
func defaultDispatchRole(role string) string {
	if role == "" {
		return "worker"
	}
	return role
}

// dispatchErrorPayload builds a task notification payload for dispatch failures.
func dispatchErrorPayload(agent, task, errMsg, subtaskID string, agentID string) map[string]any {
	p := map[string]any{
		"action":    "dispatch_error",
		"agent":     agent,
		"task":      task,
		"error":     errMsg,
		"subtaskId": subtaskID,
	}
	if agentID != "" {
		p["agentId"] = agentID
	}
	return p
}

// dispatchRejectedPayload builds a task notification payload for circuit-breaker rejects.
func dispatchRejectedPayload(agent, task, errMsg, subtaskID string) map[string]any {
	return map[string]any{
		"action":    "dispatch_rejected",
		"agent":     agent,
		"task":      task,
		"error":     errMsg,
		"subtaskId": subtaskID,
	}
}

// taskDispatchedPayload builds the BusEventTaskDispatched payload.
func taskDispatchedPayload(agentID, agent, task, role, runID, parentID, threadID, model, subtaskID string) map[string]any {
	return map[string]any{
		"agentId":   agentID,
		"agent":     agent,
		"task":      task,
		"role":      role,
		"runId":     runID,
		"parentId":  parentID,
		"threadId":  threadID,
		"model":     model,
		"subtaskId": subtaskID,
	}
}

// subAgentStatusPayload builds a BusEventSubAgentStatus payload.
// When includeError is false, the "error" key is omitted (dispatch-time status).
// When includeError is true, "error" is always present (even if empty), matching
// historical result/skip status event shapes.
func subAgentStatusPayload(agentID, agentName, status, progress string, includeError bool, errStr string) map[string]any {
	p := map[string]any{
		"agentId":   agentID,
		"agentName": agentName,
		"status":    status,
		"progress":  progress,
	}
	if includeError {
		p["error"] = errStr
	}
	return p
}

// ruleEngineCompletionPayload builds the text-block payload for completion short-circuit.
func ruleEngineCompletionPayload() map[string]any {
	return map[string]any{
		"text":   "[Orchestrator] All sub-agent tasks have completed.",
		"source": "rule_engine",
	}
}

// resultInjectPayload builds a text-block payload for sub-agent result injection.
func resultInjectPayload(text, source string) map[string]any {
	return map[string]any{
		"text":   text,
		"source": source,
	}
}

// taskProgressPayload builds BusEventTaskProgress payload from counts.
func taskProgressPayload(summary string, completed, errored, running, waiting, total int) map[string]any {
	return map[string]any{
		"summary":   summary,
		"completed": completed,
		"errored":   errored,
		"running":   running,
		"waiting":   waiting,
		"total":     total,
	}
}

// childStatusCounts aggregates registry children by status.
type childStatusCounts struct {
	completed int
	running   int
	waiting   int
	errored   int
	total     int
}

func countChildStatuses(children []agents.AgentInstance) childStatusCounts {
	var c childStatusCounts
	c.total = len(children)
	for _, child := range children {
		switch child.Status {
		case agents.StatusCompleted:
			c.completed++
		case agents.StatusError:
			c.errored++
		case agents.StatusBusy:
			c.running++
		default:
			c.waiting++
		}
	}
	return c
}

// formatProgressSummaryText builds the human-readable progress summary string.
func formatProgressSummaryText(c childStatusCounts) string {
	var parts []string
	if c.completed > 0 {
		parts = append(parts, fmt.Sprintf("%d completed", c.completed))
	}
	if c.errored > 0 {
		parts = append(parts, fmt.Sprintf("%d error", c.errored))
	}
	if c.running > 0 {
		parts = append(parts, fmt.Sprintf("%d running", c.running))
	}
	if c.waiting > 0 {
		parts = append(parts, fmt.Sprintf("%d waiting", c.waiting))
	}

	summary := fmt.Sprintf("%d of %d sub-agents done", c.completed+c.errored, c.total)
	if len(parts) > 0 {
		summary += " (" + strings.Join(parts, ", ") + ")"
	}
	return summary
}

// formatResultSummary extracts a human-readable summary from the sub-agent
// result payload, truncating to approximately 500 characters.
func formatResultSummary(payload map[string]any) string {
	if payload == nil {
		return "(no output)"
	}
	if result, ok := payload["result"].(string); ok && result != "" {
		if len(result) > 500 {
			return result[:500] + "..."
		}
		return result
	}
	// Try to marshal the whole payload as a fallback.
	b, err := json.Marshal(payload)
	if err != nil {
		return "(unable to format result)"
	}
	s := string(b)
	if len(s) > 500 {
		s = s[:500] + "..."
	}
	return s
}

// formatRetryInjectText builds the retry notification text with reflexion critique.
func formatRetryInjectText(agentName, errMsg, retryDirective, critique string) string {
	return fmt.Sprintf("[Sub-agent: %s] transient failure, retrying with analysis...\nError: %s\n%s\nCritique: %s", agentName, errMsg, retryDirective, critique)
}

// formatRetryDirective builds the T1-D03 retry context purification marker.
func formatRetryDirective(failureErr error) string {
	return fmt.Sprintf(
		"[Previous attempt failed: %s. Use a DIFFERENT strategy. Do NOT repeat the same approach.]",
		truncateError(failureErr, 200),
	)
}

// formatSwitchInjectText builds switch-agent notification text.
func formatSwitchInjectText(agentName, altID, errMsg string, hasAlt bool) string {
	if hasAlt {
		return fmt.Sprintf("[Sub-agent: %s] capability failure, switching to alternate agent %s...\nError: %s", agentName, altID, errMsg)
	}
	return fmt.Sprintf("[Sub-agent: %s] capability failure, no alternate agent available\nError: %s", agentName, errMsg)
}

// formatSkipInjectText builds skip-agent notification text.
func formatSkipInjectText(agentName, errMsg string) string {
	return fmt.Sprintf("[Sub-agent: %s] task skipped (unrecoverable)\nError: %s", agentName, errMsg)
}

// formatFailInjectText builds unrecoverable-failure notification text.
func formatFailInjectText(agentName, errMsg, critique string) string {
	return fmt.Sprintf("[Sub-agent: %s] unrecoverable failure\nError: %s\nCritique: %s", agentName, errMsg, critique)
}

// formatSubAgentResultInjectText builds success/error result injection text.
func formatSubAgentResultInjectText(agentName string, isError bool, errMsg, resultSummary string) string {
	if isError {
		return fmt.Sprintf("[Sub-agent: %s] failed\nError: %s", agentName, errMsg)
	}
	return fmt.Sprintf("[Sub-agent: %s] completed task\nResult: %s", agentName, resultSummary)
}

// formatPlanRejectedInjectText builds plan-gate rejection text.
func formatPlanRejectedInjectText(reason string) string {
	return fmt.Sprintf("[Plan rejected by user: %s]", reason)
}

// planProposedPayload builds BusEventPlanProposed payload.
func planProposedPayload(runID string, tasks []PlanTask, mode string) map[string]any {
	return map[string]any{
		"runId": runID,
		"plan": map[string]any{
			"tasks": tasks,
			"mode":  mode,
		},
	}
}

// planDecisionPayload builds plan approved/rejected payloads.
func planDecisionPayload(runID, reason string) map[string]any {
	return map[string]any{
		"runId":  runID,
		"reason": reason,
	}
}

// buildPendingPlanFromDispatches maps dispatch events into a PendingPlan for the approval gate.
func buildPendingPlanFromDispatches(run store.Run, events []dispatchEvent) PendingPlan {
	tasks := make([]PlanTask, len(events))
	for i, evt := range events {
		deps := evt.DependsOn
		if deps == nil {
			deps = []string{}
		}
		tasks[i] = PlanTask{
			Agent:       evt.Agent,
			Description: evt.Task,
			DependsOn:   deps,
		}
	}

	mode := "parallel"
	if len(events) == 1 {
		mode = "single"
	}

	return PendingPlan{
		RunID:     run.ID,
		ProjectID: run.ProjectID,
		ThreadID:  run.ThreadID,
		Tasks:     tasks,
		Mode:      mode,
		CreatedAt: time.Now().UTC(),
		Status:    "pending",
	}
}
