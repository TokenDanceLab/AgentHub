package agentteam

import (
	"fmt"
	"strings"
	"testing"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/stretchr/testify/require"
)

// Pins the semantics of the "filter on event type, then decode" reordering in
// projectTeamRuntimeSummaries, and the fact that projectTeamBudget still
// decodes every event (it reads token usage from all of them) — #2154 P2-5.

func teamPayloadRefs() map[string]teamRuntimeTaskRef {
	return map[string]teamRuntimeTaskRef{
		"t1": {TeamTaskID: "tt1", AssignmentID: "as1", MemberID: "m1"},
	}
}

func teamEvent(taskID string, seq int64, eventType, payload string) model.AgentRunEvent {
	return model.AgentRunEvent{
		ID:        fmt.Sprintf("evt-%s-%d", taskID, seq),
		TaskID:    taskID,
		EventSeq:  seq,
		EventType: eventType,
		Payload:   payload,
	}
}

func TestProjectTeamRuntimeSummariesFiltersBeforeDecoding(t *testing.T) {
	events := []model.AgentRunEvent{
		teamEvent("t1", 1, "run.agent.permission_requested", `{"request_id":"r1","tool_name":"bash"}`),
		teamEvent("t1", 2, "run.agent.permission_requested", "{broken"),
		teamEvent("t1", 3, "run.agent.permission_decided", `{"request_id":"r1","decision":"approved","reason":"ok"}`),
		teamEvent("t1", 4, "run.agent.permission_decided", "{broken"),
		teamEvent("t1", 5, "run.agent.file_change", `{"path":"a.go","action":"modified"}`),
		teamEvent("t1", 6, "run.agent.file_change", "{broken"),
		teamEvent("t1", 7, "run.agent.text_delta", `{"text":"streaming"}`),
	}

	approvals, artifacts := projectTeamRuntimeSummaries(events, teamPayloadRefs())

	require.Len(t, approvals, 1, "only the decodable request survives; the decodable decision folds into it")
	require.Equal(t, "approved", approvals[0].Status)
	require.Equal(t, "ok", approvals[0].Reason)
	require.Equal(t, "tt1", approvals[0].TeamTaskID)
	require.Len(t, artifacts, 1, "undecodable file_change is skipped, not turned into an empty artifact")
	require.Equal(t, "a.go", artifacts[0].Path)
	require.Equal(t, "as1", artifacts[0].AssignmentID)
}

func TestProjectTeamRuntimeSummariesIgnoresUnrelatedEventTypes(t *testing.T) {
	events := []model.AgentRunEvent{
		teamEvent("t1", 1, "run.agent.text_delta", `{"text":"a"}`),
		teamEvent("t1", 2, model.RunEventTypeOutputBatch, `{"content":"b"}`),
		teamEvent("t1", 3, "run.agent.result", `{"input_tokens":5}`),
	}

	approvals, artifacts := projectTeamRuntimeSummaries(events, teamPayloadRefs())

	require.Empty(t, approvals)
	require.Empty(t, artifacts)
}

func TestProjectTeamBudgetStillDecodesEveryEvent(t *testing.T) {
	events := []model.AgentRunEvent{
		teamEvent("t1", 1, "run.agent.context_warning", `{"tokens_used":100,"token_limit":1000}`),
		teamEvent("t1", 2, "run.agent.context_compaction", `{"tokens_used":200}`),
		teamEvent("t1", 3, "run.agent.text_delta", `{"tokens_used":7}`),
		teamEvent("t1", 4, "run.agent.text_delta", "{broken"),
	}

	budget := projectTeamBudget(events, 2)

	require.NotNil(t, budget)
	require.Equal(t, 2, budget.RunCount)
	require.Equal(t, 1, budget.ContextWarnings)
	require.Equal(t, 1, budget.Compactions)
	require.Equal(t, int64(1000), budget.TokenLimit)
	require.Equal(t, int64(200), budget.TotalTokensUsed, "max observed tokens_used per task wins")
}

func TestProjectTeamBudgetNilWhenNothingToReport(t *testing.T) {
	require.Nil(t, projectTeamBudget(nil, 0))
}

var (
	benchTeamApprovalsSink []model.TeamApprovalState
	benchTeamArtifactsSink []model.TeamArtifactState
	benchTeamBudgetSink    *model.TeamBudget
)

// teamRunHeavyEvents mirrors a team-run batch: capped at 50,000 rows in
// repository.maxAgentRunEventsPerBatch, dominated by text_delta/output_batch.
func teamRunHeavyEvents(n int) []model.AgentRunEvent {
	filler := strings.Repeat("lorem ipsum dolor sit amet ", 18)
	events := make([]model.AgentRunEvent, 0, n)
	for i := 1; i <= n; i++ {
		switch {
		case i%1000 == 0:
			events = append(events, teamEvent("t1", int64(i), "run.agent.permission_requested",
				fmt.Sprintf(`{"request_id":"r%d","tool_name":"bash"}`, i)))
		case i%1000 == 500:
			events = append(events, teamEvent("t1", int64(i), "run.agent.file_change",
				fmt.Sprintf(`{"path":"file-%d.go"}`, i)))
		case i%25 == 0:
			events = append(events, teamEvent("t1", int64(i), "run.agent.context_usage",
				fmt.Sprintf(`{"tokens_used":%d,"token_limit":200000}`, i)))
		default:
			events = append(events, teamEvent("t1", int64(i), "run.agent.text_delta",
				fmt.Sprintf(`{"text":%q}`, filler)))
		}
	}
	return events
}

func BenchmarkProjectTeamRuntimeSummariesHeavy(b *testing.B) {
	events := teamRunHeavyEvents(20000)
	refs := teamPayloadRefs()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		benchTeamApprovalsSink, benchTeamArtifactsSink = projectTeamRuntimeSummaries(events, refs)
	}
}

func BenchmarkProjectTeamBudgetHeavy(b *testing.B) {
	events := teamRunHeavyEvents(20000)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		benchTeamBudgetSink = projectTeamBudget(events, 4)
	}
}
