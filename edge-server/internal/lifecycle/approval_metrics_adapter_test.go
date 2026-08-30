package lifecycle

import (
	"testing"

	"github.com/agenthub/edge-server/internal/metrics"
)

type stubApprovalRecorder struct {
	decisions []string
}

func (s *stubApprovalRecorder) RecordApprovalDecision(d string) {
	s.decisions = append(s.decisions, d)
}

func TestApproveToolRecordsMetricAndLogs(t *testing.T) {
	dl := NewDecisionLoop(DefaultDecisionLoopConfig())
	stub := &stubApprovalRecorder{}
	dl.SetApprovalMetrics(stub)

	ch := dl.AwaitApproval("tc-1")
	if !dl.ApproveTool("tc-1") {
		t.Fatal("ApproveTool returned false")
	}
	if !<-ch {
		t.Fatal("channel did not receive true")
	}
	if len(stub.decisions) != 1 || stub.decisions[0] != "approve" {
		t.Fatalf("unexpected decisions: %v", stub.decisions)
	}
}

func TestDenyToolRecordsMetricAndLogs(t *testing.T) {
	dl := NewDecisionLoop(DefaultDecisionLoopConfig())
	stub := &stubApprovalRecorder{}
	dl.SetApprovalMetrics(stub)

	ch := dl.AwaitApproval("tc-2")
	if !dl.DenyTool("tc-2") {
		t.Fatal("DenyTool returned false")
	}
	if <-ch {
		t.Fatal("channel should have received false")
	}
	if len(stub.decisions) != 1 || stub.decisions[0] != "deny" {
		t.Fatalf("unexpected decisions: %v", stub.decisions)
	}
}

func TestNewApprovalMetricsRecorderNilSafe(t *testing.T) {
	r := NewApprovalMetricsRecorder(nil)
	if r != nil {
		t.Fatal("expected nil recorder for nil metrics")
	}
	// Non-nil metrics produces a working adapter.
	m := metrics.NewTestEdgeMetrics()
	r = NewApprovalMetricsRecorder(m)
	if r == nil {
		t.Fatal("expected non-nil recorder for valid metrics")
	}
	r.RecordApprovalDecision("approve") // must not panic
}
