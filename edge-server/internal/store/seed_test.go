package store

import (
	"strings"
	"testing"
)

func TestSeedIfEmpty(t *testing.T) {
	repo := New()
	if err := SeedIfEmpty(repo); err != nil {
		t.Fatalf("SeedIfEmpty: %v", err)
	}

	// Project
	projects := repo.ListProjects()
	if len(projects) != 1 {
		t.Fatalf("projects: got %d, want 1", len(projects))
	}
	if projects[0].ID != seedProjectID {
		t.Errorf("project ID: got %q, want %q", projects[0].ID, seedProjectID)
	}

	// Threads
	threads := repo.ListThreads(seedProjectID)
	if len(threads) != len(seedThreads) {
		t.Fatalf("threads: got %d, want %d", len(threads), len(seedThreads))
	}

	// Verify each thread has its items
	for _, td := range seedThreads {
		items := repo.ListThreadItems(td.ID)
		if len(items) != len(td.Items) {
			t.Errorf("thread %q items: got %d, want %d", td.ID, len(items), len(td.Items))
		}

		// Check first item has content
		if len(items) > 0 && items[0].Content == "" {
			t.Errorf("thread %q first item has empty content", td.ID)
		}

		// Check items with RunID carry it through
		for i, itemDef := range td.Items {
			if itemDef.RunID != "" && i < len(items) {
				if items[i].RunID != itemDef.RunID {
					t.Errorf("thread %q item %q runId: got %q, want %q", td.ID, itemDef.ID, items[i].RunID, itemDef.RunID)
				}
			}
		}
	}

	// Verify runs exist for threads that have them
	runCount := 0
	for _, td := range seedThreads {
		if td.Run != nil {
			runCount++
			run, ok := repo.GetRun(td.Run.ID)
			if !ok {
				t.Errorf("run %q not found", td.Run.ID)
				continue
			}
			if run.Status != td.Run.Status {
				t.Errorf("run %q status: got %q, want %q", td.Run.ID, run.Status, td.Run.Status)
			}

			// Diffs
			diffs := repo.ListRunDiffFiles(run.ID)
			if len(diffs) != len(td.Run.Diffs) {
				t.Errorf("run %q diffs: got %d, want %d", td.Run.ID, len(diffs), len(td.Run.Diffs))
			}

			// Artifacts
			artifacts := repo.ListArtifacts(run.ID)
			if len(artifacts) != len(td.Run.Artifacts) {
				t.Errorf("run %q artifacts: got %d, want %d", td.Run.ID, len(artifacts), len(td.Run.Artifacts))
			}

			// Previews
			previews := repo.ListPreviews(run.ID)
			if len(previews) != len(td.Run.Previews) {
				t.Errorf("run %q previews: got %d, want %d", td.Run.ID, len(previews), len(td.Run.Previews))
			}
		}
	}
	if runCount == 0 {
		t.Error("expected at least one seeded run")
	}

	// Pins
	for _, pin := range seedPins {
		pins := repo.ListThreadPins(pin.ThreadID)
		found := false
		for _, p := range pins {
			if p.ItemID == pin.ItemID {
				found = true
				if p.PinnedBy != pin.PinnedBy {
					t.Errorf("pin pinnedBy: got %q, want %q", p.PinnedBy, pin.PinnedBy)
				}
			}
		}
		if !found {
			t.Errorf("pin not found: thread=%q item=%q", pin.ThreadID, pin.ItemID)
		}
	}
}

func TestSeedIfEmpty_SkipNonEmpty(t *testing.T) {
	repo := New()
	// Pre-create a project so the store is non-empty
	repo.CreateProject("existing-project", "Existing")

	if err := SeedIfEmpty(repo); err != nil {
		t.Fatalf("SeedIfEmpty on non-empty store: %v", err)
	}

	// Should still have only the pre-existing project
	projects := repo.ListProjects()
	if len(projects) != 1 {
		t.Fatalf("projects after skip: got %d, want 1", len(projects))
	}
	if projects[0].ID != "existing-project" {
		t.Errorf("project ID: got %q, want %q", projects[0].ID, "existing-project")
	}

	// No demo threads should have been created
	threads := repo.ListThreads("existing-project")
	if len(threads) != 0 {
		t.Errorf("threads after skip: got %d, want 0", len(threads))
	}
}

func TestSeedIfEmpty_Idempotent(t *testing.T) {
	repo := New()

	// Seed twice
	if err := SeedIfEmpty(repo); err != nil {
		t.Fatalf("first SeedIfEmpty: %v", err)
	}
	if err := SeedIfEmpty(repo); err != nil {
		t.Fatalf("second SeedIfEmpty: %v", err)
	}

	// Should have exactly the demo data, not duplicated
	threads := repo.ListThreads(seedProjectID)
	if len(threads) != len(seedThreads) {
		t.Errorf("threads after double seed: got %d, want %d", len(threads), len(seedThreads))
	}
}

func TestSeedIfEmpty_BuilderRunEvidence(t *testing.T) {
	repo := New()
	SeedIfEmpty(repo)

	// The builder thread should have a finished run with evidence
	run, ok := repo.GetRun("run-builder-1")
	if !ok {
		t.Fatal("run-builder-1 not found")
	}
	if run.Status != "finished" {
		t.Errorf("builder run status: got %q, want finished", run.Status)
	}

	// Diffs — should have 3 files
	diffs := repo.ListRunDiffFiles("run-builder-1")
	if len(diffs) != 3 {
		t.Fatalf("builder diffs: got %d, want 3", len(diffs))
	}
	for _, d := range diffs {
		if d.Diff == "" {
			t.Errorf("builder diff %q has empty diff content", d.Path)
		}
		if !strings.HasPrefix(d.Diff, "diff --git") {
			t.Errorf("builder diff %q does not start with diff --git", d.Path)
		}
	}

	// Artifacts — should have 4
	artifacts := repo.ListArtifacts("run-builder-1")
	if len(artifacts) != 4 {
		t.Fatalf("builder artifacts: got %d, want 4", len(artifacts))
	}

	// Preview — should have 1
	previews := repo.ListPreviews("run-builder-1")
	if len(previews) != 1 {
		t.Fatalf("builder previews: got %d, want 1", len(previews))
	}
	if previews[0].URL == "" {
		t.Error("builder preview has empty URL")
	}
}

func TestSeedIfEmpty_PerThreadEvidence(t *testing.T) {
	repo := New()
	SeedIfEmpty(repo)

	// Verify each thread that has a run also has unique evidence
	for _, td := range seedThreads {
		if td.Run == nil {
			continue
		}

		diffs := repo.ListRunDiffFiles(td.Run.ID)
		artifacts := repo.ListArtifacts(td.Run.ID)
		previews := repo.ListPreviews(td.Run.ID)

		total := len(diffs) + len(artifacts) + len(previews)
		if total == 0 {
			t.Errorf("thread %q run %q has no evidence at all", td.ID, td.Run.ID)
		}
	}
}
