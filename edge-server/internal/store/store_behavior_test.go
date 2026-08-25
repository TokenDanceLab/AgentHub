package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// ── syncPersist behavioral tests ─────────────────────────────────────────

// TestFileStoreSyncPersistWritesValidJSON verifies that after a write
// and explicit Flush (which calls syncPersist internally), the file on
// disk contains valid JSON matching the in-memory state.
func TestFileStoreSyncPersistWritesValidJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "store.json")

	s, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile returned error: %v", err)
	}
	defer s.Close()

	project, err := s.CreateProject("proj_persist", "Persist Project", "owner-1")
	if err != nil {
		t.Fatalf("CreateProject returned error: %v", err)
	}
	thread, err := s.CreateThread("thread_persist", project.ID, "Persist Thread", "chat", "#ff0000", "PT")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	run, err := s.CreateRun("run_persist", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	if _, ok := s.SetRunStatus(run.ID, "started"); !ok {
		t.Fatal("SetRunStatus returned ok=false")
	}
	if _, err := s.CreateThreadMessage("item_persist", thread.ID, "assistant", "persisted content"); err != nil {
		t.Fatalf("CreateThreadMessage returned error: %v", err)
	}
	if _, err := s.PinThreadItem(thread.ID, "item_persist", "Delicious233"); err != nil {
		t.Fatalf("PinThreadItem returned error: %v", err)
	}

	// Trigger syncPersist via Flush.
	s.Flush()

	// Read the file directly and verify JSON structure.
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile returned error: %v", err)
	}
	if len(raw) == 0 {
		t.Fatal("snapshot file is empty")
	}

	var snapshot fileSnapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		t.Fatalf("Unmarshal snapshot returned error: %v", err)
	}

	// Verify project.
	if got, ok := snapshot.Projects[project.ID]; !ok || got.Name != "Persist Project" || got.OwnerID != "owner-1" {
		t.Fatalf("snapshot project = %#v, want persisted project with owner", got)
	}
	if len(snapshot.ProjectOrder) != 1 || snapshot.ProjectOrder[0] != project.ID {
		t.Fatalf("snapshot projectOrder = %#v, want [proj_persist]", snapshot.ProjectOrder)
	}

	// Verify thread.
	if got, ok := snapshot.Threads[thread.ID]; !ok || got.Kind != "chat" || got.AvatarColor != "#ff0000" || got.AvatarLabel != "PT" {
		t.Fatalf("snapshot thread = %#v, want persisted thread with kind/avatar", got)
	}

	// Verify run status.
	if got, ok := snapshot.Runs[run.ID]; !ok || got.Status != "started" || got.StartedAt == "" {
		t.Fatalf("snapshot run = %#v, want started run with StartedAt", got)
	}

	// Verify item.
	if got, ok := snapshot.Items["item_persist"]; !ok || got.Content != "persisted content" || got.Role != "assistant" {
		t.Fatalf("snapshot item = %#v, want persisted message", got)
	}

	// Verify pin.
	pinKey := threadPinKey(thread.ID, "item_persist")
	if got, ok := snapshot.Pins[pinKey]; !ok || got.PinnedBy != "Delicious233" {
		t.Fatalf("snapshot pin = %#v, want persisted pin", got)
	}

	// Verify order preserved.
	if len(snapshot.ThreadOrder) != 1 || snapshot.ThreadOrder[0] != thread.ID {
		t.Fatalf("snapshot threadOrder = %#v, want [thread_persist]", snapshot.ThreadOrder)
	}
	if len(snapshot.RunOrder) != 1 || snapshot.RunOrder[0] != run.ID {
		t.Fatalf("snapshot runOrder = %#v, want [run_persist]", snapshot.RunOrder)
	}
	if len(snapshot.ItemOrder) != 1 || snapshot.ItemOrder[0] != "item_persist" {
		t.Fatalf("snapshot itemOrder = %#v, want [item_persist]", snapshot.ItemOrder)
	}
}

// TestFileStoreSyncPersistRoundTrip verifies that data written, flushed,
// and then re-read from a new FileStore matches exactly.
func TestFileStoreSyncPersistRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "store.json")

	// Write phase.
	write, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile returned error: %v", err)
	}

	project, _ := write.CreateProject("proj_roundtrip", "Roundtrip", "")
	thread, _ := write.CreateThread("thread_roundtrip", project.ID, "Roundtrip Thread", "", "", "")
	run, _ := write.CreateRun("run_roundtrip", project.ID, thread.ID)
	write.SetRunStatus(run.ID, "finished")

	// Evidence data.
	write.UpsertRunDiffFile(RunDiffFile{
		RunID:  run.ID,
		Path:   "src/main.go",
		Diff:   "@@ -1 +1 @@\n-old\n+new",
		Status: "modified",
	})
	write.UpsertArtifact(Artifact{
		ID:        "artifact_roundtrip",
		RunID:     run.ID,
		ThreadID:  thread.ID,
		Kind:      "markdown",
		Path:      "report.md",
		SizeBytes: 256,
	})
	write.UpsertPreview(Preview{
		ID:       "preview_roundtrip",
		RunID:    run.ID,
		ThreadID: thread.ID,
		URL:      "http://127.0.0.1:4173/roundtrip",
		Status:   "ready",
	})

	// User and agent profiles.
	write.CreateUserProfile(UserProfile{ID: "user_roundtrip", DisplayName: "Roundtrip User"})
	write.CreateAgentProfile(AgentProfile{
		ID:        "agent_roundtrip",
		Name:      "Roundtrip Agent",
		AdapterID: "anthropic",
		Model:     "claude-sonnet-4-20250514",
		Provider:  "anthropic",
	})

	write.Flush()
	write.Close()

	// Read-back phase.
	read, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile restore returned error: %v", err)
	}
	defer read.Close()

	// Verify project.
	gotProj, ok := read.GetProject(project.ID)
	if !ok || gotProj.Name != project.Name || gotProj.OwnerID != project.OwnerID {
		t.Fatalf("restored project = %#v, want %#v match", gotProj, project)
	}

	// Verify thread.
	gotThread, ok := read.GetThread(thread.ID)
	if !ok || gotThread.ProjectID != thread.ProjectID || gotThread.Title != thread.Title {
		t.Fatalf("restored thread = %#v, want %#v match", gotThread, thread)
	}

	// Verify run.
	gotRun, ok := read.GetRun(run.ID)
	if !ok || gotRun.Status != "finished" || gotRun.FinishedAt == "" {
		t.Fatalf("restored run = %#v, want finished with FinishedAt", gotRun)
	}

	// Verify evidence.
	diffs := read.ListRunDiffFiles(run.ID)
	if len(diffs) != 1 || diffs[0].Path != "src/main.go" || diffs[0].Diff != "@@ -1 +1 @@\n-old\n+new" {
		t.Fatalf("restored diffs = %#v, want src/main.go diff", diffs)
	}
	artifacts := read.ListArtifacts(run.ID)
	if len(artifacts) != 1 || artifacts[0].ID != "artifact_roundtrip" || artifacts[0].SizeBytes != 256 {
		t.Fatalf("restored artifacts = %#v, want artifact_roundtrip", artifacts)
	}
	previews := read.ListPreviews(run.ID)
	if len(previews) != 1 || previews[0].ID != "preview_roundtrip" || previews[0].URL != "http://127.0.0.1:4173/roundtrip" {
		t.Fatalf("restored previews = %#v, want preview_roundtrip", previews)
	}

	// Verify user profile.
	gotUser, ok := read.GetUserProfile("user_roundtrip")
	if !ok || gotUser.DisplayName != "Roundtrip User" {
		t.Fatalf("restored user profile = %#v, want Roundtrip User", gotUser)
	}

	// Verify agent profile.
	gotAgent, ok := read.GetAgentProfile("agent_roundtrip")
	if !ok || gotAgent.Name != "Roundtrip Agent" || gotAgent.Model != "claude-sonnet-4-20250514" || gotAgent.Provider != "anthropic" {
		t.Fatalf("restored agent profile = %#v, want Roundtrip Agent", gotAgent)
	}
}

// TestFileStoreSyncPersistOverwriteBehavior verifies that the snapshot
// file is atomically replaced (not appended) across multiple flush cycles.
func TestFileStoreSyncPersistOverwriteBehavior(t *testing.T) {
	path := filepath.Join(t.TempDir(), "store.json")

	s, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile returned error: %v", err)
	}
	defer s.Close()

	// Phase 1: write one project, flush.
	s.CreateProject("proj_first", "First", "")
	s.Flush()
	raw1, _ := os.ReadFile(path)
	var snap1 fileSnapshot
	json.Unmarshal(raw1, &snap1)
	if len(snap1.Projects) != 1 || snap1.Projects["proj_first"].Name != "First" {
		t.Fatalf("phase 1 snapshot projects = %#v, want proj_first", snap1.Projects)
	}

	// Phase 2: remove it, write another, flush.
	s.DeleteThread("proj_first") // won't do anything since it's a project, not a thread
	// Actually delete by creating a new store and checking — no, let's just
	// create a second project and verify the file has exactly 2 projects,
	// not a concatenation.
	s.CreateProject("proj_second", "Second", "")
	s.Flush()
	raw2, _ := os.ReadFile(path)
	var snap2 fileSnapshot
	json.Unmarshal(raw2, &snap2)
	if len(snap2.Projects) != 2 {
		t.Fatalf("phase 2 snapshot projects count = %d, want 2", len(snap2.Projects))
	}
	// Verify the JSON is not concatenated (no duplicate keys — Unmarshal
	// would silently take the last value, so check file size didn't double).
	if len(raw2) >= len(raw1)*2 {
		t.Fatalf("phase 2 file size = %d, phase 1 was %d — possible concatenation", len(raw2), len(raw1))
	}
}

// TestFileStoreSyncPersistIdempotentReadsAfterClose verifies reads still
// work after the persist goroutine is shut down.
func TestFileStoreSyncPersistIdempotentReadsAfterClose(t *testing.T) {
	path := filepath.Join(t.TempDir(), "store.json")

	s, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile returned error: %v", err)
	}

	s.CreateProject("proj_close", "Close Test", "")
	s.CreateThread("thread_close", "proj_close", "Close Thread", "", "", "")
	s.Flush()
	s.Close()

	// After Close, reads should still work (in-memory store is intact).
	if got := s.ListProjects(); len(got) != 1 || got[0].ID != "proj_close" {
		t.Fatalf("ListProjects after close = %#v, want proj_close", got)
	}
	if got := s.ListThreads("proj_close"); len(got) != 1 || got[0].ID != "thread_close" {
		t.Fatalf("ListThreads after close = %#v, want thread_close", got)
	}

	// Re-open and verify disk state.
	restored, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile restore returned error: %v", err)
	}
	defer restored.Close()
	if got := restored.ListProjects(); len(got) != 1 || got[0].ID != "proj_close" {
		t.Fatalf("restored ListProjects = %#v, want proj_close", got)
	}
}

// ── Utility function behavioral tests ─────────────────────────────────────

func TestNormalizeEvidenceStatus(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"added", "added"},
		{"ADDED", "added"},
		{"  Added  ", "added"},
		{"created", "added"},
		{"CREATED", "added"},
		{"add", "added"},
		{"Add", "added"},
		{"deleted", "deleted"},
		{"DELETE", "deleted"},
		{"  removed  ", "deleted"},
		{"remove", "deleted"},
		{"REMOVED", "deleted"},
		{"modified", "modified"},
		{"MODIFIED", "modified"},
		{"changed", "modified"},
		{"unknown", "modified"},
		{"", "modified"},
		{"   ", "modified"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := normalizeEvidenceStatus(tt.input)
			if got != tt.want {
				t.Fatalf("normalizeEvidenceStatus(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestThreadPinKey(t *testing.T) {
	key := threadPinKey("thread-1", "item-1")
	if !strings.Contains(key, "\x00") {
		t.Fatal("threadPinKey does not contain null separator")
	}
	parts := strings.SplitN(key, "\x00", 2)
	if len(parts) != 2 || parts[0] != "thread-1" || parts[1] != "item-1" {
		t.Fatalf("threadPinKey = %q, parts = %#v, want thread-1\\x00item-1", key, parts)
	}
}

func TestRunDiffFileKey(t *testing.T) {
	key := runDiffFileKey("run-1", "src/main.go")
	if !strings.Contains(key, "\x00") {
		t.Fatal("runDiffFileKey does not contain null separator")
	}
	parts := strings.SplitN(key, "\x00", 2)
	if len(parts) != 2 || parts[0] != "run-1" || parts[1] != "src/main.go" {
		t.Fatalf("runDiffFileKey = %q, parts = %#v, want run-1\\x00src/main.go", key, parts)
	}
}

func TestThreadPinKeyUniqueness(t *testing.T) {
	// Same thread + different item = different key.
	k1 := threadPinKey("t1", "i1")
	k2 := threadPinKey("t1", "i2")
	if k1 == k2 {
		t.Fatal("threadPinKey produced same key for different items")
	}
	// Different thread + same item = different key.
	k3 := threadPinKey("t2", "i1")
	if k1 == k3 {
		t.Fatal("threadPinKey produced same key for different threads")
	}
}

func TestIsTerminalRunStatus(t *testing.T) {
	terminal := []string{"cancelled", "failed", "finished", "completed_with_issues"}
	nonTerminal := []string{"queued", "started", "running", "pending", "", "unknown"}
	for _, s := range terminal {
		if !isTerminalRunStatus(s) {
			t.Fatalf("isTerminalRunStatus(%q) = false, want true", s)
		}
	}
	for _, s := range nonTerminal {
		if isTerminalRunStatus(s) {
			t.Fatalf("isTerminalRunStatus(%q) = true, want false", s)
		}
	}
}

func TestRunTerminalTime(t *testing.T) {
	ref := time.Date(2026, 5, 25, 9, 0, 0, 0, time.UTC)
	refStr := ref.Format(time.RFC3339)

	// FinishedAt takes priority.
	run := Run{
		CreatedAt:  "2025-01-01T00:00:00Z",
		FinishedAt: refStr,
	}
	got, ok := runTerminalTime(run)
	if !ok || !got.Equal(ref) {
		t.Fatalf("runTerminalTime(with FinishedAt) = %v, %v; want %v, true", got, ok, ref)
	}

	// Falls back to CreatedAt when no FinishedAt.
	run2 := Run{CreatedAt: refStr}
	got2, ok2 := runTerminalTime(run2)
	if !ok2 || !got2.Equal(ref) {
		t.Fatalf("runTerminalTime(only CreatedAt) = %v, %v; want %v, true", got2, ok2, ref)
	}

	// Invalid timestamps return false.
	run3 := Run{CreatedAt: "not-a-time", FinishedAt: "also-invalid"}
	_, ok3 := runTerminalTime(run3)
	if ok3 {
		t.Fatal("runTerminalTime(invalid times) = true, want false")
	}

	// Empty run returns false.
	run4 := Run{}
	_, ok4 := runTerminalTime(run4)
	if ok4 {
		t.Fatal("runTerminalTime(empty) = true, want false")
	}
}

func TestRemoveString(t *testing.T) {
	tests := []struct {
		name   string
		slice  []string
		target string
		want   []string
	}{
		{"remove middle", []string{"a", "b", "c"}, "b", []string{"a", "c"}},
		{"remove first", []string{"a", "b", "c"}, "a", []string{"b", "c"}},
		{"remove last", []string{"a", "b", "c"}, "c", []string{"a", "b"}},
		{"remove only", []string{"a"}, "a", []string{}},
		{"remove missing", []string{"a", "b"}, "x", []string{"a", "b"}},
		{"empty slice", []string{}, "a", []string{}},
		{"remove empty string", []string{"a", "", "b"}, "", []string{"a", "b"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := removeString(tt.slice, tt.target)
			if len(got) != len(tt.want) {
				t.Fatalf("removeString = %#v (len %d), want %#v (len %d)", got, len(got), tt.want, len(tt.want))
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Fatalf("removeString[%d] = %q, want %q", i, got[i], tt.want[i])
				}
			}
		})
	}
}

func TestFilterIDs(t *testing.T) {
	tests := []struct {
		name string
		ids  []string
		keep func(string) bool
		want []string
	}{
		{
			name: "keep even length",
			ids:  []string{"aa", "b", "cc", "d"},
			keep: func(s string) bool { return len(s)%2 == 0 },
			want: []string{"aa", "cc"},
		},
		{
			name: "keep all",
			ids:  []string{"a", "b", "c"},
			keep: func(s string) bool { return true },
			want: []string{"a", "b", "c"},
		},
		{
			name: "keep none",
			ids:  []string{"a", "b", "c"},
			keep: func(s string) bool { return false },
			want: []string{},
		},
		{
			name: "empty slice",
			ids:  []string{},
			keep: func(s string) bool { return true },
			want: []string{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := filterIDs(tt.ids, tt.keep)
			if len(got) != len(tt.want) {
				t.Fatalf("filterIDs = %#v (len %d), want %#v (len %d)", got, len(got), tt.want, len(tt.want))
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Fatalf("filterIDs[%d] = %q, want %q", i, got[i], tt.want[i])
				}
			}
		})
	}
}

func TestSanitizeArtifactDisplayPath(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"dist/report.md", "dist/report.md"},
		{"C:/Users/test/file.txt", "file.txt"},
		{"/absolute/path/file.log", "file.log"},
		{"../outside/file.go", "file.go"},
		{"simple.txt", "simple.txt"},
		{"deeply/nested/path/data.json", "deeply/nested/path/data.json"},
		{"  dist/report.md  ", "dist/report.md"},
		{"", ""},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := sanitizeArtifactDisplayPath(tt.input)
			if got != tt.want {
				t.Fatalf("sanitizeArtifactDisplayPath(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestArtifactBaseName(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"dist/report.md", "report.md"},
		{"/absolute/path/file.log", "file.log"},
		{"C:/Users/test/file.txt", "file.txt"},
		{`C:\Users\test\file.txt`, "file.txt"},
		{"../outside/file.go", "file.go"},
		{"simple.txt", "simple.txt"},
		{"C:relative.txt", "relative.txt"},
		{"", ""},
		{".", ""},
		{"/", ""},
		{"///", ""},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := artifactBaseName(tt.input)
			if got != tt.want {
				t.Fatalf("artifactBaseName(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestIsTerminalRunStatusExhaustive(t *testing.T) {
	// Every recognized terminal status should be terminal.
	for _, s := range []string{"cancelled", "failed", "finished", "completed_with_issues"} {
		if !isTerminalRunStatus(s) {
			t.Fatalf("isTerminalRunStatus(%q) = false, want true", s)
		}
	}
	// Common non-terminal statuses should NOT be terminal.
	for _, s := range []string{"queued", "started", "running", "pending", "paused", "cancelling"} {
		if isTerminalRunStatus(s) {
			t.Fatalf("isTerminalRunStatus(%q) = true, want false", s)
		}
	}
}

// ── path safety behavioral tests ──────────────────────────────────────────

func TestIsPathAbsoluteBehavior(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"/absolute/path", true},
		{"relative/path", false},
		{"C:/windows/path", true},
		{`C:\windows\path`, true},
		{"//server/share/path", true},
		{`\\server\share\path`, true},
		{"", false},
		{"file.txt", false},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := isPathAbsolute(tt.input)
			if got != tt.want {
				t.Fatalf("isPathAbsolute(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestIsPortablePathAbsolute(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"/absolute/path", true},
		{"relative/path", false},
		{"C:/windows", true},
		{"//unc/path", true},
		{"C:relative", false}, // drive letter without slash is not absolute
		{"file.txt", false},
		{"", false},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := isPortablePathAbsolute(tt.input)
			if got != tt.want {
				t.Fatalf("isPortablePathAbsolute(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestIsWindowsDriveAbsolutePath(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"C:/windows", true},
		{"C:", false},
		{"C:relative", false},
		{"X:/path", true},
		{"/not-drive", false},
		{"file.txt", false},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := isWindowsDriveAbsolutePath(tt.input)
			if got != tt.want {
				t.Fatalf("isWindowsDriveAbsolutePath(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestIsWindowsDriveQualifiedPath(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"C:", true},
		{"C:/windows", true},
		{"x:file.txt", true},
		{"1:", false}, // digit is not alpha
		{"file.txt", false},
		{"", false},
		{"C", false}, // no colon
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := isWindowsDriveQualifiedPath(tt.input)
			if got != tt.want {
				t.Fatalf("isWindowsDriveQualifiedPath(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestIsWindowsUNCPath(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"//server/share", true},
		{"//127.0.0.1/share", true},
		{"http://example.com", false}, // doesn't start with //
		{"/not/unc", false},
		{"file.txt", false},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := isWindowsUNCPath(tt.input)
			if got != tt.want {
				t.Fatalf("isWindowsUNCPath(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

// ── Store snapshot/apply round-trip ────────────────────────────────────────

func TestStoreSnapshotApplyRoundTrip(t *testing.T) {
	s := New()

	// Populate with diverse data.
	s.CreateProject("proj_snap", "Snapshot Project", "owner-1")
	s.CreateThread("thread_snap", "proj_snap", "Snapshot Thread", "chat", "#000", "ST")
	run, _ := s.CreateRun("run_snap", "proj_snap", "thread_snap")
	s.SetRunStatus(run.ID, "started")
	s.CreateThreadMessage("item_snap", "thread_snap", "user", "snapshot content")
	s.PinThreadItem("thread_snap", "item_snap", "User")
	s.UpsertRunDiffFile(RunDiffFile{RunID: run.ID, Path: "src/snap.go", Diff: "+snap", Status: "added"})
	s.UpsertArtifact(Artifact{ID: "artifact_snap", RunID: run.ID, ThreadID: "thread_snap", Path: "snap.log"})
	s.UpsertPreview(Preview{ID: "preview_snap", RunID: run.ID, ThreadID: "thread_snap", URL: "http://127.0.0.1:5173/snap"})
	s.CreateUserProfile(UserProfile{ID: "user_snap", DisplayName: "Snapshot User"})
	s.CreateAgentProfile(AgentProfile{ID: "agent_snap", Name: "Snapshot Agent", AdapterID: "openai"})

	// Snapshot.
	snap := s.snapshot()

	// Create a fresh store and apply.
	empty := New()
	empty.applySnapshot(snap)

	// Verify all data survived the round-trip.
	if got := empty.ListProjects(); len(got) != 1 || got[0].ID != "proj_snap" {
		t.Fatalf("applySnapshot projects = %#v, want proj_snap", got)
	}
	if got := empty.ListThreads("proj_snap"); len(got) != 1 || got[0].Title != "Snapshot Thread" {
		t.Fatalf("applySnapshot threads = %#v, want Snapshot Thread", got)
	}
	if got, ok := empty.GetRun("run_snap"); !ok || got.Status != "started" {
		t.Fatalf("applySnapshot run = %#v, want started", got)
	}
	if got, ok := empty.GetItem("item_snap"); !ok || got.Content != "snapshot content" {
		t.Fatalf("applySnapshot item = %#v, want snapshot content", got)
	}
	if pins := empty.ListThreadPins("thread_snap"); len(pins) != 1 || pins[0].PinnedBy != "User" {
		t.Fatalf("applySnapshot pins = %#v, want User pin", pins)
	}
	if diffs := empty.ListRunDiffFiles("run_snap"); len(diffs) != 1 || diffs[0].Path != "src/snap.go" {
		t.Fatalf("applySnapshot diffs = %#v, want src/snap.go", diffs)
	}
	if arts := empty.ListArtifacts("run_snap"); len(arts) != 1 || arts[0].ID != "artifact_snap" {
		t.Fatalf("applySnapshot artifacts = %#v, want artifact_snap", arts)
	}
	if previews := empty.ListPreviews("run_snap"); len(previews) != 1 || previews[0].ID != "preview_snap" {
		t.Fatalf("applySnapshot previews = %#v, want preview_snap", previews)
	}
	if got, ok := empty.GetUserProfile("user_snap"); !ok || got.DisplayName != "Snapshot User" {
		t.Fatalf("applySnapshot user profile = %#v, want Snapshot User", got)
	}
	if got, ok := empty.GetAgentProfile("agent_snap"); !ok || got.Name != "Snapshot Agent" {
		t.Fatalf("applySnapshot agent profile = %#v, want Snapshot Agent", got)
	}

	// Verify orders are preserved or sorted.
	if got := empty.ListProjects(); len(got) != 1 || got[0].ID != "proj_snap" {
		t.Fatalf("applySnapshot project order = %#v", got)
	}
}

// ── SetRunEvidenceGate and SetRunRetryCount ────────────────────────────────

func TestStoreSetRunEvidenceGate(t *testing.T) {
	s := New()
	s.CreateProject("proj_ev", "Evidence Gate", "")
	s.CreateThread("thread_ev", "proj_ev", "Evidence Thread", "", "", "")
	run, _ := s.CreateRun("run_ev", "proj_ev", "thread_ev")

	// Missing run.
	_, ok := s.SetRunEvidenceGate("run_missing", `{"passed":true}`)
	if ok {
		t.Fatal("SetRunEvidenceGate missing run returned ok=true")
	}

	// Set and verify.
	updated, ok := s.SetRunEvidenceGate(run.ID, `{"passed":true,"checks":3}`)
	if !ok || updated.EvidenceGateResult != `{"passed":true,"checks":3}` {
		t.Fatalf("SetRunEvidenceGate = %#v, %v; want evidence gate result", updated, ok)
	}

	got, ok := s.GetRun(run.ID)
	if !ok || got.EvidenceGateResult != `{"passed":true,"checks":3}` {
		t.Fatalf("GetRun evidence gate = %q, want persisted", got.EvidenceGateResult)
	}
}

func TestStoreSetRunRetryCount(t *testing.T) {
	s := New()
	s.CreateProject("proj_retry", "Retry Count", "")
	s.CreateThread("thread_retry", "proj_retry", "Retry Thread", "", "", "")
	run, _ := s.CreateRun("run_retry", "proj_retry", "thread_retry")

	// Missing run.
	_, ok := s.SetRunRetryCount("run_missing", 3)
	if ok {
		t.Fatal("SetRunRetryCount missing run returned ok=true")
	}

	// Set and increment.
	updated, ok := s.SetRunRetryCount(run.ID, 1)
	if !ok || updated.RetryCount != 1 {
		t.Fatalf("SetRunRetryCount first = %#v, want count=1", updated)
	}
	updated, ok = s.SetRunRetryCount(run.ID, 5)
	if !ok || updated.RetryCount != 5 {
		t.Fatalf("SetRunRetryCount second = %#v, want count=5", updated)
	}

	got, ok := s.GetRun(run.ID)
	if !ok || got.RetryCount != 5 {
		t.Fatalf("GetRun retry count = %d, want 5", got.RetryCount)
	}
}

func TestStoreSetRunWorkDir(t *testing.T) {
	s := New()
	s.CreateProject("proj_workdir", "WorkDir", "")
	s.CreateThread("thread_workdir", "proj_workdir", "WorkDir Thread", "", "", "")
	run, _ := s.CreateRun("run_workdir", "proj_workdir", "thread_workdir")

	// Missing run.
	_, ok := s.SetRunWorkDir("run_missing", "/tmp/ws")
	if ok {
		t.Fatal("SetRunWorkDir missing run returned ok=true")
	}

	// Set and overwrite: the executor-reported value is authoritative evidence
	// for run-level diff review (#1967).
	updated, ok := s.SetRunWorkDir(run.ID, "/tmp/ws-first")
	if !ok || updated.WorkDir != "/tmp/ws-first" {
		t.Fatalf("SetRunWorkDir first = %#v, want workDir=/tmp/ws-first", updated)
	}
	updated, ok = s.SetRunWorkDir(run.ID, "/tmp/ws-second")
	if !ok || updated.WorkDir != "/tmp/ws-second" {
		t.Fatalf("SetRunWorkDir second = %#v, want workDir=/tmp/ws-second", updated)
	}

	got, ok := s.GetRun(run.ID)
	if !ok || got.WorkDir != "/tmp/ws-second" {
		t.Fatalf("GetRun workDir = %q, want /tmp/ws-second", got.WorkDir)
	}
}

// ── UserProfile tests ─────────────────────────────────────────────────────

func TestStoreGetCurrentUser(t *testing.T) {
	s := New()

	// Empty store.
	_, ok := s.GetCurrentUser()
	if ok {
		t.Fatal("GetCurrentUser on empty store returned ok=true")
	}

	// Single non-owner profile: should be returned as fallback.
	s.CreateUserProfile(UserProfile{ID: "user_first", DisplayName: "First User", Status: "active"})
	got, ok := s.GetCurrentUser()
	if !ok || got.ID != "user_first" {
		t.Fatalf("GetCurrentUser first = %#v, %v; want user_first", got, ok)
	}

	// Add an owner: owner takes priority.
	s.CreateUserProfile(UserProfile{ID: "user_owner", DisplayName: "Owner", Status: "owner"})
	got, ok = s.GetCurrentUser()
	if !ok || got.ID != "user_owner" || got.DisplayName != "Owner" {
		t.Fatalf("GetCurrentUser with owner = %#v, %v; want user_owner", got, ok)
	}
}

func TestStoreCreateUserProfileIdempotent(t *testing.T) {
	s := New()
	first, err := s.CreateUserProfile(UserProfile{ID: "user_dup", DisplayName: "Original"})
	if err != nil {
		t.Fatalf("CreateUserProfile first returned error: %v", err)
	}
	second, err := s.CreateUserProfile(UserProfile{ID: "user_dup", DisplayName: "Renamed"})
	if err != nil {
		t.Fatalf("CreateUserProfile duplicate returned error: %v", err)
	}
	if second.DisplayName != "Original" {
		t.Fatalf("duplicate display name = %q, want Original", second.DisplayName)
	}
	if second.CreatedAt != first.CreatedAt {
		t.Fatalf("duplicate CreatedAt changed: %q vs %q", second.CreatedAt, first.CreatedAt)
	}
	if profiles := s.ListUserProfiles(); len(profiles) != 1 {
		t.Fatalf("ListUserProfiles = %d, want 1", len(profiles))
	}
}

// ── Edge case: Settings with empty key ─────────────────────────────────────

func TestStoreUpsertSettingsSkipsEmptyKey(t *testing.T) {
	s := New()
	result, err := s.UpsertSettings(map[string]string{
		"":      "empty-key-value",
		"valid": "value",
		"  ":    "whitespace-key",
	})
	if err != nil {
		t.Fatalf("UpsertSettings returned error: %v", err)
	}
	if len(result.Values) != 1 || result.Values["valid"] != "value" {
		t.Fatalf("UpsertSettings values = %#v, want only valid key", result.Values)
	}
	if _, exists := result.Values[""]; exists {
		t.Fatal("empty key was stored in settings")
	}
	if _, exists := result.Values["  "]; exists {
		t.Fatal("whitespace-only key was stored in settings")
	}
}

// ── Evidence status edge cases ─────────────────────────────────────────────

func TestUpsertRunDiffFileRejectsBlankPath(t *testing.T) {
	s := New()
	s.CreateProject("proj_diff", "Diff Project", "")
	s.CreateThread("thread_diff", "proj_diff", "Diff Thread", "", "", "")
	run, _ := s.CreateRun("run_diff", "proj_diff", "thread_diff")

	_, err := s.UpsertRunDiffFile(RunDiffFile{RunID: run.ID, Path: "", Diff: "+change", Status: "modified"})
	if err == nil || err != ErrNotFound {
		t.Fatalf("UpsertRunDiffFile blank path error = %v, want ErrNotFound", err)
	}
	_, err = s.UpsertRunDiffFile(RunDiffFile{RunID: run.ID, Path: "   ", Diff: "+change", Status: "modified"})
	if err == nil || err != ErrNotFound {
		t.Fatalf("UpsertRunDiffFile whitespace path error = %v, want ErrNotFound", err)
	}
}

// ── CreateThread idempotency cross-project guard ───────────────────────────

func TestCreateThreadRejectsCrossProjectDuplicate(t *testing.T) {
	s := New()
	s.CreateProject("proj_a", "Project A", "")
	s.CreateProject("proj_b", "Project B", "")
	s.CreateThread("thread_x", "proj_a", "Thread in A", "", "", "")

	_, err := s.CreateThread("thread_x", "proj_b", "Thread in B", "", "", "")
	if err == nil {
		t.Fatal("CreateThread cross-project duplicate returned nil error")
	}
	if !strings.Contains(err.Error(), "already exists in project") {
		t.Fatalf("CreateThread cross-project error = %v, want 'already exists in project'", err)
	}
	// Original thread should be unchanged.
	got, ok := s.GetThread("thread_x")
	if !ok || got.ProjectID != "proj_a" {
		t.Fatalf("thread_x = %#v, want still in proj_a", got)
	}
}

// ── cloneArtifact deep-copy behavior ──────────────────────────────────────

func TestCloneArtifactDoesNotShareContentSourcePointer(t *testing.T) {
	original := Artifact{
		ID:   "art_clone",
		Kind: "file",
		Path: "report.md",
		ContentSource: &ArtifactContentSource{
			Kind:     ArtifactContentSourceWorkspaceRelative,
			Path:     "dist/report.md",
			Readable: true,
		},
	}

	cloned := cloneArtifact(original)
	// Mutate original's content source — clone must be unaffected.
	original.ContentSource.Path = "dist/hacked.md"
	original.ContentSource.Readable = false

	if cloned.ContentSource == nil {
		t.Fatal("cloned ContentSource is nil")
	}
	if cloned.ContentSource.Path != "dist/report.md" {
		t.Fatalf("cloned ContentSource.Path = %q, want dist/report.md (not mutated)", cloned.ContentSource.Path)
	}
	if !cloned.ContentSource.Readable {
		t.Fatal("cloned ContentSource.Readable = false, want true (not mutated)")
	}
}

func TestCloneArtifactNilContentSource(t *testing.T) {
	original := Artifact{
		ID:   "art_nil",
		Kind: "file",
		Path: "report.md",
	}
	cloned := cloneArtifact(original)
	if cloned.ContentSource != nil {
		t.Fatal("cloned ContentSource is not nil for nil original")
	}
	if cloned.ID != original.ID || cloned.Kind != original.Kind {
		t.Fatalf("cloned fields mismatch: %#v vs %#v", cloned, original)
	}
}
