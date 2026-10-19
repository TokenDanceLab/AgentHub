package lifecycle

import (
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/store"
)

// newSubAgentRunContext builds the isolated RunProcessContext for a dispatched
// sub-agent. SessionID is a fresh random UUID — the claude-code CLI validates
// --session-id as a UUID and the gateway rejects hierarchical thread paths
// like "parent/sub/run_x" ("Invalid session ID. Must be a valid UUID"). The
// ThreadID stays hierarchical (stored on the run), so context isolation is
// preserved without poisoning the CC session argument.
func newSubAgentRunContext(run store.Run, task adapters.SubAgentTask) RunProcessContext {
	return RunProcessContext{
		Run:       run,
		Prompt:    task.Prompt,
		AgentID:   task.AgentID,
		Budget:    childBudget(task.Budget, task.Depth),
		Model:     task.Model,
		SessionID: newRandomSessionID(),
	}
}

// withSiblingSystemPrompt prepends a sibling-context prompt when the task lists
// parallel sibling agents.
func withSiblingSystemPrompt(existing string, siblingAgents []adapters.SiblingInfo) string {
	if len(siblingAgents) == 0 {
		return existing
	}
	return appendSystemPromptPrefix(existing, adapters.BuildSiblingContextPrompt(siblingAgents))
}

// buildSubAgentResult packages a completed child run for the result aggregator.
// completedAt is injected so the helper stays pure.
func buildSubAgentResult(agentID, agentName, runID, status string, output any, completedAt time.Time) SubAgentResult {
	return SubAgentResult{
		AgentID:     agentID,
		AgentName:   agentName,
		RunID:       runID,
		Status:      status,
		Output:      output,
		CompletedAt: completedAt,
	}
}

// buildSubAgentResultMessage builds the inter-agent result/error message for a
// completed child run. timestamp is injected so the helper stays pure.
func buildSubAgentResultMessage(
	runID, agentID, agentName, parentID, status string,
	sanitizedResult any,
	sanitizeReason string,
	timestamp time.Time,
) agents.Message {
	return agents.Message{
		ID:          subAgentMessageID(runID),
		FromAgentID: agentID,
		ToAgentID:   parentID,
		Type:        subAgentResultMsgType(status),
		TriggerTurn: true, // wake parent orchestrator on sub-agent completion
		Payload: subAgentResultQueuePayload(
			runID, status, agentID, agentName, sanitizedResult, sanitizeReason,
		),
		Timestamp: timestamp,
	}
}

// buildSubAgentRunContext composes the pure sub-agent RunProcessContext from
// task fields, parent workdir memory, and sibling system prompt. Map/IO stays
// in SpawnSubAgent (parent workdir lookup).
func buildSubAgentRunContext(run store.Run, task adapters.SubAgentTask, threadID, parentWorkDir string) RunProcessContext {
	runCtx := newSubAgentRunContext(run, task)
	runCtx = applyParentWorkDirMemory(runCtx, parentWorkDir, threadID, task.AgentID)
	runCtx.AppendSystemPrompt = withSiblingSystemPrompt(runCtx.AppendSystemPrompt, task.SiblingAgents)
	return runCtx
}

// prepareSubAgentResultOutbound sanitizes payload and builds the queue message plus
// aggregator result for sendSubAgentResult. Queue/registry I/O stays in the executor.
func prepareSubAgentResultOutbound(
	payload any,
	runID, agentID, agentName, parentID, status string,
	now time.Time,
) (agents.Message, SubAgentResult) {
	sanitizedResult, sanitizeReason := SanitizeSubAgentResult(payload)
	msg := buildSubAgentResultMessage(
		runID, agentID, agentName, parentID, status, sanitizedResult, sanitizeReason, now,
	)
	agg := buildSubAgentResult(
		agentID,
		agentName,
		runID,
		status,
		aggregatorOutput(payload, sanitizedResult, sanitizeReason),
		now,
	)
	return msg, agg
}
