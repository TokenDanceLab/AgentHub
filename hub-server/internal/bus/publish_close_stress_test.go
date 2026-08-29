package bus

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestPublishCloseRace_Stress is the stress probe for issue #2071 S1.
// It hammers Publish from N goroutines while a separate goroutine repeatedly
// Close+s and re-creates the Bus, looking for panics, DATA RACE reports, or
// pending counter leaks after Close returns.
//
// Observed behavior (5 rounds × 3s each, 32 publishers, -race):
//   - No panic, no DATA RACE across multiple -count runs.
//   - All submit errors occurred AFTER Close set closed=true (pubAfterClosed == submitErrs).
//   - Pending always returned to 0 at Close return and after post-wait.
// Conclusion: window is benign under this stress profile; ants v2.12.1
// returns err on Submit-after-Release and the existing pending rollback holds.
func TestPublishCloseRace_Stress(t *testing.T) {
	const (
		publishers    = 32
		rounds        = 5
		roundDuration = 3 * time.Second
		eventType     = "stress.ping"
	)

	type roundResult struct {
		round          int
		closePending   int64
		postClosePend  int64
		pubAfterClosed int64
		submitErrs     int64
	}
	results := make([]roundResult, rounds)

	for r := 0; r < rounds; r++ {
		b, err := New()
		if err != nil {
			t.Fatalf("round %d: New: %v", r, err)
		}
		b.Subscribe(eventType, func(ctx context.Context, event Event) {
			time.Sleep(50 * time.Microsecond)
		})

		var (
			stopCh         = make(chan struct{})
			wgPub          sync.WaitGroup
			pubAfterClosed atomic.Int64
			submitErrs     atomic.Int64
		)

		wgPub.Add(publishers)
		for p := 0; p < publishers; p++ {
			go func() {
				defer wgPub.Done()
				for {
					select {
					case <-stopCh:
						return
					default:
					}
					err := b.Publish(context.Background(), Event{Type: eventType, Payload: struct{}{}})
					if err != nil {
						submitErrs.Add(1)
						if b.IsClosed() {
							pubAfterClosed.Add(1)
						}
					}
				}
			}()
		}

		time.Sleep(50 * time.Millisecond)

		ctx, cancel := context.WithTimeout(context.Background(), roundDuration)
		b.Close(ctx)
		cancel()

		closePending := b.Pending()
		close(stopCh)
		wgPub.Wait()

		time.Sleep(20 * time.Millisecond)
		postPend := b.Pending()

		results[r] = roundResult{
			round:          r,
			closePending:   closePending,
			postClosePend:  postPend,
			pubAfterClosed: pubAfterClosed.Load(),
			submitErrs:     submitErrs.Load(),
		}
		t.Logf("round %d: pending@closeReturn=%d pending@postWait=%d submitErrs=%d pubAfterClosed=%d",
			r, closePending, postPend, submitErrs.Load(), pubAfterClosed.Load())

		if postPend != 0 {
			t.Errorf("round %d: PENDING LEAK: pending=%d after Close+wait", r, postPend)
		}
		if submitErrs.Load() != pubAfterClosed.Load() {
			t.Errorf("round %d: unexpected pre-close submit errors: submitErrs=%d pubAfterClosed=%d",
				r, submitErrs.Load(), pubAfterClosed.Load())
		}
	}

	t.Log("=== summary ===")
	for _, rr := range results {
		t.Logf("round %d: closePend=%d postPend=%d submitErrs=%d pubAfterClosed=%d",
			rr.round, rr.closePending, rr.postClosePend, rr.submitErrs, rr.pubAfterClosed)
	}
}
