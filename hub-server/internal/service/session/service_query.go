// #1161: Session Service pure-helper peel — query/cleanup paths extracted from service.go.
package session

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

func (s *Service) SearchSessions(ctx context.Context, userID, q string) ([]SessionListItem, error) {
	sessions, err := repository.SearchSessions(s.db, userID, q)
	if err != nil {
		return nil, err
	}
	return MapSessionListItems(sessions), nil
}

// ListActiveMembers returns all active (non-left) members of a session. Thin wrapper over repository.ListActiveMembers.
func (s *Service) ListActiveMembers(sessionID string) ([]*model.SessionMember, error) {
	return repository.ListActiveMembers(s.db, sessionID)
}

// cleanupInvitedAgents cancels pending tasks, deletes agent instances, and soft-deletes
// session member records for all agents a user invited into a session. It paginates
// through agents (page size 100, max 10 pages = 1000 agents) and batches the three
// per-agent operations into single DB calls per page to avoid 3N round-trips (#2102).
//
// Error semantics change vs. the original per-agent loop: each batched operation is
// executed once per page; if a batch fails, the error is logged and aggregated, but
// subsequent batches in the same page still run (best-effort parity with the prior
// continue-on-error behavior). Per-agent granularity is lost at the batch level —
// callers should treat any returned error as "some subset may have failed".
func (s *Service) cleanupInvitedAgents(sessionID, inviterUserID string) error {
	const pageSize = 100
	const maxPages = 10 // safety bound: max 1000 agents per inviter per session
	var allErrors []error

	for page := 0; page < maxPages; page++ {
		agents, err := repository.ListAgentInstancesByInviterPage(s.db, sessionID, inviterUserID, pageSize, page*pageSize)
		if err != nil {
			allErrors = append(allErrors, fmt.Errorf("list agents page %d: %w", page, err))
			break
		}
		if len(agents) == 0 {
			break
		}

		ids := make([]string, 0, len(agents))
		for _, a := range agents {
			ids = append(ids, a.ID)
		}

		if err := repository.BatchCancelTasksByAgentInstance(s.db, ids); err != nil {
			slog.Warn("cleanupInvitedAgents: BatchCancelTasksByAgentInstance failed",
				"session_id", sessionID, "inviter_user_id", inviterUserID,
				"count", len(ids), "error", err)
			allErrors = append(allErrors, fmt.Errorf("batch cancel tasks page %d: %w", page, err))
		}
		if err := repository.BatchDeleteAgentInstances(s.db, ids); err != nil {
			slog.Warn("cleanupInvitedAgents: BatchDeleteAgentInstances failed",
				"session_id", sessionID, "inviter_user_id", inviterUserID,
				"count", len(ids), "error", err)
			allErrors = append(allErrors, fmt.Errorf("batch delete agents page %d: %w", page, err))
		}
		if err := repository.BatchSoftDeleteMembers(s.db, sessionID, model.MemberTypeAgent, ids); err != nil {
			slog.Warn("cleanupInvitedAgents: BatchSoftDeleteMembers failed",
				"session_id", sessionID, "inviter_user_id", inviterUserID,
				"count", len(ids), "error", err)
			allErrors = append(allErrors, fmt.Errorf("batch soft delete members page %d: %w", page, err))
		}
	}

	return errors.Join(allErrors...)
}
