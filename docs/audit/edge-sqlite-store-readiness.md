# Edge SQLite Store Readiness

> Date: 2026-06-09
> Worker: Edge storage worker
> Base: `origin/dev/delicious233` at `10815824`
> Scope: Edge durable SQLite store readiness and local contract smoke. No Hub, Web, Desktop, CLI adapter execution, mobile, or roadmap files were changed.

## Summary

The current Edge SQLite store is a readiness preview, not the production durable store.

What exists on the current dev branch plus this slice:

- `--store-backend sqlite --store-db <path>` opens `store.NewSQLite`.
- `SQLiteStore` wraps the in-memory `Store`, persists a full JSON snapshot to `agenthub_store_snapshots`, rewrites generic `agenthub_store_rows`, and rewrites relational projection tables after each successful write.
- Generic row restore exists: a SQLite database can restore projects, threads, runs, items, pins, diffs, artifacts, and previews from `agenthub_store_rows` when the snapshot is missing.
- Relational projection tables exist for owners, workspaces, runs, artifacts, diffs, and previews.
- `SQLiteReadiness(path)` reports applied migration version, `PRAGMA integrity_check`, generic row counts, and projection row counts for local smoke/preflight usage.
- Existing contract tests cover memory, file, and SQLite restore behavior; SQLite migration tests cover idempotent apply, rollback to snapshot-only schema, foreign keys, nested path creation, transient lock waiting, generic row restore, projection content, and per-write reopen readiness.

What is not proven:

- Production row-first relational CRUD authority for projects, threads, runs, items, pins, diffs, artifacts, or previews.
- Crash atomicity at each logical repository write beyond the current snapshot transaction.
- Multi-process writer safety beyond single-connection `SQLiteStore` usage.
- Production migration from JSON file store deployments to row-first SQLite tables.

Do not claim production durable store readiness from the current state. The current branch proves a snapshot-backed SQLite preview, generic row restore, read-model projection, and local readiness reporting only.

## Current Schema

Migration 1: `snapshot_store`

| Table | Purpose | Notes |
|---|---|---|
| `agenthub_store_snapshots` | Full JSON snapshot payload keyed by `default`. | Current source of restore truth for `SQLiteStore`. |

Migration 2: `relational_edge_lifecycle`

| Table | Purpose | Current write mode |
|---|---|---|
| `edge_owners` | Projection owner namespace. | Rewritten from the snapshot projection owner. |
| `edge_workspaces` | Project/workspace read model. | Rewritten from `Project` records. |
| `edge_runs` | Run read model. | Rewritten from `Run` records. |
| `edge_artifacts` | Artifact read model. | Rewritten from `Artifact` records. |
| `edge_diffs` | Diff read model. | Rewritten from `RunDiffFile` records. |
| `edge_previews` | Preview read model. | Rewritten from `Preview` records. |

Migration 3: `artifact_content_source_readiness`

| Table | Added columns | Purpose |
|---|---|---|
| `edge_artifacts` | `content_source_kind`, `content_source_path`, `content_source_readable` | Preserve redacted/safe artifact content source metadata in the relational projection. |

Migration 4: `row_first_store_contract`

| Table | Purpose | Current write mode |
|---|---|---|
| `agenthub_store_rows` | Generic per-kind repository row payloads with stable order indexes. | Rewritten from the in-memory snapshot after each successful write; used as restore fallback when the snapshot row is missing. |

## Migration Order

The migration order should remain append-only:

1. Keep migration 1 as the compatibility restore anchor.
2. Keep migration 2 as the first relational read-model schema.
3. Keep migration 3 as the artifact content-source extension.
4. Keep migration 4 as the generic row restore contract.
5. Add future production row-first durable migrations after version 4 only.
6. Preserve rollback to version 1 for preview deployments until production row-first migration has a tested export/import path.

Future row-first migrations should not delete `agenthub_store_snapshots` until a separate compatibility slice proves:

- Existing snapshot databases reopen successfully.
- Snapshot data can be backfilled into row tables without private path leakage.
- File-store JSON snapshots can be imported or explicitly rejected with a clear operator error.
- Rollback or backup instructions preserve the snapshot payload.

## Contract Tests To Keep

Existing tests that should remain required for any future SQLite store change:

| Test area | Current evidence |
|---|---|
| Repository lifecycle parity | `TestRepositoryContract` across memory, file, and SQLite. |
| Restore parity | `TestRepositoryContractSQLiteStoreRestore`. |
| Thread delete cascade | Contract subtest `thread_delete_cascade`. |
| Cleanup cascade | Contract subtest `cleanup_cascade`. |
| Evidence parity | Contract subtests `artifact_diff_preview_readonly` and `runtime_evidence_current`. |
| Migration apply | `TestSQLiteStoreAppliesRelationalMigrationPlan`. |
| Migration rollback | `TestRollbackSQLiteMigrationsReturnsToSnapshotOnlySchema`. |
| Migration idempotence | `TestSQLiteMigrationsAreIdempotentAcrossReopen`. |
| Foreign keys | `TestSQLiteForeignKeysAreEnabledForStoreConnections`. |
| Windows path creation | `TestSQLiteStoreCreatesNestedWindowsStylePath`. |
| Lock wait | `TestSQLiteStoreWaitsForTransientDatabaseLock`. |
| Projection content | `TestSQLiteProjectionWritesRunAndArtifactReadModel`. |
| Diff ID safety | `TestSQLiteProjectionDiffIDDoesNotCollideOnColonDelimitedRunAndPath`. |
| Generic row restore | `TestSQLiteStoreRestoresContractRowsWhenSnapshotIsMissing`. |
| Per-write local readiness | `TestSQLiteStoreReadinessRestoresAfterEachDurableWrite`. |

Add these before promoting SQLite to production durable store:

| Required test | Reason |
|---|---|
| File snapshot import into SQLite | Needed for deployments currently using `--store-file`. |
| Snapshot database backfill into row tables | Needed before relational tables become restore authority. |
| Per-method rollback on failed SQLite transaction | Current methods mutate memory first, then persist; row-first behavior must prove failed writes do not leave divergent memory/DB state. |
| Row-first relational CRUD tests | Needed before relational tables become production write authority instead of projection/readiness surfaces. |
| Corrupt snapshot handling with relational tables present | Needed for operator-safe recovery behavior. |
| Concurrent read/write contract under one process | Needed before local Edge uses SQLite as a long-lived operational store. |
| Schema version mismatch error | Needed for predictable downgrades or partially migrated databases. |

## Proposed Row-First Store Plan

Phase 0: keep current preview guarded.

- Keep explicit opt-in via `--store-backend sqlite`.
- Keep memory as the default when no persistence flags are set.
- Keep `--store-file` compatibility separate from `--store-db`.
- Document current state as snapshot-backed preview only.

Phase 1: add import/readiness utilities.

- Keep `SQLiteReadiness(path)` for no-server local smoke: migration version, integrity check, generic row counts, and projection counts.
- Add a no-server import helper that reads a `fileSnapshot` and writes `agenthub_store_snapshots` plus projection tables in one transaction.
- Add tests for file JSON -> SQLite snapshot import.
- Add schema version introspection suitable for an operator preflight.

Phase 2: introduce row-first write path behind an internal feature gate.

- Write projects, threads, runs, items, pins, diffs, artifacts, and previews directly to row tables inside transactions.
- Rebuild the in-memory cache from rows on open.
- Keep snapshot emission as compatibility backup until the row path is proven.
- Make each repository method return an error without mutating observable state when the DB transaction fails.

Phase 3: promote row tables to restore authority.

- Read from row tables first.
- Use the snapshot only as legacy fallback or backup export.
- Add explicit migration state to prevent older binaries from opening newer row-first databases without a clear error.

Phase 4: operator migration.

- Provide backup, integrity check, import, and smoke-test commands.
- Require `PRAGMA integrity_check`, migration-version output, and a reopen smoke before switching an operator profile from file store to SQLite.

## Blockers For Production Durable Store Readiness

1. Current `SQLiteStore` primary restore authority is still `agenthub_store_snapshots`; generic rows are a tested fallback, and relational tables are still projections.
2. Current write methods call the in-memory store first and persist afterward, so failed persistence can leave memory and SQLite divergent during the process lifetime.
3. Generic rows and relational tables are deleted and rebuilt on each persist; they are not production row-first CRUD yet.
4. There is no file-store import path or operator migration command.
5. There is no schema downgrade/version-mismatch policy beyond rollback helper tests.
6. There is no proved multi-process writer model.
7. P1 remote-control evidence work should not be mixed with row-level persistence changes.

## Current Safe Slice Completed

This slice adds a local readiness helper and a focused SQLite contract smoke:

- `SQLiteReadiness(path)` reports migration version, integrity check, generic row counts, and projection counts.
- `TestSQLiteStoreReadinessRestoresAfterEachDurableWrite` reopens after each key write boundary: project, thread, run status, replay item, pin, file-change diff, artifact content source, and preview.
- The slice remains fixture-only and local-temp-DB-only. It does not make a production durable-store claim.

## Non-Goals

- No Hub, Web, Desktop, CLI adapter execution, mobile, or roadmap changes.
- No real CLI/model execution.
- No public deploy or runtime configuration change.
- No conversion from snapshot-backed SQLite preview to row-first durable store.
- No migration of existing operator data.
