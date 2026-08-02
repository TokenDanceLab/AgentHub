package dispatch

// #1544 — Health evidence projection contract (pure function layer).
// The API projection (ExecutionTargetService Get/List) and the scheduler
// (DispatchService.validateDispatchTarget) share this resolver, so its
// state machine is pinned here directly.

import (
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/model"
)

func boundTarget(deviceID string) *model.ExecutionTarget {
	t := &model.ExecutionTarget{ID: "t-1", TargetType: LocalEdgeTargetType}
	if deviceID != "" {
		t.DeviceID = &deviceID
	}
	return t
}

func evidence(status string, expiresIn time.Duration) *model.ExecutionTargetEvidence {
	now := time.Now()
	ev := &model.ExecutionTargetEvidence{
		TargetID:   "t-1",
		Source:     EvidenceSourceRegistration,
		Status:     status,
		ObservedAt: now.Add(-time.Minute),
		ExpiresAt:  func() *time.Time { e := now.Add(expiresIn); return &e }(),
		RouteKey:   "u-1:desktop:d-1",
	}
	return ev
}

func TestResolveExecutionTargetHealthStateNoEvidence(t *testing.T) {
	now := time.Now()
	if got := ResolveExecutionTargetHealthState(boundTarget("d-1"), nil, now); got != "registered" {
		t.Errorf("bound target without evidence = %q, want registered", got)
	}
	if got := ResolveExecutionTargetHealthState(boundTarget(""), nil, now); got != "unknown" {
		t.Errorf("unbound target without evidence = %q, want unknown", got)
	}
	if got := ResolveExecutionTargetHealthState(nil, nil, now); got != "offline" {
		t.Errorf("nil target = %q, want offline", got)
	}
}

func TestResolveExecutionTargetHealthStateFreshOnline(t *testing.T) {
	got := ResolveExecutionTargetHealthState(boundTarget("d-1"), evidence(EvidenceStatusOnline, DesktopTargetStaleAfter), time.Now())
	if got != "online" {
		t.Errorf("fresh online evidence = %q, want online", got)
	}
	if !ResolveIsOnline(got) || !IsDispatchableTargetHealth(got) {
		t.Errorf("fresh online must be dispatchable, got is_online=%v dispatchable=%v", ResolveIsOnline(got), IsDispatchableTargetHealth(got))
	}
}

func TestResolveExecutionTargetHealthStateExpiry(t *testing.T) {
	// 窗口过期 → stale（fresh online 证据在 2 分钟后不再是 online）。
	got := ResolveExecutionTargetHealthState(boundTarget("d-1"), evidence(EvidenceStatusOnline, -time.Minute), time.Now())
	if got != "stale" {
		t.Errorf("expired online evidence = %q, want stale", got)
	}
	if ResolveIsOnline(got) || IsDispatchableTargetHealth(got) {
		t.Errorf("stale must not be dispatchable")
	}
}

func TestResolveExecutionTargetHealthStateMismatchWins(t *testing.T) {
	// mismatch 优先于过期判定：identity 矛盾比时间窗口更严重。
	ev := evidence(EvidenceStatusMismatch, -time.Hour)
	got := ResolveExecutionTargetHealthState(boundTarget("d-1"), ev, time.Now())
	if got != "mismatch" {
		t.Errorf("mismatch evidence (even expired) = %q, want mismatch", got)
	}
	if IsDispatchableTargetHealth(got) {
		t.Errorf("mismatch must not be dispatchable")
	}
}

func TestResolveExecutionTargetHealthStateOfflinePassThrough(t *testing.T) {
	got := ResolveExecutionTargetHealthState(boundTarget("d-1"), evidence(EvidenceStatusOffline, DesktopTargetStaleAfter), time.Now())
	if got != "offline" {
		t.Errorf("offline evidence = %q, want offline", got)
	}
}
