package store

import (
	"fmt"
	"path/filepath"
	"reflect"
	"testing"
)

type profileOwnershipBackend struct {
	name string
	open func(string) (Repository, error)
}

func profileOwnershipBackends() []profileOwnershipBackend {
	return []profileOwnershipBackend{
		{"memory", func(string) (Repository, error) { return New(), nil }},
		{"file", func(path string) (Repository, error) { return NewFile(path) }},
		{"sqlite", func(path string) (Repository, error) { return NewSQLite(path) }},
	}
}

func profileOwnershipFixture() AgentProfile {
	return AgentProfile{
		ID: "profile", Name: "Original", AdapterID: "mock",
		AllowedTools: []string{"Read", "List"}, Skills: []string{"review", "test"},
	}
}

func assertProfileOwnershipLists(t *testing.T, got AgentProfile) {
	t.Helper()
	want := profileOwnershipFixture()
	if !reflect.DeepEqual(got.AllowedTools, want.AllowedTools) || !reflect.DeepEqual(got.Skills, want.Skills) {
		t.Fatalf("stored profile lists changed through caller-owned data: allowedTools=%v skills=%v", got.AllowedTools, got.Skills)
	}
}

func mutateProfileOwnershipLists(profile AgentProfile) {
	profile.AllowedTools[0] = "caller-tool"
	profile.Skills[0] = "caller-skill"
}

func TestAgentProfileRepositoryOwnsMutableLists(t *testing.T) {
	t.Parallel()
	for _, backend := range profileOwnershipBackends() {
		t.Run(backend.name, func(t *testing.T) {
			for _, access := range []struct {
				name string
				view func(*testing.T, Repository, AgentProfile, AgentProfile) AgentProfile
			}{
				{"create-input", func(_ *testing.T, _ Repository, input, _ AgentProfile) AgentProfile { return input }},
				{"create-result", func(_ *testing.T, _ Repository, _, created AgentProfile) AgentProfile { return created }},
				{"get", func(t *testing.T, repo Repository, input, _ AgentProfile) AgentProfile {
					got, ok := repo.GetAgentProfile(input.ID)
					if !ok {
						t.Fatal("created profile missing")
					}
					return got
				}},
				{"list", func(t *testing.T, repo Repository, _, _ AgentProfile) AgentProfile {
					got := repo.ListAgentProfiles("mock")
					if len(got) != 1 {
						t.Fatalf("profile count = %d, want 1", len(got))
					}
					return got[0]
				}},
				{"update-retained-lists", func(t *testing.T, repo Repository, input, _ AgentProfile) AgentProfile {
					got, err := repo.UpdateAgentProfile(input.ID, map[string]any{"name": "Renamed"})
					if err != nil {
						t.Fatal(err)
					}
					return got
				}},
				{"update-replaced-lists", func(t *testing.T, repo Repository, input, _ AgentProfile) AgentProfile {
					got, err := repo.UpdateAgentProfile(input.ID, map[string]any{
						"allowedTools": []any{"Read", "List"}, "skills": []any{"review", "test"},
					})
					if err != nil {
						t.Fatal(err)
					}
					return got
				}},
			} {
				t.Run(access.name, func(t *testing.T) {
					repo, err := backend.open(filepath.Join(t.TempDir(), "store.data"))
					if err != nil {
						t.Fatal(err)
					}
					t.Cleanup(repo.Close)
					input := profileOwnershipFixture()
					created, err := repo.CreateAgentProfile(input)
					if err != nil {
						t.Fatal(err)
					}
					mutateProfileOwnershipLists(access.view(t, repo, input, created))
					stored, ok := repo.GetAgentProfile(input.ID)
					if !ok {
						t.Fatal("profile disappeared after mutating a view")
					}
					assertProfileOwnershipLists(t, stored)
				})
			}
		})
	}
}

func TestAgentProfileSnapshotsOwnLists(t *testing.T) {
	t.Parallel()
	s := New()
	profile := profileOwnershipFixture()
	if _, err := s.CreateAgentProfile(profile); err != nil {
		t.Fatal(err)
	}
	snap := s.snapshot()
	restored := New()
	restored.applySnapshot(snap)
	baseline := cloneFileSnapshot(snap)
	mutateProfileOwnershipLists(snap.AgentProfiles[profile.ID])
	t.Run("export", func(t *testing.T) {
		got, _ := s.GetAgentProfile(profile.ID)
		assertProfileOwnershipLists(t, got)
	})
	t.Run("restore", func(t *testing.T) {
		got, _ := restored.GetAgentProfile(profile.ID)
		assertProfileOwnershipLists(t, got)
	})
	t.Run("committed-baseline", func(t *testing.T) {
		assertProfileOwnershipLists(t, baseline.AgentProfiles[profile.ID])
	})
}

func TestAgentProfileDurableIsolation(t *testing.T) {
	t.Parallel()
	for _, backend := range profileOwnershipBackends()[1:] {
		t.Run(backend.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "store.data")
			repo, err := backend.open(path)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if repo != nil {
					repo.Close()
				}
			})
			profile := profileOwnershipFixture()
			if _, err := repo.CreateAgentProfile(profile); err != nil {
				t.Fatal(err)
			}
			view, ok := repo.GetAgentProfile(profile.ID)
			if !ok {
				t.Fatal("created profile missing")
			}
			mutateProfileOwnershipLists(view)
			// A legitimate name edit must not accidentally persist edits made to
			// a previously returned tool/skill list.
			if _, err := repo.UpdateAgentProfile(profile.ID, map[string]any{"name": "Renamed"}); err != nil {
				t.Fatal(err)
			}
			repo.Close()
			repo = nil
			repo, err = backend.open(path)
			if err != nil {
				t.Fatal(err)
			}
			got, ok := repo.GetAgentProfile(profile.ID)
			if !ok || got.Name != "Renamed" {
				t.Fatalf("durable name edit was lost: profile=%#v found=%v", got, ok)
			}
			assertProfileOwnershipLists(t, got)
		})
	}
}

func TestAgentProfileOptionalListShapes(t *testing.T) {
	t.Parallel()
	for _, empty := range []bool{false, true} {
		profile := AgentProfile{ID: "profile", AdapterID: "mock"}
		if empty {
			profile.AllowedTools, profile.Skills = []string{}, []string{}
		}
		s := New()
		created, err := s.CreateAgentProfile(profile)
		if err != nil {
			t.Fatal(err)
		}
		got, _ := s.GetAgentProfile(profile.ID)
		for _, view := range []AgentProfile{created, got, s.ListAgentProfiles("")[0], s.snapshot().AgentProfiles[profile.ID]} {
			if !reflect.DeepEqual(view.AllowedTools, profile.AllowedTools) || !reflect.DeepEqual(view.Skills, profile.Skills) {
				t.Fatalf("optional list shape changed: empty=%v got=%#v", empty, view)
			}
		}
	}
}

func TestAgentProfileScopedListOwnership(t *testing.T) {
	t.Parallel()
	s := New()
	idsByAdapter := map[string][]string{"missing": {}}
	for i := 0; i < 24; i++ {
		profile := profileOwnershipFixture()
		profile.ID = fmt.Sprintf("profile-%02d", 24-i)
		profile.AdapterID = "dense"
		if i%6 == 0 {
			profile.AdapterID = "small"
		}
		if _, err := s.CreateAgentProfile(profile); err != nil {
			t.Fatal(err)
		}
		idsByAdapter[profile.AdapterID] = append(idsByAdapter[profile.AdapterID], profile.ID)
		idsByAdapter[""] = append(idsByAdapter[""], profile.ID)
	}
	for _, scope := range []string{"small", "dense", "", "missing"} {
		t.Run("scope="+scope, func(t *testing.T) {
			got, wantIDs := s.ListAgentProfiles(scope), idsByAdapter[scope]
			if got == nil || len(got) != len(wantIDs) {
				t.Fatalf("list nil=%v count=%d, want non-nil count=%d", got == nil, len(got), len(wantIDs))
			}
			for i, profile := range got {
				if profile.ID != wantIDs[i] {
					t.Fatalf("result[%d].ID=%q, want %q", i, profile.ID, wantIDs[i])
				}
				mutateProfileOwnershipLists(profile)
				stored, ok := s.GetAgentProfile(profile.ID)
				if !ok {
					t.Fatalf("profile %q disappeared", profile.ID)
				}
				assertProfileOwnershipLists(t, stored)
			}
		})
	}
}
