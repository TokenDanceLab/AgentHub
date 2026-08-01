package store

import (
	"log/slog"
	"sync"
)

// seedMu prevents concurrent SeedIfEmpty calls from racing. The store lock
// is not sufficient because SeedIfEmpty checks-then-writes across many
// separate store mutations (projects, threads, runs, items, pins).
var seedMu sync.Mutex

// SeedIfEmpty populates the store with demo data when it is empty.
// This allows the Desktop app to show realistic conversations, transcripts,
// and per-conversation right-sidebar evidence (diffs/artifacts/previews)
// through the real Edge API instead of hardcoded frontend JS objects.
//
// It is safe to call multiple times; if the store already contains any
// project, the function returns immediately without writing anything.
// A mutex prevents concurrent callers from both seeing an empty store
// and starting parallel seeding.
func SeedIfEmpty(repo Repository) error {
	seedMu.Lock()
	defer seedMu.Unlock()

	if len(repo.ListProjects()) > 0 {
		return nil
	}

	slog.Info("seed: store is empty, seeding demo data")

	// 1. User profiles
	if err := seedUserProfilesData(repo); err != nil {
		return err
	}

	// 2. Project
	if _, err := repo.CreateProject(seedProjectID, seedProjectName, ""); err != nil {
		return err
	}

	// 3. Threads + Runs + Items + Evidence
	if err := seedThreadsData(repo); err != nil {
		return err
	}

	// 4. Pins
	seedPinsData(repo)

	slog.Info("seed: done", "threads", len(seedThreads), "runs", countSeedRuns(), "pins", len(seedPins))
	return nil
}

// seedUserProfilesData creates all demo user profiles.
func seedUserProfilesData(repo Repository) error {
	for _, profile := range seedUserProfiles {
		if _, err := repo.CreateUserProfile(profile); err != nil {
			return err
		}
	}
	return nil
}

// seedThreadsData creates every demo thread, its run evidence, and its items.
func seedThreadsData(repo Repository) error {
	for _, t := range seedThreads {
		if _, err := repo.CreateThread(t.ID, seedProjectID, t.Title, t.Kind, t.AvatarColor, t.AvatarLabel); err != nil {
			return err
		}
		if t.Run != nil {
			if err := seedThreadRun(repo, t); err != nil {
				return err
			}
		}
		if err := seedThreadItems(repo, t); err != nil {
			return err
		}
	}
	return nil
}

// seedThreadRun creates the thread's run and its diffs/artifacts/previews.
func seedThreadRun(repo Repository, t seedThreadDef) error {
	run, err := repo.CreateRun(t.Run.ID, seedProjectID, t.ID)
	if err != nil {
		return err
	}
	switch t.Run.Status {
	case "finished":
		repo.SetRunStatus(run.ID, "started")
		repo.SetRunStatus(run.ID, t.Run.Status)
	case "queued":
		// Leave the run in its initial queued state.
	default:
		repo.SetRunStatus(run.ID, t.Run.Status)
	}

	for _, d := range t.Run.Diffs {
		if _, err := repo.UpsertRunDiffFile(RunDiffFile{
			RunID:  run.ID,
			Path:   d.Path,
			Diff:   d.Diff,
			Status: d.Status,
		}); err != nil {
			return err
		}
	}

	for _, a := range t.Run.Artifacts {
		if _, err := repo.UpsertArtifact(Artifact{
			ID:        a.ID,
			RunID:     run.ID,
			ThreadID:  t.ID,
			Kind:      a.Kind,
			Path:      a.Path,
			SizeBytes: a.SizeBytes,
		}); err != nil {
			return err
		}
	}

	for _, p := range t.Run.Previews {
		if _, err := repo.UpsertPreview(Preview{
			ID:       p.ID,
			RunID:    run.ID,
			ThreadID: t.ID,
			URL:      p.URL,
			Status:   p.Status,
		}); err != nil {
			return err
		}
	}
	return nil
}

// seedThreadItems creates the thread's items (messages, diffs, approvals, artifacts).
func seedThreadItems(repo Repository, t seedThreadDef) error {
	for _, item := range t.Items {
		runID := item.RunID
		if _, err := repo.CreateItem(Item{
			ID:         item.ID,
			ProjectID:  seedProjectID,
			ThreadID:   t.ID,
			RunID:      runID,
			Type:       item.Type,
			Role:       item.Role,
			SenderID:   item.SenderID,
			SenderName: item.SenderName,
			Status:     "created",
			Content:    item.Content,
		}); err != nil {
			return err
		}
	}
	return nil
}

// seedPinsData pins demo items; failures are non-fatal.
func seedPinsData(repo Repository) {
	for _, pin := range seedPins {
		if _, err := repo.PinThreadItem(pin.ThreadID, pin.ItemID, pin.PinnedBy); err != nil {
			// Pin failure is non-fatal; the item might not exist yet in some edge cases.
			slog.Warn("seed: pin warning", "error", err)
		}
	}
}

func countSeedRuns() int {
	n := 0
	for _, t := range seedThreads {
		if t.Run != nil {
			n++
		}
	}
	return n
}
