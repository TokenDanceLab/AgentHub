package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
)

// sqlite_store_pure.go holds package-level helper functions peeled from
// sqlite_store.go (#1069). These functions have no *SQLiteStore receiver
// dependency and are called by the stateful methods that remain in
// sqlite_store.go. DB/tx/file parameters belong to the caller; this file
// does not own *sql.DB lifecycle.

func loadSQLiteRows(db *sql.DB) (fileSnapshot, bool, error) {
	rows, err := db.Query(`SELECT row_kind, row_id, payload FROM agenthub_store_rows ORDER BY row_kind, order_index, row_id`)
	if err != nil {
		return fileSnapshot{}, false, fmt.Errorf("read sqlite store rows: %w", err)
	}
	defer rows.Close()

	var snapshot fileSnapshot
	loaded := false
	for rows.Next() {
		var kind, id, payload string
		if err := rows.Scan(&kind, &id, &payload); err != nil {
			return fileSnapshot{}, false, fmt.Errorf("scan sqlite store row: %w", err)
		}
		loaded = true
		if err := applySQLiteRow(&snapshot, kind, id, payload); err != nil {
			return fileSnapshot{}, false, err
		}
	}
	if err := rows.Err(); err != nil {
		return fileSnapshot{}, false, fmt.Errorf("iterate sqlite store rows: %w", err)
	}
	return snapshot, loaded, nil
}

func deltaSQLiteRows(tx *sql.Tx, oldSnapshot, newSnapshot fileSnapshot) error {
	now := nowString()
	if err := deltaRowsOfKind(tx, sqliteRowKindProject, oldSnapshot.ProjectOrder, oldSnapshot.Projects, newSnapshot.ProjectOrder, newSnapshot.Projects, now); err != nil {
		return err
	}
	if err := deltaRowsOfKind(tx, sqliteRowKindThread, oldSnapshot.ThreadOrder, oldSnapshot.Threads, newSnapshot.ThreadOrder, newSnapshot.Threads, now); err != nil {
		return err
	}
	if err := deltaRowsOfKind(tx, sqliteRowKindRun, oldSnapshot.RunOrder, oldSnapshot.Runs, newSnapshot.RunOrder, newSnapshot.Runs, now); err != nil {
		return err
	}
	if err := deltaRowsOfKind(tx, sqliteRowKindItem, oldSnapshot.ItemOrder, oldSnapshot.Items, newSnapshot.ItemOrder, newSnapshot.Items, now); err != nil {
		return err
	}
	if err := deltaRowsOfKind(tx, sqliteRowKindPin, oldSnapshot.PinOrder, oldSnapshot.Pins, newSnapshot.PinOrder, newSnapshot.Pins, now); err != nil {
		return err
	}
	if err := deltaRowsOfKind(tx, sqliteRowKindDiff, oldSnapshot.DiffOrder, oldSnapshot.Diffs, newSnapshot.DiffOrder, newSnapshot.Diffs, now); err != nil {
		return err
	}
	if err := deltaRowsOfKind(tx, sqliteRowKindArtifact, oldSnapshot.ArtifactOrder, oldSnapshot.Artifacts, newSnapshot.ArtifactOrder, newSnapshot.Artifacts, now); err != nil {
		return err
	}
	if err := deltaRowsOfKind(tx, sqliteRowKindPreview, oldSnapshot.PreviewOrder, oldSnapshot.Previews, newSnapshot.PreviewOrder, newSnapshot.Previews, now); err != nil {
		return err
	}
	if err := deltaRowsOfKind(tx, sqliteRowKindAgentProfile, oldSnapshot.AgentProfileOrder, oldSnapshot.AgentProfiles, newSnapshot.AgentProfileOrder, newSnapshot.AgentProfiles, now); err != nil {
		return err
	}
	if err := deltaRowsOfKind(tx, sqliteRowKindUserProfile, oldSnapshot.UserProfileOrder, oldSnapshot.UserProfiles, newSnapshot.UserProfileOrder, newSnapshot.UserProfiles, now); err != nil {
		return err
	}
	return nil
}

func deltaRowsOfKind[V any](tx *sql.Tx, kind string, oldOrder []string, oldMap map[string]V, newOrder []string, newMap map[string]V, updatedAt string) error {
	upserts, deletes, err := selectSQLiteRowDeltas(oldOrder, oldMap, newOrder, newMap)
	if err != nil {
		return fmt.Errorf("%s: %w", kind, err)
	}

	for _, upsert := range upserts {
		if _, err := tx.Exec(
			`INSERT INTO agenthub_store_rows (row_kind, row_id, payload, order_index, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(row_kind, row_id) DO UPDATE SET payload = excluded.payload, order_index = excluded.order_index, updated_at = excluded.updated_at`,
			kind, upsert.ID, upsert.Payload, upsert.Index, updatedAt,
		); err != nil {
			return fmt.Errorf("write %s row %s: %w", kind, upsert.ID, err)
		}
	}

	for _, id := range deletes {
		if _, err := tx.Exec(`DELETE FROM agenthub_store_rows WHERE row_kind = ? AND row_id = ?`, kind, id); err != nil {
			return fmt.Errorf("delete %s row %s: %w", kind, id, err)
		}
	}

	return nil
}

func deltaSQLiteRelationalProjection(tx *sql.Tx, oldSnapshot, newSnapshot fileSnapshot) error {
	now := nowString()
	payloads := buildRelationalProjectionPayloads(oldSnapshot, newSnapshot)

	if _, err := tx.Exec(
		`INSERT INTO edge_owners (owner_id, source, display_name, created_at, updated_at)
VALUES (?, 'snapshot', 'AgentHub snapshot projection', ?, ?)
ON CONFLICT(owner_id) DO UPDATE SET updated_at = excluded.updated_at`,
		sqliteProjectionOwnerID, now, now,
	); err != nil {
		return fmt.Errorf("project owner: %w", err)
	}

	if err := deltaProjectionMap("edge_workspaces", "workspace_id",
		payloads.OldWorkspaces, payloads.NewWorkspaces,
		func(id string, payload string) error {
			write, skip, err := prepareWorkspaceProjectionWrite(payload, now)
			if err != nil {
				return err
			}
			if skip {
				return nil
			}
			_, err = tx.Exec(
				`INSERT INTO edge_workspaces (workspace_id, owner_id, local_path, name, status, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(workspace_id) DO UPDATE SET owner_id = excluded.owner_id, local_path = excluded.local_path, name = excluded.name, status = excluded.status, created_at = excluded.created_at, updated_at = excluded.updated_at`,
				write.WorkspaceID, sqliteProjectionOwnerID, write.LocalPath, write.Name, write.Status, write.CreatedAt, write.UpdatedAt,
			)
			return err
		},
		func(id string) error {
			_, err := tx.Exec(`DELETE FROM edge_workspaces WHERE workspace_id = ?`, id)
			return err
		},
	); err != nil {
		return fmt.Errorf("project workspace delta: %w", err)
	}

	if err := deltaProjectionMap("edge_runs", "run_id",
		payloads.OldRuns, payloads.NewRuns,
		func(id string, payload string) error {
			write, skip, err := prepareRunProjectionWrite(payload, newSnapshot.Projects, now)
			if err != nil {
				return err
			}
			if skip {
				return nil
			}
			_, err = tx.Exec(
				`INSERT INTO edge_runs (run_id, owner_id, workspace_id, thread_id, status, created_at, started_at, finished_at, hub_task_id, metadata_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')
ON CONFLICT(run_id) DO UPDATE SET owner_id = excluded.owner_id, workspace_id = excluded.workspace_id, thread_id = excluded.thread_id, status = excluded.status, created_at = excluded.created_at, started_at = excluded.started_at, finished_at = excluded.finished_at, hub_task_id = excluded.hub_task_id, metadata_json = excluded.metadata_json`,
				write.RunID, sqliteProjectionOwnerID, write.WorkspaceID, write.ThreadID,
				write.Status, write.CreatedAt, write.StartedAt, write.FinishedAt, write.HubTaskID,
			)
			return err
		},
		func(id string) error {
			_, err := tx.Exec(`DELETE FROM edge_runs WHERE run_id = ?`, id)
			return err
		},
	); err != nil {
		return fmt.Errorf("run delta: %w", err)
	}

	if err := deltaProjectionMap("edge_artifacts", "artifact_id",
		payloads.OldArtifacts, payloads.NewArtifacts,
		func(id string, payload string) error {
			write, skip, err := prepareArtifactProjectionWrite(payload, now)
			if err != nil {
				return err
			}
			if skip {
				return nil
			}
			_, err = tx.Exec(
				`INSERT INTO edge_artifacts (artifact_id, owner_id, workspace_id, run_id, kind, path, status, created_at, updated_at, metadata_json, content_source_kind, content_source_path, content_source_readable)
VALUES (?, ?, ?, ?, ?, ?, 'created', ?, ?, ?, ?, ?, ?)
ON CONFLICT(artifact_id) DO UPDATE SET owner_id = excluded.owner_id, workspace_id = excluded.workspace_id, run_id = excluded.run_id, kind = excluded.kind, path = excluded.path, status = excluded.status, created_at = excluded.created_at, updated_at = excluded.updated_at, metadata_json = excluded.metadata_json, content_source_kind = excluded.content_source_kind, content_source_path = excluded.content_source_path, content_source_readable = excluded.content_source_readable`,
				write.ArtifactID, sqliteProjectionOwnerID, write.WorkspaceID, write.RunID,
				write.Kind, write.Path, write.CreatedAt, write.UpdatedAt,
				write.MetadataJSON, write.ContentSourceKind, write.ContentSourcePath, write.ContentSourceReadable,
			)
			return err
		},
		func(id string) error {
			_, err := tx.Exec(`DELETE FROM edge_artifacts WHERE artifact_id = ?`, id)
			return err
		},
	); err != nil {
		return fmt.Errorf("artifact delta: %w", err)
	}

	if err := deltaProjectionMap("edge_diffs", "diff_id",
		payloads.OldDiffs, payloads.NewDiffs,
		func(id string, payload string) error {
			write, skip, err := prepareDiffProjectionWrite(payload, now)
			if err != nil {
				return err
			}
			if skip {
				return nil
			}
			_, err = tx.Exec(
				`INSERT INTO edge_diffs (diff_id, owner_id, workspace_id, run_id, summary_json, patch_path, status, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(diff_id) DO UPDATE SET owner_id = excluded.owner_id, workspace_id = excluded.workspace_id, run_id = excluded.run_id, summary_json = excluded.summary_json, patch_path = excluded.patch_path, status = excluded.status, created_at = excluded.created_at, updated_at = excluded.updated_at`,
				write.DiffID, sqliteProjectionOwnerID, write.WorkspaceID, write.RunID,
				write.SummaryJSON, write.PatchPath, write.Status,
				write.CreatedAt, write.UpdatedAt,
			)
			return err
		},
		func(id string) error {
			_, err := tx.Exec(`DELETE FROM edge_diffs WHERE diff_id = ?`, id)
			return err
		},
	); err != nil {
		return fmt.Errorf("diff delta: %w", err)
	}

	if err := deltaProjectionMap("edge_previews", "preview_id",
		payloads.OldPreviews, payloads.NewPreviews,
		func(id string, payload string) error {
			write, skip, err := preparePreviewProjectionWrite(payload, now)
			if err != nil {
				return err
			}
			if skip {
				return nil
			}
			_, err = tx.Exec(
				`INSERT INTO edge_previews (preview_id, owner_id, workspace_id, run_id, url, status, created_at, updated_at, metadata_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}')
ON CONFLICT(preview_id) DO UPDATE SET owner_id = excluded.owner_id, workspace_id = excluded.workspace_id, run_id = excluded.run_id, url = excluded.url, status = excluded.status, created_at = excluded.created_at, updated_at = excluded.updated_at, metadata_json = excluded.metadata_json`,
				write.PreviewID, sqliteProjectionOwnerID, write.WorkspaceID, write.RunID,
				write.URL, write.Status, write.CreatedAt, write.UpdatedAt,
			)
			return err
		},
		func(id string) error {
			_, err := tx.Exec(`DELETE FROM edge_previews WHERE preview_id = ?`, id)
			return err
		},
	); err != nil {
		return fmt.Errorf("preview delta: %w", err)
	}

	return nil
}

func ensureSQLiteDirectory(path string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return fmt.Errorf("create sqlite store directory: %w", err)
	}
	info, err := os.Stat(dir)
	if err != nil {
		return fmt.Errorf("stat sqlite store directory: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("create sqlite store directory: %s is not a directory", dir)
	}
	return nil
}
