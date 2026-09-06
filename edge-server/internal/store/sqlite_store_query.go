package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

// sqlite_store_query.go holds pure snapshot/delta helpers extracted from
// sqlite_store.go. No *sql.DB / *sql.Tx / IO ownership.
// Projection builders/finalize helpers live in companion files under the same package.

// sqliteRowUpsert is a pure delta selection result for one store row.
type sqliteRowUpsert struct {
	ID      string
	Payload string
	Index   int
}

func applySQLiteRow(snapshot *fileSnapshot, kind, id, payload string) error {
	switch kind {
	case sqliteRowKindProject:
		return applySQLiteEntityRow(&snapshot.Projects, &snapshot.ProjectOrder, id, payload, "project")
	case sqliteRowKindThread:
		return applySQLiteEntityRow(&snapshot.Threads, &snapshot.ThreadOrder, id, payload, "thread")
	case sqliteRowKindRun:
		return applySQLiteEntityRow(&snapshot.Runs, &snapshot.RunOrder, id, payload, "run")
	case sqliteRowKindItem:
		return applySQLiteEntityRow(&snapshot.Items, &snapshot.ItemOrder, id, payload, "item")
	case sqliteRowKindPin:
		return applySQLiteEntityRow(&snapshot.Pins, &snapshot.PinOrder, id, payload, "pin")
	case sqliteRowKindDiff:
		return applySQLiteEntityRow(&snapshot.Diffs, &snapshot.DiffOrder, id, payload, "diff")
	case sqliteRowKindArtifact:
		return applySQLiteEntityRow(&snapshot.Artifacts, &snapshot.ArtifactOrder, id, payload, "artifact")
	case sqliteRowKindPreview:
		return applySQLiteEntityRow(&snapshot.Previews, &snapshot.PreviewOrder, id, payload, "preview")
	case sqliteRowKindAgentProfile:
		return applySQLiteEntityRow(&snapshot.AgentProfiles, &snapshot.AgentProfileOrder, id, payload, "agent_profile")
	case sqliteRowKindUserProfile:
		return applySQLiteEntityRow(&snapshot.UserProfiles, &snapshot.UserProfileOrder, id, payload, "user_profile")
	case sqliteRowKindSettings:
		var row sqliteSettingsRow
		if err := decodeSQLiteRowPayload(payload, &row); err != nil {
			return fmt.Errorf("decode sqlite settings row %s: %w", id, err)
		}
		if row.Values == nil {
			row.Values = map[string]string{}
		}
		snapshot.Settings = row.Values
		snapshot.SettingsMtime = row.Mtime
		return nil
	case sqliteRowKindCheckpoint:
		// Checkpoints are an unordered map; the row-order list is discarded.
		var discardedOrder []string
		return applySQLiteEntityRow(&snapshot.Checkpoints, &discardedOrder, id, payload, "checkpoint")
	default:
		return fmt.Errorf("unknown sqlite store row kind %s", kind)
	}
}

// sqliteSettingsRow is the single-row encoding of user settings in
// agenthub_store_rows (kind "settings", row_id sqliteSnapshotKey). The row is
// always kept once written — even for empty settings — so its presence can
// serve as the "rows layer is post-migration" marker during load.
type sqliteSettingsRow struct {
	Values map[string]string `json:"values"`
	Mtime  string            `json:"mtime"`
}

// applySQLiteEntityRow decodes one row payload, upserts it into the snapshot map,
// and appends the id to the row-kind order list.
func applySQLiteEntityRow[V any](items *map[string]V, order *[]string, id, payload, kindLabel string) error {
	var value V
	if err := decodeSQLiteRowPayload(payload, &value); err != nil {
		return fmt.Errorf("decode sqlite %s row %s: %w", kindLabel, id, err)
	}
	if *items == nil {
		*items = map[string]V{}
	}
	(*items)[id] = value
	*order = append(*order, id)
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

func cloneFileSnapshot(snapshot fileSnapshot) fileSnapshot {
	cloned := fileSnapshot{
		Projects:          copyMap(snapshot.Projects),
		Threads:           copyMap(snapshot.Threads),
		Runs:              copyMap(snapshot.Runs),
		Items:             copyMap(snapshot.Items),
		Pins:              copyMap(snapshot.Pins),
		Diffs:             copyMap(snapshot.Diffs),
		Artifacts:         cloneArtifactMap(snapshot.Artifacts),
		Checkpoints:       cloneCheckpointMap(snapshot.Checkpoints),
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

// isBlankSQLiteSnapshotPayload reports whether a legacy snapshot payload is empty.
func isBlankSQLiteSnapshotPayload(payload string) bool {
	return strings.TrimSpace(payload) == ""
}

// decodeSQLiteSnapshotPayload decodes a full fileSnapshot JSON blob and rejects trailing data.
func decodeSQLiteSnapshotPayload(payload string) (fileSnapshot, error) {
	var snapshot fileSnapshot
	decoder := json.NewDecoder(strings.NewReader(payload))
	if err := decoder.Decode(&snapshot); err != nil {
		return fileSnapshot{}, err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fileSnapshot{}, errors.New("trailing data")
	}
	return snapshot, nil
}

// encodeSQLiteSnapshotPayload marshals a snapshot for the agenthub_store_snapshots table.
func encodeSQLiteSnapshotPayload(snapshot fileSnapshot) ([]byte, error) {
	return json.Marshal(snapshot)
}
