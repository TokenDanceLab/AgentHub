package store

import (
	"slices"
	"sort"
)

func copyMap[K comparable, V any](source map[K]V) map[K]V {
	copied := make(map[K]V, len(source))
	for key, value := range source {
		copied[key] = value
	}
	return copied
}

// cloneCheckpointMap deep-copies checkpoint values (Files slice included)
// so snapshot round-trips never share backing arrays (#1968).
func cloneCheckpointMap(source map[string]RunCheckpoint) map[string]RunCheckpoint {
	out := make(map[string]RunCheckpoint, len(source))
	for key, cp := range source {
		files := append([]CheckpointFile(nil), cp.Files...)
		cp.Files = files
		out[key] = cp
	}
	return out
}

func cloneArtifactMap(source map[string]Artifact) map[string]Artifact {
	copied := make(map[string]Artifact, len(source))
	for key, value := range source {
		copied[key] = cloneArtifact(value)
	}
	return copied
}

func cloneArtifact(artifact Artifact) Artifact {
	if artifact.ContentSource == nil {
		return artifact
	}
	source := *artifact.ContentSource
	artifact.ContentSource = &source
	return artifact
}

// cloneAgentProfile detaches the mutable tool and skill lists from the source.
func cloneAgentProfile(profile AgentProfile) AgentProfile {
	profile.AllowedTools = slices.Clone(profile.AllowedTools)
	profile.Skills = slices.Clone(profile.Skills)
	return profile
}

func cloneAgentProfileMap(source map[string]AgentProfile) map[string]AgentProfile {
	out := make(map[string]AgentProfile, len(source))
	for key, profile := range source {
		out[key] = cloneAgentProfile(profile)
	}
	return out
}

func normalizeOrder[V any](order []string, items map[string]V) []string {
	normalized := make([]string, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for _, id := range order {
		if _, ok := items[id]; !ok {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		normalized = append(normalized, id)
		seen[id] = struct{}{}
	}

	missing := make([]string, 0, len(items)-len(seen))
	for id := range items {
		if _, ok := seen[id]; !ok {
			missing = append(missing, id)
		}
	}
	sort.Strings(missing)
	return append(normalized, missing...)
}
