package store

import (
	"fmt"
	"testing"
)

// BenchmarkStoreScopedLists measures actual memory-store facades, not SQL or
// JSON encoding. The sparse scope has ten records; dense has the rest. Missing
// and unfiltered controls expose allocation tradeoffs hidden by sparse-only
// tests. No runtime request rate, RSS or response-retention claim is implied.
func BenchmarkStoreScopedLists(b *testing.B) {
	for _, total := range []int{100, 1000} {
		b.Run(fmt.Sprintf("resident=%d", total), func(b *testing.B) {
			s := scopedListBenchmarkStore(b, total)
			for _, scope := range []struct {
				name, threadID, runID string
				first, count          int
			}{
				{"missing", "missing", "missing", 0, 0},
				{"sparse", "sparse", "run-000000", 0, 10},
				{"dense", "dense", "run-000010", 10, total - 10},
				{"all", "", "", 0, total},
			} {
				b.Run("runs/"+scope.name, func(b *testing.B) {
					id := func(run Run) string { return run.ID }
					got := s.ListRuns(scope.threadID)
					checkScopedListBenchmarkIDs(b, got, scope.first, scope.count, "run", id)
					b.ReportAllocs()
					for b.Loop() {
						got = s.ListRuns(scope.threadID)
						if len(got) != scope.count {
							b.Fatalf("run count = %d, want %d", len(got), scope.count)
						}
					}
					checkScopedListBenchmarkIDs(b, got, scope.first, scope.count, "run", id)
					b.ReportMetric(float64(len(got)), "results/op")
					b.ReportMetric(float64(cap(got)), "result-cap")
				})
				b.Run("artifacts/"+scope.name, func(b *testing.B) {
					id := func(artifact Artifact) string { return artifact.ID }
					got := s.ListArtifacts(scope.runID)
					checkScopedListBenchmarkIDs(b, got, scope.first, scope.count, "artifact", id)
					b.ReportAllocs()
					for b.Loop() {
						got = s.ListArtifacts(scope.runID)
						if len(got) != scope.count {
							b.Fatalf("artifact count = %d, want %d", len(got), scope.count)
						}
					}
					checkScopedListBenchmarkIDs(b, got, scope.first, scope.count, "artifact", id)
					b.ReportMetric(float64(len(got)), "results/op")
					b.ReportMetric(float64(cap(got)), "result-cap")
				})
			}
		})
	}
}

// All content sources are generated metadata; no path is read from disk. The
// Store APIs validate project/thread/run references before the timed workload.
func scopedListBenchmarkStore(b *testing.B, total int) *Store {
	b.Helper()
	s := New()
	if _, err := s.CreateProject("project", "Scoped lists", ""); err != nil {
		b.Fatal(err)
	}
	for _, threadID := range []string{"sparse", "dense"} {
		if _, err := s.CreateThread(threadID, "project", "Scoped lists", "", "", ""); err != nil {
			b.Fatal(err)
		}
	}
	for i := 0; i < total; i++ {
		threadID, artifactRunID := "dense", "run-000010"
		if i < 10 {
			threadID, artifactRunID = "sparse", "run-000000"
		}
		if _, err := s.CreateRun(fmt.Sprintf("run-%06d", i), "project", threadID); err != nil {
			b.Fatal(err)
		}
		name := fmt.Sprintf("output-%06d.txt", i)
		if _, err := s.UpsertArtifact(Artifact{
			ID: fmt.Sprintf("artifact-%06d", i), RunID: artifactRunID, Kind: "file", Path: name,
			ContentSource: &ArtifactContentSource{Kind: ArtifactContentSourceBasename, Path: name, Readable: false},
		}); err != nil {
			b.Fatal(err)
		}
	}
	return s
}

func checkScopedListBenchmarkIDs[T any](b *testing.B, got []T, first, count int, prefix string, id func(T) string) {
	b.Helper()
	if got == nil || len(got) != count {
		b.Fatalf("%s result nil=%v len=%d, want non-nil len=%d", prefix, got == nil, len(got), count)
	}
	for i, row := range got {
		if want := fmt.Sprintf("%s-%06d", prefix, first+i); id(row) != want {
			b.Fatalf("%s result[%d] = %q, want %q", prefix, i, id(row), want)
		}
	}
}
