package store

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// BenchmarkFileStorePersistence separates snapshot copying, JSON encoding and
// filesystem work. The save/flush cases use real temp-file Sync and Rename;
// encode discards bytes without keeping a second snapshot-sized buffer. These
// are explicit flushes of fixed resident state, NOT debounce/request frequency.
func BenchmarkFileStorePersistence(b *testing.B) {
	for _, runs := range []int{10, 100, 1000} {
		b.Run(fmt.Sprintf("runs=%d", runs), func(b *testing.B) {
			s := persistenceBenchmarkStore(b, runs)
			want := s.snapshot()
			var encoded bytes.Buffer
			if err := encodePersistenceBenchmark(&encoded, want); err != nil {
				b.Fatal(err)
			}
			payloadBytes := int64(encoded.Len())

			b.Run("snapshot", func(b *testing.B) {
				var got fileSnapshot
				b.ReportAllocs()
				for b.Loop() {
					got = s.snapshot()
				}
				checkPersistenceBenchmarkSnapshot(b, got, want)
			})
			b.Run("encode", func(b *testing.B) {
				sink := &persistenceBenchmarkSink{}
				b.SetBytes(payloadBytes)
				b.ReportAllocs()
				for b.Loop() {
					sink.bytes = 0
					if err := encodePersistenceBenchmark(sink, want); err != nil {
						b.Fatal(err)
					}
					if sink.bytes != payloadBytes {
						b.Fatalf("encoded bytes = %d, want %d", sink.bytes, payloadBytes)
					}
				}
				b.ReportMetric(float64(payloadBytes), "payload-B/op")
			})
			b.Run("save", func(b *testing.B) {
				path := filepath.Join(b.TempDir(), "store.json")
				if err := saveFileSnapshot(path, want); err != nil {
					b.Fatal(err)
				}
				b.SetBytes(payloadBytes)
				b.ReportAllocs()
				for b.Loop() {
					if err := saveFileSnapshot(path, want); err != nil {
						b.Fatal(err)
					}
				}
				checkPersistenceBenchmarkFile(b, path, want, encoded.Bytes())
				b.ReportMetric(float64(payloadBytes), "payload-B/op")
			})
			b.Run("flush", func(b *testing.B) {
				path := filepath.Join(b.TempDir(), "store.json")
				f, err := NewFile(path)
				if err != nil {
					b.Fatal(err)
				}
				b.Cleanup(f.Close)
				// Fixture construction uses the validated Store APIs; installing
				// its snapshot here avoids timing a backlog of debounce signals.
				f.store.applySnapshot(want)
				f.Flush()
				if err := f.LastPersistError(); err != nil {
					b.Fatal(err)
				}
				b.SetBytes(payloadBytes)
				b.ReportAllocs()
				for b.Loop() {
					f.Flush()
					if err := f.LastPersistError(); err != nil {
						b.Fatal(err)
					}
				}
				checkPersistenceBenchmarkFile(b, path, want, encoded.Bytes())
				b.ReportMetric(float64(payloadBytes), "payload-B/op")
			})
		})
	}
}

// All paths/content below are generated metadata; no user workspace is read.
// Ten queued runs per thread, ten 512-byte items, two artifact metadata records,
// and one checkpoint containing a 256-byte file per run. The remaining entity
// collections are empty. This is a declared resident-size fixture, not telemetry.
func persistenceBenchmarkStore(b *testing.B, runs int) *Store {
	b.Helper()
	s := New()
	if _, err := s.CreateProject("project", "Benchmark", "owner"); err != nil {
		b.Fatal(err)
	}
	content := strings.Repeat("x", 512)
	for i := 0; i < runs; i++ {
		threadID := fmt.Sprintf("thread-%04d", i/10)
		if i%10 == 0 {
			if _, err := s.CreateThread(threadID, "project", "Benchmark", "", "", ""); err != nil {
				b.Fatal(err)
			}
		}
		runID := fmt.Sprintf("run-%06d", i)
		if _, err := s.CreateRun(runID, "project", threadID); err != nil {
			b.Fatal(err)
		}
		for j := 0; j < 10; j++ {
			_, err := s.CreateItem(Item{
				ID: fmt.Sprintf("item-%06d-%02d", i, j), ProjectID: "project",
				ThreadID: threadID, RunID: runID, Type: "message", Role: "assistant",
				Status: "completed", Content: content,
			})
			if err != nil {
				b.Fatal(err)
			}
		}
		for j := 0; j < 2; j++ {
			path := fmt.Sprintf("output/result-%02d.txt", j)
			_, err := s.UpsertArtifact(Artifact{
				ID: fmt.Sprintf("artifact-%06d-%02d", i, j), RunID: runID,
				ThreadID: threadID, Kind: "file", Path: path, SizeBytes: 512,
				ContentSource: &ArtifactContentSource{Kind: "edge_file", Path: path, Readable: true},
			})
			if err != nil {
				b.Fatal(err)
			}
		}
		_, err := s.UpsertRunCheckpoint(RunCheckpoint{
			ID: fmt.Sprintf("checkpoint-%06d", i), RunID: runID, WorkDir: "fixture",
			FileCount: 1, TotalBytes: 256,
			Files: []CheckpointFile{{Path: "src/input.txt", Size: 256, Content: content[:256]}},
		})
		if err != nil {
			b.Fatal(err)
		}
	}
	return s
}

func encodePersistenceBenchmark(w io.Writer, snapshot fileSnapshot) error {
	encoder := json.NewEncoder(w)
	encoder.SetIndent("", "  ") // Match saveFileSnapshot, including the trailing newline.
	return encoder.Encode(snapshot)
}

type persistenceBenchmarkSink struct{ bytes int64 }

func (s *persistenceBenchmarkSink) Write(p []byte) (int, error) {
	s.bytes += int64(len(p))
	return len(p), nil
}

func checkPersistenceBenchmarkFile(b *testing.B, path string, want fileSnapshot, encoded []byte) {
	b.Helper()
	actual, err := os.ReadFile(path)
	if err != nil {
		b.Fatal(err)
	}
	if !bytes.Equal(actual, encoded) {
		b.Fatal("persisted bytes differ from the indented JSON control")
	}
	restored := New()
	if err := loadFileSnapshot(path, restored); err != nil {
		b.Fatal(err)
	}
	checkPersistenceBenchmarkSnapshot(b, restored.snapshot(), want)
}

func checkPersistenceBenchmarkSnapshot(b *testing.B, got, want fileSnapshot) {
	b.Helper()
	g, w := reflect.ValueOf(got), reflect.ValueOf(want)
	for i := 0; i < g.NumField(); i++ {
		if !reflect.DeepEqual(g.Field(i).Interface(), w.Field(i).Interface()) {
			b.Fatalf("restored snapshot differs in %s", g.Type().Field(i).Name)
		}
	}
}
