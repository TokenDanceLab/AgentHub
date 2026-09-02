package events

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// silenceSlog keeps the persist-failure ERROR lines off stderr: they interleave
// with the benchmark result line and clobber the numbers in -bench output.
func silenceSlog(b *testing.B) {
	b.Helper()
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() { slog.SetDefault(prev) })
}

// These benchmarks are the evidence behind the Publish ordering decision
// (#2154 lane B). Wire order has to equal seq order (see bus_wireorder_test.go),
// and there were two ways to get it; these numbers are why the gate won.
//
// Run with:
//
//	cd edge-server && go test ./internal/events/ -run '^$' \
//	  -bench 'BenchmarkPublishConcurrent|BenchmarkPersistRetryLadder|BenchmarkTruncatingAppend' \
//	  -benchtime 20000x -count=3
//
// Kunpeng ARM64 4C8G, go1.26.5, GOMAXPROCS=4, -benchtime 20000x, median of 3.
// ns/op is wall time per published event, so lower is better.
//
//	                          baseline   A: persist   K: gate
//	                          (racy)     inside b.mu  (shipped)
//	NoLog/w1                     1372        1388       1397
//	NoLog/w4                      553         492       2437
//	NoLog/w8                      709         452       3512
//	WithLog/w1                   7880        8036       8145
//	WithLog/w4                   8962        9156      10417
//	WithLog/w8                   9230        9256      11087
//
// Variant A (seq stamp + persistFn + fanout in one b.mu critical section) is the
// cheap one on the happy path — it is even faster than baseline without a log,
// because the contended atomic.AddInt64 on a shared cache line disappears into a
// mutex Publish takes anyway. It was rejected for what it puts INSIDE the lock;
// see BenchmarkTruncatingAppend and BenchmarkPersistRetryLadder below. At the
// 50 MiB default maxSize a single truncating Append is ~835ms, and it happens
// once per ~25k events: under A that is a bus-wide freeze of Subscribe,
// Unsubscribe, AddObserver and HistoryLen (a Prometheus scrape), plus 256-slot
// subscriber channel overflow turning into a gap storm.
//
// Variant K (shipped) keeps persistFn off b.mu and orders delivery with a
// wireNext/wireCond gate instead, so a slow persist has exactly the blast radius
// it has today (publishers serialise on EventLog.mu) while delivery stops being
// racy. Its cost is head-of-line blocking at the gate, which shows up as the
// NoLog/w4 and NoLog/w8 regressions above — cond park/unpark per event once
// publishers contend. In absolute terms that is still ~410k and ~285k events/s,
// orders of magnitude above edge load, and the production shape (event log
// configured, where the ~8µs append already dominates and already serialises)
// costs 16-20%. A lone publisher — one active run, the common case — is
// unchanged at +2-3%.
//
// A possible follow-up, deliberately not taken here: when no persister is
// configured there is nothing between the seq stamp and the fanout, so the gate
// is unnecessary and the seq could be stamped inside the delivery critical
// section exactly like hub's fanout.go, recovering the NoLog numbers. That adds
// a second ordering path to the hottest function in the event bus for a win in a
// range that is already far beyond any real load.
//
// The two degraded-path benchmarks below are the reason variant A was rejected;
// they are the only reproducible record of what A would have held inside b.mu.
// Under K neither runs under b.mu.

func benchEventLogPath(b *testing.B) string {
	b.Helper()
	dir, err := os.MkdirTemp("", "events-bench")
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { _ = os.RemoveAll(dir) })
	return filepath.Join(dir, "bench.jsonl")
}

// benchPublishConcurrent runs b.N publishes spread over writers goroutines and
// reports wall time per event, so the numbers are directly comparable across
// writer counts.
func benchPublishConcurrent(b *testing.B, bus *Bus, writers int) {
	b.Helper()
	per := b.N / writers
	if per < 1 {
		per = 1
	}
	var wg sync.WaitGroup
	start := make(chan struct{})
	for w := 0; w < writers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			<-start
			for i := 0; i < per; i++ {
				bus.Publish("bench.event", nil, i)
			}
		}(w)
	}
	b.ResetTimer()
	close(start)
	wg.Wait()
	b.StopTimer()
	b.ReportMetric(float64(writers*per), "events")
}

func BenchmarkPublishConcurrentNoLog(b *testing.B) {
	for _, writers := range []int{1, 4, 8} {
		b.Run(fmt.Sprintf("w%d", writers), func(b *testing.B) {
			bus := NewBus(1 << 20)
			b.Cleanup(func() { _ = bus.Close() })
			benchPublishConcurrent(b, bus, writers)
		})
	}
}

func BenchmarkPublishConcurrentWithLog(b *testing.B) {
	for _, writers := range []int{1, 4, 8} {
		b.Run(fmt.Sprintf("w%d", writers), func(b *testing.B) {
			bus := NewBus(1<<20, WithEventLogPath(benchEventLogPath(b)))
			b.Cleanup(func() { _ = bus.Close() })
			benchPublishConcurrent(b, bus, writers)
		})
	}
}

// BenchmarkPersistRetryLadder measures a Publish whose persister fails every
// attempt, i.e. the full persistWithRetry backoff ladder (2+4+8ms). Under
// variant A this whole ladder ran inside b.mu.
//
// Reference (same box): 14.50ms per publish at w1. At w4 the ladder cost
// 14.62ms total when it ran outside b.mu (the four overlapped) and 58.03ms total
// when A serialised it (14.51ms each). Under the shipped gate it is off b.mu
// again, so Subscribe/Unsubscribe/HistoryLen stay responsive; what a failing
// publish does cost is head-of-line blocking of the events behind it at the
// gate, which is bounded by the same 14.5ms. Re-measured under the shipped gate:
// w4 finishes four failing ladders in ~15.7ms total, i.e. overlapping again,
// versus ~58ms serialised under A. Note that no event reaches a subscriber in
// any variant, because persist-before-broadcast drops them all.
func BenchmarkPersistRetryLadder(b *testing.B) {
	for _, writers := range []int{1, 4} {
		b.Run(fmt.Sprintf("w%d", writers), func(b *testing.B) {
			silenceSlog(b)
			bus := NewBus(16)
			bus.persistFn = func(EventEnvelope) error { return os.ErrPermission }
			b.Cleanup(func() { _ = bus.Close() })
			benchPublishConcurrent(b, bus, writers)
		})
	}
}

// BenchmarkTruncatingAppend measures the EventLog truncation path: rewrite the
// kept window, then a full index rebuild with a json.Unmarshal per line. Publish
// reaches it through persistFn. This is the measurement that killed variant A.
//
// Cost is linear in maxSize at ~16.7ms per MiB, measured directly at five sizes
// on the box above:
//
//	maxSize   kept    surviving seqs   one truncating Append
//	 1 MiB    0.75 MiB      1463              17.2ms
//	 2 MiB    1.5  MiB      2923              34.4ms
//	 4 MiB    3.0  MiB      5847              65.4ms
//	 8 MiB    6.0  MiB     11673             130.5ms
//	16 MiB   12.0  MiB     23309             267.1ms
//
// Extrapolated to the 50 MiB default that is ~835ms, once per maxSize/4 = 12.5
// MiB written, i.e. roughly every 25k events at ~500 B each. Inside b.mu that
// would freeze the whole bus; it is why the gate keeps persistFn outside.
//
// Sized at 8 MiB here rather than 50 MiB to keep the benchmark cheap; this
// benchmark reproduces the 8 MiB row at ~130-170ms depending on machine load.
func BenchmarkTruncatingAppend(b *testing.B) {
	const (
		logMaxSize = 8 * 1024 * 1024
		payloadLen = 400
	)
	path := benchEventLogPath(b)
	log, err := NewEventLog(path)
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { _ = log.Close() })
	log.SetMaxSize(logMaxSize)

	payload := make([]byte, payloadLen)
	for i := range payload {
		payload[i] = 'x'
	}
	appendSeq := int64(0)
	appendOne := func() {
		appendSeq++
		evt := EventEnvelope{Version: "v1", ID: fmt.Sprintf("evt_%d", appendSeq), Seq: appendSeq, Type: "run.output.batch", SentAt: "2026-09-02T00:00:00Z", Payload: string(payload)}
		if err := log.Append(evt); err != nil {
			b.Fatal(err)
		}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// Untimed re-arm: refill to just under maxSize so the timed Append
		// crosses the threshold and truncateLocked rewrites a realistic
		// keepBytes = maxSize*3/4 window (~6 MiB) plus a full index rebuild.
		// Dropping maxSize to 1 byte instead would keep 0 bytes, wipe the log
		// and measure an empty-file rebuild (~0.4ms) rather than the real cost.
		b.StopTimer()
		log.SetMaxSize(logMaxSize)
		for {
			fi, err := os.Stat(path)
			if err != nil {
				b.Fatal(err)
			}
			if fi.Size() >= logMaxSize-int64(payloadLen) {
				break
			}
			appendOne()
		}
		log.SetMaxSize(logMaxSize - 1)
		b.StartTimer()

		appendOne() // crosses maxSize → truncation
	}
	b.StopTimer()
	if got := log.EventLogTruncations(); got < int64(b.N) {
		b.Fatalf("expected >= %d truncations, got %d (failures=%d)", b.N, got, log.EventLogTruncateFailures())
	}
	b.ReportMetric(float64(log.EventLogTruncations()), "truncations")
}
