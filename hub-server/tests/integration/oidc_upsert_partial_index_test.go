//go:build integration

package integration

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// OIDC user provisioning against real PostgreSQL (#2154).
//
// Migration 0020 creates idx_users_tokendance_sub as a *partial* unique index
// (WHERE tokendance_sub IS NOT NULL AND tokendance_sub != ''), and model.User
// declares the very same predicate in its gorm tag. An INSERT … ON CONFLICT
// (tokendance_sub) that does not carry the matching index predicate cannot
// infer a partial index, and PostgreSQL rejects it at plan time:
//
//	42P10: there is no unique or exclusion constraint matching the ON CONFLICT
//	       specification   (infer_arbiter_indexes, plancat.c)
//
// The sqlite fixtures never showed this: three of them hand-create a
// *non*-partial unique index on tokendance_sub, which is exactly the shape the
// unqualified ON CONFLICT clause can infer. The result was that the only
// provisioning path of the OIDC login (service/oidc.go →
// repository.FindOrCreateByTokenDanceSub) was broken on the single database
// engine production runs, while every gate stayed green.
//
// Confirmed against the dev stack's PG16 with EXPLAIN (which plans without
// executing, so the probe wrote nothing — the dev database holds 0 users and
// still holds 0 after the probe):
//
//	probe A  ON CONFLICT (tokendance_sub)                  → ERROR 42P10
//	probe B  ON CONFLICT (tokendance_sub) WHERE <predicate> → plan, arbiter idx_users_tokendance_sub
//
// Running this file against that database then exposed a *second*, independent
// defect in the same statement: the DO UPDATE assignments read `ELSE nickname`
// and `ELSE avatar_url` unqualified, and inside DO UPDATE both the target table
// and the EXCLUDED pseudo-row carry those columns, so PostgreSQL rejects the
// statement with 42702 (column reference is ambiguous) before arbiter inference
// is ever reached. Both defects had to be fixed for OIDC provisioning to work
// on PostgreSQL at all.
//
// This file is the L1 pin: it runs the real repository function against a
// freshly migrated ephemeral PostgreSQL, so arbiter inference is exercised by
// the production DDL instead of by a fixture's approximation of it.

func TestFindOrCreateByTokenDanceSub_RealPG_UpsertsThroughPartialIndex(t *testing.T) {
	db, cleanup := openTempMigratedDB(t)
	t.Cleanup(cleanup)

	sub := fmt.Sprintf("td-sub-%d", time.Now().UnixNano())

	// First login: no row for this sub exists yet, so the INSERT branch runs.
	created, err := repository.FindOrCreateByTokenDanceSub(db, sub, "Alice", "https://id.example.invalid/alice.png")
	require.NoError(t, err,
		"provisioning a new OIDC user must infer the partial unique index (a 42P10 here means the ON CONFLICT clause lost its index predicate)")
	require.NotEmpty(t, created.ID)
	require.Equal(t, "Alice", created.Nickname)
	require.Equal(t, "https://id.example.invalid/alice.png", created.AvatarURL)
	require.NotNil(t, created.TokenDanceSub)
	require.Equal(t, sub, *created.TokenDanceSub)
	require.NotNil(t, created.TokenDanceSubLinkedAt)

	// Second login, same sub: the conflict branch runs and must refresh claims
	// on the *same* row.
	refreshed, err := repository.FindOrCreateByTokenDanceSub(db, sub, "Alice Renamed", "")
	require.NoError(t, err, "the conflict path must infer the same partial index")
	require.Equal(t, created.ID, refreshed.ID, "one sub must resolve to exactly one Hub user")
	require.Equal(t, "Alice Renamed", refreshed.Nickname)
	require.Equal(t, "https://id.example.invalid/alice.png", refreshed.AvatarURL,
		"an empty incoming claim must not wipe the stored avatar")

	var linked int64
	require.NoError(t, db.Model(&model.User{}).Where("tokendance_sub = ?", sub).Count(&linked).Error)
	require.EqualValues(t, 1, linked, "the upsert must not append a second row for the same sub")
}

// TestUsersWithoutTokenDanceSub_RealPG_DoNotCollide pins *why* the index is
// partial. Username/password users carry no tokendance_sub, and a non-partial
// unique index would make the second such user collide with the first on a NULL
// sub and on an empty-string sub. Any "fix" that widens the index instead of
// narrowing the ON
// CONFLICT clause therefore breaks here — and would also need a migration it
// cannot justify.
func TestUsersWithoutTokenDanceSub_RealPG_DoNotCollide(t *testing.T) {
	db, cleanup := openTempMigratedDB(t)
	t.Cleanup(cleanup)

	empty := ""
	for _, u := range []model.User{
		{Username: "local-null-a", Nickname: "A"},
		{Username: "local-null-b", Nickname: "B"},
		{Username: "local-empty-a", Nickname: "C", TokenDanceSub: &empty},
		{Username: "local-empty-b", Nickname: "D", TokenDanceSub: &empty},
	} {
		row := u
		require.NoError(t, db.Create(&row).Error,
			"users outside the partial index (NULL or empty tokendance_sub) must not collide with each other")
	}

	var total int64
	require.NoError(t, db.Model(&model.User{}).Where("username LIKE ?", "local-%").Count(&total).Error)
	require.EqualValues(t, 4, total,
		"all four users outside the partial index must coexist (the temp DB also holds migration-seeded rows, hence the username filter)")
}
