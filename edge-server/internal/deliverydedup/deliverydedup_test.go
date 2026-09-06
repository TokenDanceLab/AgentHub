package deliverydedup

import (
	"sync"
	"testing"
	"time"
)

func TestAdmissionCommitsOneReceipt(t *testing.T) {
	d := New(2, time.Minute)
	scope := Scope{HubTaskID: "task-a", ProjectID: "project", ThreadID: "thread"}
	first := d.Begin("delivery", scope)
	if first.State != Claimed || first.Claim == nil {
		t.Fatalf("first admission = %#v", first)
	}
	if got := d.Begin("delivery", scope); got.State != Busy || got.RunID != "" {
		t.Fatalf("uncommitted duplicate = %#v", got)
	}
	if !first.Claim.Commit("run-a") {
		t.Fatal("commit failed")
	}
	first.Claim.Release()
	got := d.Begin("delivery", scope)
	if got.State != Accepted || got.RunID != "run-a" || got.Claim != nil {
		t.Fatalf("committed replay = %#v", got)
	}
	if d.Len() != 1 {
		t.Fatalf("tracked admissions = %d", d.Len())
	}
}

func TestReleasedClaimCannotCommitOrReleaseItsReplacement(t *testing.T) {
	d := New(1, time.Minute)
	first := d.Begin("delivery", Scope{})
	first.Claim.Release()
	retry := d.Begin("delivery", Scope{})
	if retry.State != Claimed || retry.Claim == nil {
		t.Fatalf("retry = %#v", retry)
	}
	if first.Claim.Commit("stale-run") {
		t.Fatal("stale owner committed a replacement claim")
	}
	first.Claim.Release()
	if got := d.Begin("delivery", Scope{}); got.State != Busy {
		t.Fatalf("stale release removed replacement: %#v", got)
	}
	if !retry.Claim.Commit("retry-run") {
		t.Fatal("retry commit failed")
	}
	if got := d.Begin("delivery", Scope{}); got.RunID != "retry-run" {
		t.Fatalf("wrong receipt: %#v", got)
	}
}

func TestInvalidReceiptDoesNotBecomeAccepted(t *testing.T) {
	d := New(1, time.Minute)
	attempt := d.Begin("delivery", Scope{})
	if attempt.Claim.Commit(" ") {
		t.Fatal("empty run id was committed")
	}
	if got := d.Begin("delivery", Scope{}); got.State != Busy {
		t.Fatalf("invalid receipt was accepted: %#v", got)
	}
	attempt.Claim.Release()
	if retry := d.Begin("delivery", Scope{}); retry.State != Claimed {
		t.Fatalf("failed receipt could not retry: %#v", retry)
	} else {
		retry.Claim.Release()
	}
}

func TestAdmissionBindsBusinessIdentity(t *testing.T) {
	cases := []struct {
		name          string
		first, replay Scope
		want          State
	}{
		{"hub channel thread aliases", Scope{HubTaskID: "task", ProjectID: "local", ThreadID: "local-thread"}, Scope{HubTaskID: "task", ProjectID: "local", ThreadID: "conversation-thread"}, Accepted},
		{"other Hub task", Scope{HubTaskID: "task-a"}, Scope{HubTaskID: "task-b"}, Conflict},
		{"Hub identity cannot become legacy", Scope{HubTaskID: "task"}, Scope{}, Conflict},
		{"same legacy scope", Scope{ProjectID: "project", ThreadID: "thread"}, Scope{ProjectID: "project", ThreadID: "thread"}, Accepted},
		{"other legacy thread", Scope{ProjectID: "project", ThreadID: "a"}, Scope{ProjectID: "project", ThreadID: "b"}, Conflict},
		{"other legacy project", Scope{ProjectID: "a", ThreadID: "thread"}, Scope{ProjectID: "b", ThreadID: "thread"}, Conflict},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := New(2, time.Minute)
			first := d.Begin("delivery", tc.first)
			if !first.Claim.Commit("original-run") {
				t.Fatal("commit failed")
			}
			got := d.Begin("delivery", tc.replay)
			if got.State != tc.want {
				t.Fatalf("replay = %#v, want state %v", got, tc.want)
			}
			if tc.want == Accepted && got.RunID != "original-run" {
				t.Fatalf("changed original run: %#v", got)
			}
			if tc.want == Conflict && got.RunID != "" {
				t.Fatalf("conflict exposed another run: %#v", got)
			}
		})
	}
}

func TestConcurrentAdmissionHasOneOwner(t *testing.T) {
	d := New(64, time.Minute)
	start := make(chan struct{})
	results := make(chan Admission, 32)
	var wg sync.WaitGroup
	for range 32 {
		wg.Go(func() { <-start; results <- d.Begin("delivery", Scope{HubTaskID: "task"}) })
	}
	close(start)
	wg.Wait()
	close(results)
	var owner *Claim
	busy := 0
	for result := range results {
		switch result.State {
		case Claimed:
			if owner != nil {
				t.Fatal("two concurrent owners")
			}
			owner = result.Claim
		case Busy:
			busy++
		default:
			t.Fatalf("uncommitted request returned %#v", result)
		}
	}
	if owner == nil || busy != 31 {
		t.Fatalf("owner=%v busy=%d", owner != nil, busy)
	}
	if !owner.Commit("run") {
		t.Fatal("owner commit failed")
	}
	if got := d.Begin("delivery", Scope{HubTaskID: "task"}); got.State != Accepted || got.RunID != "run" {
		t.Fatalf("replay = %#v", got)
	}
}

func TestPendingClaimsAreBoundedAndNotExpiredOrEvicted(t *testing.T) {
	now := time.Unix(1000, 0)
	d := New(2, time.Minute).WithClock(func() time.Time { return now })
	first := d.Begin("pending-a", Scope{})
	second := d.Begin("pending-b", Scope{})
	now = now.Add(10 * time.Minute)
	if got := d.Begin("pending-a", Scope{}); got.State != Busy {
		t.Fatalf("expired a live owner: %#v", got)
	}
	if got := d.Begin("other", Scope{}); got.State != Busy {
		t.Fatalf("evicted a live owner: %#v", got)
	}
	if d.Len() != 2 {
		t.Fatalf("capacity exceeded: %d", d.Len())
	}
	second.Claim.Release()
	other := d.Begin("other", Scope{})
	if other.State != Claimed {
		t.Fatalf("release did not free capacity: %#v", other)
	}
	if !first.Claim.Commit("first-run") || !other.Claim.Commit("other-run") {
		t.Fatal("live owner lost after pressure")
	}
}

func TestAcceptedReceiptsUseLRUEviction(t *testing.T) {
	d := New(2, time.Minute)
	for _, id := range []string{"a", "b"} {
		if !d.Begin(id, Scope{}).Claim.Commit("run-" + id) {
			t.Fatal("commit failed")
		}
	}
	if got := d.Begin("a", Scope{}); got.State != Accepted {
		t.Fatal("a missing")
	}
	if !d.Begin("c", Scope{}).Claim.Commit("run-c") {
		t.Fatal("c commit failed")
	}
	if got := d.Begin("a", Scope{}); got.State != Accepted || got.RunID != "run-a" {
		t.Fatalf("recent receipt evicted: %#v", got)
	}
	if got := d.Begin("b", Scope{}); got.State != Claimed {
		t.Fatalf("oldest receipt was not evicted: %#v", got)
	} else {
		got.Claim.Release()
	}
}

func TestReplayDoesNotRenewReceiptTTL(t *testing.T) {
	now := time.Unix(1000, 0)
	d := New(3, time.Minute).WithClock(func() time.Time { return now })
	if !d.Begin("a", Scope{}).Claim.Commit("run-a") {
		t.Fatal("commit a")
	}
	now = now.Add(30 * time.Second)
	if !d.Begin("b", Scope{}).Claim.Commit("run-b") {
		t.Fatal("commit b")
	}
	if got := d.Begin("a", Scope{}); got.State != Accepted {
		t.Fatal("a expired early")
	}
	now = now.Add(31 * time.Second)
	if got := d.Begin("a", Scope{}); got.State != Claimed {
		t.Fatalf("replay renewed TTL or hid an expired MRU entry: %#v", got)
	} else {
		got.Claim.Release()
	}
	if got := d.Begin("b", Scope{}); got.State != Accepted || got.RunID != "run-b" {
		t.Fatalf("unexpired receipt lost: %#v", got)
	}
}

func TestEmptyDeliveryDoesNotConsumeCapacity(t *testing.T) {
	d := New(1, time.Minute)
	for range 3 {
		got := d.Begin("", Scope{})
		if got.State != Claimed || got.Claim != nil || got.RunID != "" {
			t.Fatalf("legacy admission = %#v", got)
		}
	}
	if d.Len() != 0 {
		t.Fatalf("legacy deliveries were cached: %d", d.Len())
	}
}

func TestNewRejectsInvalidBounds(t *testing.T) {
	for _, tc := range []struct {
		name     string
		capacity int
		ttl      time.Duration
	}{{"zero capacity", 0, time.Minute}, {"negative capacity", -1, time.Minute}, {"zero TTL", 1, 0}, {"negative TTL", 1, -time.Second}} {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if recover() == nil {
					t.Fatal("invalid cache bounds were accepted")
				}
			}()
			New(tc.capacity, tc.ttl)
		})
	}
}
