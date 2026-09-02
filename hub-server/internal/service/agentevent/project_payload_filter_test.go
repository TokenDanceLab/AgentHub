package agentevent

import (
	"fmt"
	"strings"
	"testing"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/stretchr/testify/require"
)

// These tests pin the semantics that the "filter on event type, then decode the
// payload" reordering must not change (#2154 perf lane P2-5):
//
//   - the summary fold stays lenient — an undecodable payload still counts the
//     event, because EventTypeCounts / StepCount are folded before the switch;
//   - the approvals / artifacts projections stay strict — an undecodable
//     payload skips the event entirely;
//   - in both shapes the pre-switch bookkeeping (LastEventSeq, EdgeRunID,
//     SessionID) still runs for every event, including skipped ones.

func payloadFilterTask() *model.PendingAgentTask {
	return &model.PendingAgentTask{ID: "task-1", EdgeRunID: "run-1"}
}

func payloadFilterEvent(seq int64, eventType, payload string) model.AgentRunEvent {
	return model.AgentRunEvent{
		ID:        fmt.Sprintf("evt-%d", seq),
		TaskID:    "task-1",
		SessionID: "sess-1",
		EventSeq:  seq,
		EventType: eventType,
		Payload:   payload,
	}
}

func TestSummarizeAgentRunEventsCountsEventsWithUndecodablePayload(t *testing.T) {
	events := []model.AgentRunEvent{
		payloadFilterEvent(1, "run.agent.tool_call", "{not json"),
		payloadFilterEvent(2, "run.agent.file_change", ""),
		payloadFilterEvent(3, "run.agent.tool_call", `{"tool_name":"bash"}`),
	}

	summary := SummarizeAgentRunEvents(payloadFilterTask(), events)

	require.Equal(t, 3, summary.TotalEvents)
	require.Equal(t, 2, summary.ToolCallCount, "tool_call is counted even when its payload cannot be decoded")
	require.Equal(t, 1, summary.ArtifactCount)
	require.Equal(t, int64(3), summary.LastEventSeq)
	require.Equal(t, 3, summary.StepCount, "every run.agent.* event folds into StepCount")
	require.Equal(t, 2, summary.EventTypeCounts["run.agent.tool_call"])
	require.Equal(t, 1, summary.EventTypeCounts["run.agent.file_change"])
}

func TestSummarizeAgentRunEventsUndecodableOutputBatchContributesNothing(t *testing.T) {
	events := []model.AgentRunEvent{
		payloadFilterEvent(1, model.RunEventTypeOutputBatch, "{oops"),
		payloadFilterEvent(2, model.RunEventTypeOutputBatch, `{"content":"hello"}`),
	}

	summary := SummarizeAgentRunEvents(payloadFilterTask(), events)

	require.Equal(t, len("hello"), summary.OutputBytes, "undecodable payload contributes 0 bytes, decodable one still counts")
	require.Equal(t, 2, summary.EventTypeCounts[model.RunEventTypeOutputBatch])
}

func TestSummarizeAgentRunEventsUndecodableUsageEventIsZeroTokens(t *testing.T) {
	events := []model.AgentRunEvent{
		payloadFilterEvent(1, "run.agent.result", "{oops"),
		payloadFilterEvent(2, "run.agent.context_usage", `{"input_tokens":11,"output_tokens":7}`),
	}

	summary := SummarizeAgentRunEvents(payloadFilterTask(), events)

	require.Equal(t, 11, summary.InputTokens)
	require.Equal(t, 7, summary.OutputTokens)
}

func TestProjectTaskApprovalsSkipsUndecodableEventsButKeepsBookkeeping(t *testing.T) {
	events := []model.AgentRunEvent{
		payloadFilterEvent(1, "run.agent.permission_requested", `{"request_id":"r1","status":"pending","tool_name":"bash"}`),
		payloadFilterEvent(2, "run.agent.permission_requested", "{broken"),
		payloadFilterEvent(3, "run.agent.permission_decided", "{broken"),
		payloadFilterEvent(4, "run.agent.text_delta", `{"text":"streaming"}`),
	}

	list := ProjectTaskApprovals(payloadFilterTask(), events)

	require.Len(t, list.Approvals, 1, "only the decodable permission_requested becomes an approval")
	require.Len(t, list.Pending, 1)
	require.Len(t, list.Decided, 0, "an undecidable permission_decided must not fabricate a decision")
	require.Equal(t, int64(4), list.LastEventSeq, "skipped events still advance LastEventSeq")
	require.Equal(t, "sess-1", list.SessionID)
	require.Equal(t, "run-1", list.EdgeRunID)
}

func TestProjectTaskArtifactsFiltersBeforeDecoding(t *testing.T) {
	events := []model.AgentRunEvent{
		payloadFilterEvent(1, "run.agent.file_change", `{"path":"a.go","action":"modified"}`),
		payloadFilterEvent(2, "run.agent.file_change", "{broken"),
		payloadFilterEvent(3, "artifact.created", `{"path":"b.go","artifact_id":"art-1"}`),
		payloadFilterEvent(4, "artifact.created", "{broken"),
		payloadFilterEvent(5, "run.agent.text_delta", `{"text":"x"}`),
	}

	list := ProjectTaskArtifacts(payloadFilterTask(), events)

	require.Len(t, list.Artifacts, 2)
	require.Equal(t, "a.go", list.Artifacts[0].Path)
	require.Equal(t, "modified", list.Artifacts[0].Action)
	require.Equal(t, "b.go", list.Artifacts[1].Path)
	require.Equal(t, "art-1", list.Artifacts[1].ArtifactID)
	require.Equal(t, int64(5), list.LastEventSeq)
	require.Equal(t, "sess-1", list.SessionID)
}

// textDeltaHeavyEvents builds a realistic task history: mostly text_delta with
// ~500 B payloads plus a handful of projection-bearing events, matching the
// 2,000-row cap in repository.maxAgentEventsPerQuery.
func textDeltaHeavyEvents(n int) []model.AgentRunEvent {
	filler := strings.Repeat("lorem ipsum dolor sit amet ", 18)
	events := make([]model.AgentRunEvent, 0, n)
	for i := 1; i <= n; i++ {
		switch {
		case i%500 == 0:
			events = append(events, payloadFilterEvent(int64(i), "run.agent.permission_requested",
				fmt.Sprintf(`{"request_id":"r%d","status":"pending","tool_name":"bash"}`, i)))
		case i%500 == 250:
			events = append(events, payloadFilterEvent(int64(i), "run.agent.file_change",
				fmt.Sprintf(`{"path":"file-%d.go","action":"modified"}`, i)))
		case i%50 == 0:
			events = append(events, payloadFilterEvent(int64(i), model.RunEventTypeOutputBatch,
				fmt.Sprintf(`{"content":%q}`, filler)))
		default:
			events = append(events, payloadFilterEvent(int64(i), "run.agent.text_delta",
				fmt.Sprintf(`{"text":%q}`, filler)))
		}
	}
	return events
}

var (
	benchSummarySink  model.AgentRunEventSummary
	benchApprovalsLnk *model.AgentTaskApprovalList
	benchArtifactsLnk *model.AgentTaskArtifactList
)

func BenchmarkSummarizeAgentRunEventsTextDeltaHeavy(b *testing.B) {
	events := textDeltaHeavyEvents(2000)
	task := payloadFilterTask()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		benchSummarySink = SummarizeAgentRunEvents(task, events)
	}
}

func BenchmarkProjectTaskApprovalsTextDeltaHeavy(b *testing.B) {
	events := textDeltaHeavyEvents(2000)
	task := payloadFilterTask()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		benchApprovalsLnk = ProjectTaskApprovals(task, events)
	}
}

func BenchmarkProjectTaskArtifactsTextDeltaHeavy(b *testing.B) {
	events := textDeltaHeavyEvents(2000)
	task := payloadFilterTask()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		benchArtifactsLnk = ProjectTaskArtifacts(task, events)
	}
}
