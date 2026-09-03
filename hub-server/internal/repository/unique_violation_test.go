package repository

import (
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"gorm.io/gorm"
)

// TestIsUniqueViolation_StructuredPriority pins the tier order of the single
// implementation: a Postgres wire error is decided by its SQLSTATE, a GORM
// translated error by its sentinel, and only a bare untyped error falls
// through to text. Each case below is only decidable by the tier named in it —
// the message text is deliberately chosen so the substring tier would answer
// differently, which is what makes the tier order observable rather than
// decorative (#2244 slice 1).
func TestIsUniqueViolation_StructuredPriority(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{
			// 23505 with a message the substring tier could never match:
			// only SQLSTATE can decide this one.
			name: "sqlstate 23505 with non-matching message text",
			err:  &pgconn.PgError{Severity: "ERROR", Code: "23505", Message: "conflict on relation", ConstraintName: "message_pins_pkey"},
			want: true,
		},
		{
			name: "sqlstate 23505 wrapped with %w",
			err:  fmt.Errorf("insert pin: %w", &pgconn.PgError{Severity: "ERROR", Code: "23505", Message: `duplicate key value violates unique constraint "message_pins_pkey"`}),
			want: true,
		},
		{
			name: "gorm sentinel",
			err:  gorm.ErrDuplicatedKey,
			want: true,
		},
		{
			// gorm.ErrDuplicatedKey renders as "duplicated key not allowed",
			// which contains neither "duplicate key" nor "unique constraint" —
			// only errors.Is can decide this one.
			name: "gorm sentinel wrapped with %w",
			err:  fmt.Errorf("create: %w", gorm.ErrDuplicatedKey),
			want: true,
		},
		{
			name: "sqlstate 42P10 ON CONFLICT programming error",
			err:  &pgconn.PgError{Severity: "ERROR", Code: "42P10", Message: "there is no unique or exclusion constraint matching the ON CONFLICT specification"},
			want: false,
		},
		{
			name: "sqlstate 23503 foreign key violation",
			err:  &pgconn.PgError{Severity: "ERROR", Code: "23503", Message: `insert or update on table "message_pins" violates foreign key constraint "fk_message_pins_message_session"`},
			want: false,
		},
		{
			name: "sqlstate 23502 not-null violation",
			err:  &pgconn.PgError{Severity: "ERROR", Code: "23502", Message: `null value in column "pinned_by_user_id" of relation "message_pins" violates not-null constraint`},
			want: false,
		},
		{
			name: "gorm record not found sentinel",
			err:  gorm.ErrRecordNotFound,
			want: false,
		},
		{
			name: "nil",
			err:  nil,
			want: false,
		},
		{
			name: "unrelated",
			err:  errors.New("connection refused"),
			want: false,
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, isUniqueViolation(tc.err))
		})
	}
}

// TestIsUniqueViolation_NarrowedSubstring is the three-part proof the brief
// requires for narrowing the fallback tier from "unique" to
// "unique constraint": every dialect wording that must still be recognised is
// recognised, and the one Postgres wording that must stop being recognised
// (42P10) stops being recognised.
//
// 42P10's message is `there is no unique or exclusion constraint matching the
// ON CONFLICT specification`. It CONTAINS "unique" but does NOT contain
// "unique constraint" ("or exclusion" sits in between), so the old wide match
// classified a mis-written ON CONFLICT clause — a programming error — as a
// benign duplicate and swallowed it as success.
func TestIsUniqueViolation_NarrowedSubstring(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{
			name: "still recognised: postgres 23505 wording",
			err:  errors.New(`ERROR: duplicate key value violates unique constraint "idx_agent_run_events_task_seq"`),
			want: true,
		},
		{
			name: "still recognised: sqlite upper-case wording",
			err:  errors.New("UNIQUE constraint failed: agent_run_events.task_id, agent_run_events.event_seq"),
			want: true,
		},
		{
			name: "still recognised: sqlite lower-case wording",
			err:  errors.New("unique constraint failed: agent_team_events.team_run_id, agent_team_events.seq"),
			want: true,
		},
		{
			name: "still recognised: sqlite with driver suffix",
			err:  errors.New("constraint failed: UNIQUE constraint failed: agent_team_events.team_run_id, agent_team_events.seq (2067)"),
			want: true,
		},
		{
			name: "still recognised: mysql-style duplicate key wording",
			err:  errors.New("Error 1062 (23000): Duplicate key value on write"),
			want: true,
		},
		{
			name: "no longer recognised: 42P10 raw wording",
			err:  errors.New("ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification (SQLSTATE 42P10)"),
			want: false,
		},
		{
			name: "no longer recognised: bare 'unique' without 'constraint'",
			err:  errors.New("column x must be unique"),
			want: false,
		},
		{
			name: "no longer recognised: unique INDEX wording that is not a violation",
			err:  errors.New(`ERROR: relation "uq_agent_team_events_run_seq" already exists (SQLSTATE 42P07)`),
			want: false,
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, isUniqueViolation(tc.err))
		})
	}
}

// TestIsUniqueViolation_ExportedEntryIsTheOnlyDoor asserts the exported entry
// point answers identically to the package-private implementation, so callers
// in other packages (service/message, service/executiontarget) cannot drift
// from it.
func TestIsUniqueViolation_ExportedEntryIsTheOnlyDoor(t *testing.T) {
	errs := []error{
		nil,
		gorm.ErrDuplicatedKey,
		&pgconn.PgError{Code: "23505", Message: "duplicate key value violates unique constraint \"message_pins_pkey\""},
		&pgconn.PgError{Code: "42P10", Message: "there is no unique or exclusion constraint matching the ON CONFLICT specification"},
		errors.New("UNIQUE constraint failed: message_pins.pkey"),
		errors.New("ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification (SQLSTATE 42P10)"),
		errors.New("connection refused"),
	}
	for _, err := range errs {
		err := err
		assert.Equal(t, isUniqueViolation(err), IsUniqueViolation(err), "IsUniqueViolation must be a pure forwarder for %v", err)
	}
}
