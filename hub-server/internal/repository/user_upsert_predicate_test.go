package repository

import (
	"os"
	"strings"
	"testing"
)

// TestTokenDanceSubPredicateSSOT pins every copy of the partial-index predicate
// that PostgreSQL matches *syntactically* when it infers the ON CONFLICT
// arbiter for FindOrCreateByTokenDanceSub.
//
// Why a text pin and not just a behavioural test: the failure mode is invisible
// to SQLite. A fixture that creates a plain (non-partial) unique index lets an
// unqualified ON CONFLICT (tokendance_sub) infer happily, so the whole L0 suite
// stays green while the identical statement fails on PostgreSQL with 42P10 on
// every OIDC login. That is exactly how this shipped. The files below are the
// four places whose text must agree with tokenDanceSubIndexPredicate.
func TestTokenDanceSubPredicateSSOT(t *testing.T) {
	anchors := []struct {
		name string
		path string
	}{
		// Production DDL — the definition PostgreSQL actually infers against.
		{"migration 0020", "../../migrations/0020_token_dance_sub.up.sql"},
		// The model tag AutoMigrate uses; it must describe the same index.
		{"model.User gorm tag", "../model/user.go"},
		// SQLite fixtures. If any of these drops the predicate it silently
		// re-masks the inference requirement above.
		{"fixture repository_test.go", "repository_test.go"},
		{"fixture upsert_toctou_test.go", "upsert_toctou_test.go"},
		{"fixture service/oidc/oidc_test.go", "../service/oidc/oidc_test.go"},
		{"fixture tests/integration/tokendance_oidc_e2e_test.go", "../../tests/integration/tokendance_oidc_e2e_test.go"},
	}

	for _, anchor := range anchors {
		raw, err := os.ReadFile(anchor.path)
		if err != nil {
			t.Fatalf("read %s (%s): %v", anchor.path, anchor.name, err)
		}
		if !strings.Contains(string(raw), tokenDanceSubIndexPredicate) {
			t.Errorf("%s (%s) no longer contains the predicate %q; the ON CONFLICT arbiter inference in FindOrCreateByTokenDanceSub depends on all of these agreeing, and SQLite will not tell you when they stop",
				anchor.name, anchor.path, tokenDanceSubIndexPredicate)
		}
	}
}
