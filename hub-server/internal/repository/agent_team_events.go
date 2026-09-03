package repository

import (
	"errors"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

// AgentTeamEvent

// appendTeamEventMaxAttempts bounds the defensive retry path after a
// (team_run_id, seq) unique-index conflict. PostgreSQL writers are serialized
// per run by lockTeamRunForEventAppend before reading MAX(seq), so ordinary
// bursts do not consume this budget; the retry remains useful for callers
// that bypassed the parent row lock and for other dialects.
const appendTeamEventMaxAttempts = 5

// pgUniqueViolationSQLState is the PostgreSQL SQLSTATE for a unique-constraint
// violation. It is the only SQLSTATE this package treats as a benign, retryable
// duplicate.
//
// 42P10 is deliberately excluded. Its message is `there is no unique or
// exclusion constraint matching the ON CONFLICT specification` — a mis-written
// ON CONFLICT clause, i.e. a programming error, not a concurrent-insert
// collision. That message contains the substring "unique" but never "unique
// constraint" ("or exclusion" sits in between), which is exactly why the
// text tier below matches on "unique constraint" and not on "unique": the wide
// form classified 42P10 as a benign duplicate and swallowed it as success
// (#2244).
const pgUniqueViolationSQLState = "23505"

// isUniqueViolation reports whether err is a unique-constraint violation.
//
// This is the single implementation for the whole repository. It used to exist
// five times over — here, as the exported IsUniqueViolation forwarder in
// execution_target_evidence.go, as isDuplicateKeyError in agent.go, as a
// case-SENSITIVE isDuplicateKeyError in service/message/builders.go, and as an
// inline strings.Contains(err.Error(), "duplicate key") in
// service/message/service_send.go — and the copies had already drifted: the
// agent.go one lower-cased its input so SQLite's upper-case "UNIQUE constraint
// failed" was recognised, while the builders.go copy it claimed to mirror never
// did, and the PinMessage copy matched only "duplicate key" and so missed
// SQLite entirely. Same question, three different answers, in one binary.
//
// Callers must go through the exported IsUniqueViolation; do not add another
// copy. The tiers are ordered strongest signal first:
//
//  1. SQLSTATE 23505 on the Postgres wire error (pgx is this server's only
//     Postgres driver, so *pgconn.PgError is the shape that actually arrives).
//     No text has to be guessed at, and errors.As reaches it through whatever
//     the caller wrapped it in.
//  2. gorm.ErrDuplicatedKey, GORM's dialect-translated sentinel. It is only
//     populated when gorm.Config.TranslateError is enabled — this codebase does
//     not enable it today — so the tier is defensive, but it is cheap and it is
//     the contract GORM documents.
//  3. Text, last resort, for drivers and hand-built errors that carry no
//     structured signal (SQLite in tests reports "UNIQUE constraint failed:
//     ..."). Lower-cased first, then matched against "duplicate key" and
//     "unique constraint" — narrowed from a bare "unique" so 42P10 stops
//     matching.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolationSQLState {
		return true
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "duplicate key") || strings.Contains(msg, "unique constraint")
}

// lockTeamRunForEventAppend serializes event sequence allocation for one run
// in production PostgreSQL. Locking the stable parent row before MAX(seq)+1
// prevents a burst of concurrent appenders from repeatedly colliding on the
// unique index (where a fixed retry budget would otherwise shed writers).
// SQLite tests skip row locking and retain the unique-index retry fallback.
func lockTeamRunForEventAppend(tx *gorm.DB, teamRunID string) error {
	if tx.Name() != "postgres" {
		return nil
	}
	var lockedID string
	if err := tx.Raw(
		"SELECT id FROM agent_team_runs WHERE id = ? FOR UPDATE",
		teamRunID,
	).Scan(&lockedID).Error; err != nil {
		return err
	}
	if lockedID == "" {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// AppendTeamEvent appends an event with the next per-run seq. The MAX(seq)+1
// read and the insert run in one transaction, and the unique index on
// (team_run_id, seq) turns a concurrent append racing the same seq into a
// unique violation instead of a silent duplicate; losing appenders retry with
// a freshly read MAX(seq).
func AppendTeamEvent(db *gorm.DB, event *model.AgentTeamEvent) error {
	if event.Payload == "" {
		event.Payload = "{}"
	}
	var lastErr error
	for attempt := 0; attempt < appendTeamEventMaxAttempts; attempt++ {
		err := db.Transaction(func(tx *gorm.DB) error {
			if err := lockTeamRunForEventAppend(tx, event.TeamRunID); err != nil {
				return err
			}
			var maxSeq int
			if err := tx.Model(&model.AgentTeamEvent{}).
				Where("team_run_id = ?", event.TeamRunID).
				Select("COALESCE(MAX(seq), 0)").
				Scan(&maxSeq).Error; err != nil {
				return err
			}
			event.Seq = maxSeq + 1
			return tx.Create(event).Error
		})
		if err == nil {
			return nil
		}
		if !isUniqueViolation(err) {
			return err
		}
		lastErr = err
	}
	return lastErr
}

// maxTeamEventsPerRun caps the number of team events returned by
// ListTeamEventsByRun. Team events are append-only and can grow
// unboundedly over a long-running team run. The cap prevents
// unbounded memory consumption while being high enough for realistic
// team runs (1000 events = ~1-2 MB payload).
const maxTeamEventsPerRun = 10000

// TeamEventsPage is one cursor-paginated window over a run's append-only
// events (#2154 perf lane). The cursor is the run-local event seq; pass
// NextSeq back as afterSeq to fetch the following window.
type TeamEventsPage struct {
	Items   []model.AgentTeamEvent
	NextSeq int
	HasMore bool
}

// ListTeamEventsByRunPage returns events with seq > afterSeq ordered by
// (seq, created_at), bounded by limit. It fetches limit+1 rows to compute
// HasMore without a second COUNT query; limit is capped at
// maxTeamEventsPerRun.
func ListTeamEventsByRunPage(db *gorm.DB, teamRunID string, afterSeq, limit int) (TeamEventsPage, error) {
	if limit <= 0 {
		limit = maxTeamEventsPerRun
	}
	if limit > maxTeamEventsPerRun {
		limit = maxTeamEventsPerRun
	}
	var events []model.AgentTeamEvent
	err := db.Where("team_run_id = ? AND seq > ?", teamRunID, afterSeq).
		Order("seq ASC, created_at ASC").
		Limit(limit + 1).
		Find(&events).Error
	if err != nil {
		return TeamEventsPage{}, err
	}
	page := TeamEventsPage{Items: events}
	if len(events) > limit {
		page.HasMore = true
		page.Items = events[:limit]
	}
	if len(page.Items) > 0 {
		page.NextSeq = page.Items[len(page.Items)-1].Seq
	}
	return page, nil
}

func ListTeamEventsByRun(db *gorm.DB, teamRunID string) ([]model.AgentTeamEvent, error) {
	page, err := ListTeamEventsByRunPage(db, teamRunID, 0, maxTeamEventsPerRun)
	return page.Items, err
}
