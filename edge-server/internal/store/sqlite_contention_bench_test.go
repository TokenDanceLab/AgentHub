package store

import (
	"fmt"
	"math"
	"math/bits"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// BenchmarkSQLiteFacadeContention uses the real in-memory GetRun/ListRuns
// facade while one writer durably changes a fixed run. It does NOT add SQL
// readers or change the pool/PRAGMAs. Readers repeatedly inspect one active
// thread; resident runs in other threads remain in the fixture. Unthrottled
// reader loops are contention controls, not production request-rate estimates.
// Run with -run '^$' -bench '^BenchmarkSQLiteFacadeContention$' -benchmem -cpu=4.
func BenchmarkSQLiteFacadeContention(b *testing.B) {
	for _, runs := range []int{10, 100, 1000} {
		for _, readers := range []int{0, 1, 4} {
			b.Run(fmt.Sprintf("runs=%d/readers=%d", runs, readers), func(b *testing.B) {
				path := filepath.Join(b.TempDir(), "store.db")
				s, err := NewSQLite(path)
				if err != nil {
					b.Fatal(err)
				}
				b.Cleanup(s.Close)
				s.store.applySnapshot(persistenceBenchmarkStore(b, runs).snapshot())
				s.Flush()
				if err := s.LastPersistError(); err != nil {
					b.Fatal(err)
				}
				var changesBefore int64
				if err := s.db.QueryRow("SELECT total_changes()").Scan(&changesBefore); err != nil {
					b.Fatal(err)
				}
				before := s.db.Stats()
				if before.MaxOpenConnections != 1 {
					b.Fatal("benchmark must retain the constructor's single-connection pool")
				}

				start, stop := make(chan struct{}), make(chan struct{})
				var ready, finished sync.WaitGroup
				var stopOnce sync.Once
				stopReaders := func() {
					stopOnce.Do(func() { close(stop) })
					finished.Wait()
				}
				defer stopReaders()
				readStats := make([]persistenceBenchmarkLatency, readers)
				readErrors := make([]int, readers)
				for i := 0; i < readers; i++ {
					ready.Add(1)
					finished.Add(1)
					go func() {
						defer finished.Done()
						ready.Done()
						<-start
						for {
							select {
							case <-stop:
								return
							default:
							}
							began := time.Now()
							run, ok := s.GetRun("run-000000")
							list := s.ListRuns("thread-0000")
							readStats[i].add(time.Since(began))
							if !ok || run.ID != "run-000000" || run.ThreadID != "thread-0000" || len(list) != 10 {
								readErrors[i]++
								return
							}
						}
					}()
				}
				ready.Wait()
				var writeStats persistenceBenchmarkLatency
				var readWindow time.Time
				writes := 0
				b.ReportAllocs() // Process-wide: includes the readers, not just the writer.
				for b.Loop() {
					if writes == 0 {
						readWindow = time.Now()
						close(start)
					}
					began := time.Now()
					// An increasing value forces a durable delta without growing
					// the entity set; it is not a retry policy/frequency simulation.
					run, ok := s.SetRunRetryCount("run-000000", writes+1)
					writeStats.add(time.Since(began))
					if !ok || run.RetryCount != writes+1 {
						b.Fatalf("write failed: ok=%v error=%v", ok, s.LastPersistError())
					}
					writes++
				}
				stopReaders()
				readSeconds := time.Since(readWindow).Seconds()
				after := s.db.Stats()
				var changesAfter int64
				if err := s.db.QueryRow("SELECT total_changes()").Scan(&changesAfter); err != nil {
					b.Fatal(err)
				}
				b.ReportMetric(float64(changesAfter-changesBefore)/float64(writes), "sql-row-changes/op")
				var reads persistenceBenchmarkLatency
				for i := range readStats {
					if readErrors[i] != 0 {
						b.Fatalf("reader %d returned invalid data", i)
					}
					reads.merge(readStats[i])
				}
				if err := s.LastPersistError(); err != nil {
					b.Fatal(err)
				}
				b.ReportMetric(float64(writes)/b.Elapsed().Seconds(), "writes/s")
				b.ReportMetric(float64(after.WaitCount-before.WaitCount)/float64(writes), "db-waits/op")
				b.ReportMetric(float64(after.WaitDuration-before.WaitDuration)/float64(writes), "db-wait-ns/op")
				b.ReportMetric(float64(after.OpenConnections), "db-open-conns")
				writeStats.report(b, "write")
				if readers > 0 {
					b.ReportMetric(float64(reads.count)/readSeconds, "read-cycles/s")
					reads.report(b, "read-cycle")
				}

				// Read back before Close can mask a missing write with its extra
				// flush. Compare all fields/content/order through the actual load
				// path and independently check the final monotonic mutation.
				want := s.store.snapshot()
				if want.Runs["run-000000"].RetryCount != writes {
					b.Fatal("final write is missing from memory")
				}
				restored, err := NewSQLite(path)
				if err != nil {
					b.Fatal(err)
				}
				b.Cleanup(restored.Close)
				checkPersistenceBenchmarkSnapshot(b, restored.store.snapshot(), want)
			})
		}
	}
}

// Each goroutine owns its histogram until it has stopped. Power-of-two
// nanosecond buckets bound memory independent of operation count; metrics are
// clock-observed percentile UPPER BOUNDS (not exact latencies). Zero clock
// readings are counted separately and reported as zero, never as a 1 ns result.
// One read cycle = GetRun+ListRuns.
// Sampling clocks/bucket updates add overhead; these are instrumented workload
// measurements, not a replacement for an uninstrumented microbenchmark.
type persistenceBenchmarkLatency struct {
	buckets [64]uint64
	count   uint64
	zero    uint64
}

func (h *persistenceBenchmarkLatency) add(d time.Duration) {
	h.count++
	if d <= 0 {
		h.zero++
		return
	}
	h.buckets[bits.Len64(uint64(d)-1)]++
}

func (h *persistenceBenchmarkLatency) merge(other persistenceBenchmarkLatency) {
	for i, count := range other.buckets {
		h.buckets[i] += count
	}
	h.count += other.count
	h.zero += other.zero
}

func (h *persistenceBenchmarkLatency) report(b *testing.B, label string) {
	b.Helper()
	b.ReportMetric(float64(h.count), label+"-samples")
	b.ReportMetric(float64(h.zero), label+"-clock-zero")
	for _, percentile := range []uint64{50, 95, 99} {
		rank := (h.count*percentile + 99) / 100
		unit := fmt.Sprintf("%s-p%d-observed-upper-ns", label, percentile)
		if rank <= h.zero && h.count > 0 {
			b.ReportMetric(0, unit)
			continue
		}
		count := h.zero
		for i, n := range h.buckets {
			count += n
			if count >= rank && h.count > 0 {
				b.ReportMetric(math.Ldexp(1, i), unit)
				break
			}
		}
	}
}
