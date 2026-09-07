package lifecycle

import (
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
)

func TestProcessExecutorCallbackOwnership(t *testing.T) {
	for _, owner := range []string{"edge", "desktop"} {
		t.Run(owner, func(t *testing.T) {
			bus := events.NewBus(100)
			defer bus.Close()
			repository := store.New()
			seed := newExecutorTestRun(t, repository)
			run, err := repository.CreateRunAdmission(uniqueHubTestRunID("owner"), seed.ProjectID, seed.ThreadID, "task-owner", owner)
			if err != nil {
				t.Fatal(err)
			}
			_, eventsCh, _ := bus.Subscribe(0)
			executor := newTestProcessExecutor(t, bus, repository, "success")
			callback := newRecordingHubCallback()
			executor.WithHubCallback(callback)
			if err := executor.Start(run, RunProcessContext{HubTaskID: "task-owner"}); err != nil {
				t.Fatal(err)
			}
			_ = collectEventsUntilRunDone(t, eventsCh)
			if owner == "edge" {
				select {
				case <-callback.doneSeen:
				case <-time.After(5 * time.Second):
					t.Fatal("Edge owner never reported the result")
				}
			}
			callback.mu.Lock()
			defer callback.mu.Unlock()
			if owner == "desktop" && (len(callback.acks)+len(callback.streams)+len(callback.dones)+len(callback.fails) != 0) {
				t.Fatalf("Desktop-owned run also emitted Edge callbacks: %#v", callback)
			}
			if owner == "edge" && (len(callback.dones) != 1 || callback.dones[0].RunID != run.ID) {
				t.Fatalf("wrong result owner: %#v", callback.dones)
			}
		})
	}
}
