package store

import "sort"

func copyMap[K comparable, V any](source map[K]V) map[K]V {
	copied := make(map[K]V, len(source))
	for key, value := range source {
		copied[key] = value
	}
	return copied
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
