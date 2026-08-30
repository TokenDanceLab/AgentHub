package store

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

// sqlite_store_query_projections.go holds pure projection map builders and
// prepare* write-column helpers peeled from sqlite_store_query.go.
// No *sql.DB / *sql.Tx / IO ownership.

type artifactProjection struct {
	ArtifactID            string `json:"artifactId"`
	RunID                 string `json:"runId"`
	WorkspaceID           string `json:"workspaceId"`
	Kind                  string `json:"kind"`
	Path                  string `json:"path"`
	CreatedAt             string `json:"createdAt"`
	UpdatedAt             string `json:"updatedAt"`
	MetadataJSON          string `json:"metadataJson"`
	ContentSourceKind     string `json:"contentSourceKind"`
	ContentSourcePath     string `json:"contentSourcePath"`
	ContentSourceReadable int    `json:"contentSourceReadable"`
}

type diffProjection struct {
	DiffID      string `json:"diffId"`
	RunID       string `json:"runId"`
	WorkspaceID string `json:"workspaceId"`
	SummaryJSON string `json:"summaryJson"`
	PatchPath   string `json:"patchPath"`
	Status      string `json:"status"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

type previewProjection struct {
	PreviewID   string `json:"previewId"`
	RunID       string `json:"runId"`
	WorkspaceID string `json:"workspaceId"`
	URL         string `json:"url"`
	Status      string `json:"status"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

func buildArtifactProjectionMap(snapshot fileSnapshot) map[string]string {
	result := make(map[string]string, len(snapshot.Artifacts))
	for id, artifact := range snapshot.Artifacts {
		if artifact.ID == "" || artifact.RunID == "" {
			continue
		}
		run, ok := snapshot.Runs[artifact.RunID]
		if !ok || run.ProjectID == "" {
			continue
		}
		if _, ok := snapshot.Projects[run.ProjectID]; !ok {
			continue
		}
		csKind, csPath, csReadable := sqliteArtifactContentSourceColumns(artifact.ContentSource)
		metadataJSON, err := sqliteArtifactMetadataJSON(artifact)
		if err != nil {
			continue
		}
		proj := artifactProjection{
			ArtifactID:            id,
			RunID:                 artifact.RunID,
			WorkspaceID:           run.ProjectID,
			Kind:                  artifact.Kind,
			Path:                  artifact.Path,
			CreatedAt:             artifact.CreatedAt,
			UpdatedAt:             artifact.UpdatedAt,
			MetadataJSON:          metadataJSON,
			ContentSourceKind:     csKind,
			ContentSourcePath:     csPath,
			ContentSourceReadable: csReadable,
		}
		payload, _ := json.Marshal(proj)
		result[id] = string(payload)
	}
	return result
}

func buildDiffProjectionMap(snapshot fileSnapshot) map[string]string {
	result := make(map[string]string, len(snapshot.Diffs))
	for _, diffFile := range snapshot.Diffs {
		if diffFile.RunID == "" || diffFile.Path == "" {
			continue
		}
		run, ok := snapshot.Runs[diffFile.RunID]
		if !ok || run.ProjectID == "" {
			continue
		}
		if _, ok := snapshot.Projects[run.ProjectID]; !ok {
			continue
		}
		diffID := sqliteDiffProjectionID(diffFile)
		summaryJSON, err := sqliteDiffSummaryJSON(diffFile)
		if err != nil {
			continue
		}
		proj := diffProjection{
			DiffID:      diffID,
			RunID:       diffFile.RunID,
			WorkspaceID: run.ProjectID,
			SummaryJSON: summaryJSON,
			PatchPath:   diffFile.Path,
			Status:      diffFile.Status,
			CreatedAt:   diffFile.CreatedAt,
			UpdatedAt:   diffFile.UpdatedAt,
		}
		payload, _ := json.Marshal(proj)
		result[diffID] = string(payload)
	}
	return result
}

func buildPreviewProjectionMap(snapshot fileSnapshot) map[string]string {
	result := make(map[string]string, len(snapshot.Previews))
	for id, preview := range snapshot.Previews {
		if preview.ID == "" || preview.RunID == "" {
			continue
		}
		run, ok := snapshot.Runs[preview.RunID]
		if !ok || run.ProjectID == "" {
			continue
		}
		if _, ok := snapshot.Projects[run.ProjectID]; !ok {
			continue
		}
		proj := previewProjection{
			PreviewID:   id,
			RunID:       preview.RunID,
			WorkspaceID: run.ProjectID,
			URL:         preview.URL,
			Status:      preview.Status,
			CreatedAt:   preview.CreatedAt,
			UpdatedAt:   preview.UpdatedAt,
		}
		payload, _ := json.Marshal(proj)
		result[id] = string(payload)
	}
	return result
}

func deltaProjectionMap(
	tableName, idColumn string,
	oldMap, newMap map[string]string,
	upsertFn func(id string, payload string) error,
	deleteFn func(id string) error,
) error {
	for id, newPayload := range newMap {
		oldPayload, existed := oldMap[id]
		if existed && oldPayload == newPayload {
			continue
		}
		if err := upsertFn(id, newPayload); err != nil {
			return fmt.Errorf("upsert %s %s in %s: %w", idColumn, id, tableName, err)
		}
	}
	for id := range oldMap {
		if _, ok := newMap[id]; !ok {
			if err := deleteFn(id); err != nil {
				return fmt.Errorf("delete %s %s from %s: %w", idColumn, id, tableName, err)
			}
		}
	}
	return nil
}

func sqliteArtifactContentSourceColumns(source *ArtifactContentSource) (string, string, int) {
	if source == nil {
		return "", "", 0
	}
	readable := 0
	if source.Readable {
		readable = 1
	}
	return source.Kind, source.Path, readable
}

func sqliteArtifactMetadataJSON(artifact Artifact) (string, error) {
	payload, err := json.Marshal(struct {
		SizeBytes int64 `json:"sizeBytes"`
	}{
		SizeBytes: artifact.SizeBytes,
	})
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

func sqliteDiffProjectionID(file RunDiffFile) string {
	payload, _ := json.Marshal([2]string{file.RunID, file.Path})
	sum := sha256.Sum256(payload)
	return "run_diff:" + hex.EncodeToString(sum[:])
}

func sqliteDiffSummaryJSON(file RunDiffFile) (string, error) {
	payload, err := json.Marshal(struct {
		Path      string `json:"path"`
		DiffBytes int    `json:"diffBytes"`
	}{
		Path:      file.Path,
		DiffBytes: len([]byte(file.Diff)),
	})
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

func nullString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

// buildJSONPayloadMap marshals each map value to a JSON string keyed by id.
// Marshal errors are ignored to preserve the previous projection delta behavior.
func buildJSONPayloadMap[V any](items map[string]V) map[string]string {
	result := make(map[string]string, len(items))
	for id, value := range items {
		payload, _ := json.Marshal(value)
		result[id] = string(payload)
	}
	return result
}

// workspaceProjectionWrite holds pure columns for an edge_workspaces upsert.
type workspaceProjectionWrite struct {
	WorkspaceID string
	LocalPath   string
	Name        string
	Status      string
	CreatedAt   string
	UpdatedAt   string
}

// prepareWorkspaceProjectionWrite decodes a project payload into projection columns.
// skip is true when the project has no ID and should not be written.
func prepareWorkspaceProjectionWrite(payload, now string) (workspaceProjectionWrite, bool, error) {
	var proj Project
	if err := json.Unmarshal([]byte(payload), &proj); err != nil {
		return workspaceProjectionWrite{}, false, err
	}
	if proj.ID == "" {
		return workspaceProjectionWrite{}, true, nil
	}
	createdAt := firstNonEmpty(proj.CreatedAt, now)
	return workspaceProjectionWrite{
		WorkspaceID: proj.ID,
		LocalPath:   proj.ID,
		Name:        firstNonEmpty(proj.Name, proj.ID),
		Status:      firstNonEmpty(proj.Status, "active"),
		CreatedAt:   createdAt,
		UpdatedAt:   firstNonEmpty(proj.UpdatedAt, createdAt),
	}, false, nil
}

// runProjectionWrite holds pure columns for an edge_runs upsert.
type runProjectionWrite struct {
	RunID       string
	WorkspaceID string
	ThreadID    any
	Status      string
	CreatedAt   string
	StartedAt   any
	FinishedAt  any
	HubTaskID   any
}

// prepareRunProjectionWrite decodes a run payload into projection columns.
// skip is true when the run lacks required IDs or its project is missing from newSnapshot.
func prepareRunProjectionWrite(payload string, projects map[string]Project, now string) (runProjectionWrite, bool, error) {
	var run Run
	if err := json.Unmarshal([]byte(payload), &run); err != nil {
		return runProjectionWrite{}, false, err
	}
	if run.ID == "" || run.ProjectID == "" {
		return runProjectionWrite{}, true, nil
	}
	if _, ok := projects[run.ProjectID]; !ok {
		return runProjectionWrite{}, true, nil
	}
	return runProjectionWrite{
		RunID:       run.ID,
		WorkspaceID: run.ProjectID,
		ThreadID:    nullString(run.ThreadID),
		Status:      firstNonEmpty(run.Status, "queued"),
		CreatedAt:   firstNonEmpty(run.CreatedAt, now),
		StartedAt:   nullString(run.StartedAt),
		FinishedAt:  nullString(run.FinishedAt),
		HubTaskID:   nullString(run.HubTaskID),
	}, false, nil
}

// artifactProjectionWrite holds pure columns for an edge_artifacts upsert.
type artifactProjectionWrite struct {
	ArtifactID            string
	WorkspaceID           string
	RunID                 string
	Kind                  string
	Path                  string
	CreatedAt             string
	UpdatedAt             string
	MetadataJSON          string
	ContentSourceKind     string
	ContentSourcePath     string
	ContentSourceReadable int
}

// prepareArtifactProjectionWrite decodes an artifactProjection payload into write columns.
func prepareArtifactProjectionWrite(payload, now string) (artifactProjectionWrite, bool, error) {
	var proj artifactProjection
	if err := json.Unmarshal([]byte(payload), &proj); err != nil {
		return artifactProjectionWrite{}, false, err
	}
	if proj.ArtifactID == "" || proj.RunID == "" || proj.WorkspaceID == "" {
		return artifactProjectionWrite{}, true, nil
	}
	createdAt := firstNonEmpty(proj.CreatedAt, now)
	return artifactProjectionWrite{
		ArtifactID:            proj.ArtifactID,
		WorkspaceID:           proj.WorkspaceID,
		RunID:                 proj.RunID,
		Kind:                  firstNonEmpty(proj.Kind, "file"),
		Path:                  proj.Path,
		CreatedAt:             createdAt,
		UpdatedAt:             firstNonEmpty(proj.UpdatedAt, createdAt),
		MetadataJSON:          proj.MetadataJSON,
		ContentSourceKind:     proj.ContentSourceKind,
		ContentSourcePath:     proj.ContentSourcePath,
		ContentSourceReadable: proj.ContentSourceReadable,
	}, false, nil
}

// diffProjectionWrite holds pure columns for an edge_diffs upsert.
type diffProjectionWrite struct {
	DiffID      string
	WorkspaceID string
	RunID       string
	SummaryJSON string
	PatchPath   string
	Status      string
	CreatedAt   string
	UpdatedAt   string
}

// prepareDiffProjectionWrite decodes a diffProjection payload into write columns.
func prepareDiffProjectionWrite(payload, now string) (diffProjectionWrite, bool, error) {
	var proj diffProjection
	if err := json.Unmarshal([]byte(payload), &proj); err != nil {
		return diffProjectionWrite{}, false, err
	}
	if proj.DiffID == "" || proj.RunID == "" || proj.WorkspaceID == "" {
		return diffProjectionWrite{}, true, nil
	}
	createdAt := firstNonEmpty(proj.CreatedAt, now)
	return diffProjectionWrite{
		DiffID:      proj.DiffID,
		WorkspaceID: proj.WorkspaceID,
		RunID:       proj.RunID,
		SummaryJSON: proj.SummaryJSON,
		PatchPath:   proj.PatchPath,
		Status:      firstNonEmpty(proj.Status, "modified"),
		CreatedAt:   createdAt,
		UpdatedAt:   firstNonEmpty(proj.UpdatedAt, createdAt),
	}, false, nil
}

// previewProjectionWrite holds pure columns for an edge_previews upsert.
type previewProjectionWrite struct {
	PreviewID   string
	WorkspaceID string
	RunID       string
	URL         string
	Status      string
	CreatedAt   string
	UpdatedAt   string
}

// preparePreviewProjectionWrite decodes a previewProjection payload into write columns.
func preparePreviewProjectionWrite(payload, now string) (previewProjectionWrite, bool, error) {
	var proj previewProjection
	if err := json.Unmarshal([]byte(payload), &proj); err != nil {
		return previewProjectionWrite{}, false, err
	}
	if proj.PreviewID == "" || proj.RunID == "" || proj.WorkspaceID == "" {
		return previewProjectionWrite{}, true, nil
	}
	createdAt := firstNonEmpty(proj.CreatedAt, now)
	return previewProjectionWrite{
		PreviewID:   proj.PreviewID,
		WorkspaceID: proj.WorkspaceID,
		RunID:       proj.RunID,
		URL:         proj.URL,
		Status:      firstNonEmpty(proj.Status, "created"),
		CreatedAt:   createdAt,
		UpdatedAt:   firstNonEmpty(proj.UpdatedAt, createdAt),
	}, false, nil
}

// relationalProjectionPayloads holds pure old/new JSON payload maps for all
// relational projection tables. SQL/tx orchestration stays in sqlite_store.go.
type relationalProjectionPayloads struct {
	OldWorkspaces map[string]string
	NewWorkspaces map[string]string
	OldRuns       map[string]string
	NewRuns       map[string]string
	OldArtifacts  map[string]string
	NewArtifacts  map[string]string
	OldDiffs      map[string]string
	NewDiffs      map[string]string
	OldPreviews   map[string]string
	NewPreviews   map[string]string
}

// buildRelationalProjectionPayloads marshals snapshot entities into projection
// payload maps used by deltaSQLiteRelationalProjection.
func buildRelationalProjectionPayloads(oldSnapshot, newSnapshot fileSnapshot) relationalProjectionPayloads {
	return relationalProjectionPayloads{
		OldWorkspaces: buildJSONPayloadMap(oldSnapshot.Projects),
		NewWorkspaces: buildJSONPayloadMap(newSnapshot.Projects),
		OldRuns:       buildJSONPayloadMap(oldSnapshot.Runs),
		NewRuns:       buildJSONPayloadMap(newSnapshot.Runs),
		OldArtifacts:  buildArtifactProjectionMap(oldSnapshot),
		NewArtifacts:  buildArtifactProjectionMap(newSnapshot),
		OldDiffs:      buildDiffProjectionMap(oldSnapshot),
		NewDiffs:      buildDiffProjectionMap(newSnapshot),
		OldPreviews:   buildPreviewProjectionMap(oldSnapshot),
		NewPreviews:   buildPreviewProjectionMap(newSnapshot),
	}
}
