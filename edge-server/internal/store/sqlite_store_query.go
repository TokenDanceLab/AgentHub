package store

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

// sqlite_store_query.go holds pure snapshot/delta helpers extracted from
// sqlite_store.go. No *sql.DB / *sql.Tx / IO ownership.

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

// sqliteRowUpsert is a pure delta selection result for one store row.
type sqliteRowUpsert struct {
	ID      string
	Payload string
	Index   int
}

func applySQLiteRow(snapshot *fileSnapshot, kind, id, payload string) error {
	switch kind {
	case sqliteRowKindProject:
		var value Project
		if err := decodeSQLiteRowPayload(payload, &value); err != nil {
			return fmt.Errorf("decode sqlite project row %s: %w", id, err)
		}
		if snapshot.Projects == nil {
			snapshot.Projects = map[string]Project{}
		}
		snapshot.Projects[id] = value
		snapshot.ProjectOrder = append(snapshot.ProjectOrder, id)
	case sqliteRowKindThread:
		var value Thread
		if err := decodeSQLiteRowPayload(payload, &value); err != nil {
			return fmt.Errorf("decode sqlite thread row %s: %w", id, err)
		}
		if snapshot.Threads == nil {
			snapshot.Threads = map[string]Thread{}
		}
		snapshot.Threads[id] = value
		snapshot.ThreadOrder = append(snapshot.ThreadOrder, id)
	case sqliteRowKindRun:
		var value Run
		if err := decodeSQLiteRowPayload(payload, &value); err != nil {
			return fmt.Errorf("decode sqlite run row %s: %w", id, err)
		}
		if snapshot.Runs == nil {
			snapshot.Runs = map[string]Run{}
		}
		snapshot.Runs[id] = value
		snapshot.RunOrder = append(snapshot.RunOrder, id)
	case sqliteRowKindItem:
		var value Item
		if err := decodeSQLiteRowPayload(payload, &value); err != nil {
			return fmt.Errorf("decode sqlite item row %s: %w", id, err)
		}
		if snapshot.Items == nil {
			snapshot.Items = map[string]Item{}
		}
		snapshot.Items[id] = value
		snapshot.ItemOrder = append(snapshot.ItemOrder, id)
	case sqliteRowKindPin:
		var value ThreadPin
		if err := decodeSQLiteRowPayload(payload, &value); err != nil {
			return fmt.Errorf("decode sqlite pin row %s: %w", id, err)
		}
		if snapshot.Pins == nil {
			snapshot.Pins = map[string]ThreadPin{}
		}
		snapshot.Pins[id] = value
		snapshot.PinOrder = append(snapshot.PinOrder, id)
	case sqliteRowKindDiff:
		var value RunDiffFile
		if err := decodeSQLiteRowPayload(payload, &value); err != nil {
			return fmt.Errorf("decode sqlite diff row %s: %w", id, err)
		}
		if snapshot.Diffs == nil {
			snapshot.Diffs = map[string]RunDiffFile{}
		}
		snapshot.Diffs[id] = value
		snapshot.DiffOrder = append(snapshot.DiffOrder, id)
	case sqliteRowKindArtifact:
		var value Artifact
		if err := decodeSQLiteRowPayload(payload, &value); err != nil {
			return fmt.Errorf("decode sqlite artifact row %s: %w", id, err)
		}
		if snapshot.Artifacts == nil {
			snapshot.Artifacts = map[string]Artifact{}
		}
		snapshot.Artifacts[id] = value
		snapshot.ArtifactOrder = append(snapshot.ArtifactOrder, id)
	case sqliteRowKindPreview:
		var value Preview
		if err := decodeSQLiteRowPayload(payload, &value); err != nil {
			return fmt.Errorf("decode sqlite preview row %s: %w", id, err)
		}
		if snapshot.Previews == nil {
			snapshot.Previews = map[string]Preview{}
		}
		snapshot.Previews[id] = value
		snapshot.PreviewOrder = append(snapshot.PreviewOrder, id)
	case sqliteRowKindAgentProfile:
		var value AgentProfile
		if err := decodeSQLiteRowPayload(payload, &value); err != nil {
			return fmt.Errorf("decode sqlite agent_profile row %s: %w", id, err)
		}
		if snapshot.AgentProfiles == nil {
			snapshot.AgentProfiles = map[string]AgentProfile{}
		}
		snapshot.AgentProfiles[id] = value
		snapshot.AgentProfileOrder = append(snapshot.AgentProfileOrder, id)
	case sqliteRowKindUserProfile:
		var value UserProfile
		if err := decodeSQLiteRowPayload(payload, &value); err != nil {
			return fmt.Errorf("decode sqlite user_profile row %s: %w", id, err)
		}
		if snapshot.UserProfiles == nil {
			snapshot.UserProfiles = map[string]UserProfile{}
		}
		snapshot.UserProfiles[id] = value
		snapshot.UserProfileOrder = append(snapshot.UserProfileOrder, id)
	default:
		return fmt.Errorf("unknown sqlite store row kind %s", kind)
	}
	return nil
}

func decodeSQLiteRowPayload(payload string, value any) error {
	decoder := json.NewDecoder(strings.NewReader(payload))
	if err := decoder.Decode(value); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("trailing data")
	}
	return nil
}

// selectSQLiteRowDeltas computes pure insert/update/delete selection for one row kind.
func selectSQLiteRowDeltas[V any](oldOrder []string, oldMap map[string]V, newOrder []string, newMap map[string]V) ([]sqliteRowUpsert, []string, error) {
	oldOrderNorm := normalizeOrder(oldOrder, oldMap)
	newOrderNorm := normalizeOrder(newOrder, newMap)

	oldPayloads := make(map[string]string, len(oldMap))
	oldIndexes := make(map[string]int, len(oldOrderNorm))
	for i, id := range oldOrderNorm {
		payload, err := json.Marshal(oldMap[id])
		if err != nil {
			return nil, nil, fmt.Errorf("encode old row %s: %w", id, err)
		}
		oldPayloads[id] = string(payload)
		oldIndexes[id] = i
	}

	newPayloads := make(map[string]string, len(newMap))
	newIndexes := make(map[string]int, len(newOrderNorm))
	for i, id := range newOrderNorm {
		payload, err := json.Marshal(newMap[id])
		if err != nil {
			return nil, nil, fmt.Errorf("encode new row %s: %w", id, err)
		}
		newPayloads[id] = string(payload)
		newIndexes[id] = i
	}

	upserts := make([]sqliteRowUpsert, 0, len(newPayloads))
	for id, newPayload := range newPayloads {
		oldPayload, existed := oldPayloads[id]
		oldIdx, oldIdxExists := oldIndexes[id]
		newIdx := newIndexes[id]
		if existed && oldPayload == newPayload && oldIdxExists && oldIdx == newIdx {
			continue
		}
		upserts = append(upserts, sqliteRowUpsert{
			ID:      id,
			Payload: newPayload,
			Index:   newIdx,
		})
	}

	deletes := make([]string, 0)
	for id := range oldPayloads {
		if _, ok := newPayloads[id]; !ok {
			deletes = append(deletes, id)
		}
	}
	return upserts, deletes, nil
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

func cloneFileSnapshot(snapshot fileSnapshot) fileSnapshot {
	cloned := fileSnapshot{
		Projects:          copyMap(snapshot.Projects),
		Threads:           copyMap(snapshot.Threads),
		Runs:              copyMap(snapshot.Runs),
		Items:             copyMap(snapshot.Items),
		Pins:              copyMap(snapshot.Pins),
		Diffs:             copyMap(snapshot.Diffs),
		Artifacts:         cloneArtifactMap(snapshot.Artifacts),
		Previews:          copyMap(snapshot.Previews),
		UserProfiles:      copyMap(snapshot.UserProfiles),
		AgentProfiles:     copyMap(snapshot.AgentProfiles),
		ProjectOrder:      append([]string(nil), snapshot.ProjectOrder...),
		ThreadOrder:       append([]string(nil), snapshot.ThreadOrder...),
		RunOrder:          append([]string(nil), snapshot.RunOrder...),
		ItemOrder:         append([]string(nil), snapshot.ItemOrder...),
		PinOrder:          append([]string(nil), snapshot.PinOrder...),
		DiffOrder:         append([]string(nil), snapshot.DiffOrder...),
		ArtifactOrder:     append([]string(nil), snapshot.ArtifactOrder...),
		PreviewOrder:      append([]string(nil), snapshot.PreviewOrder...),
		UserProfileOrder:  append([]string(nil), snapshot.UserProfileOrder...),
		AgentProfileOrder: append([]string(nil), snapshot.AgentProfileOrder...),
		Settings:          copyMap(snapshot.Settings),
		SettingsMtime:     snapshot.SettingsMtime,
	}
	return cloned
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
