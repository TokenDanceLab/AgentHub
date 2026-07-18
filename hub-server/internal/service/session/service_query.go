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
// through agents (page size 100, max 10 pages = 1000 agents) and wraps the three
// per-agent operations in a single DB transaction for atomicity.
//
// Errors from individual agents are logged at Warn level and aggregated. The caller
// receives a joined error so it can decide whether to abort or proceed.
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

		for _, agent := range agents {
			// Cancel pending tasks for this agent instance.
			if err := repository.CancelTasksByAgentInstance(s.db, agent.ID); err != nil {
				slog.Warn("cleanupInvitedAgents: CancelTasksByAgentInstance failed",
					"session_id", sessionID, "inviter_user_id", inviterUserID,
					"agent_id", agent.ID, "error", err)
				allErrors = append(allErrors, fmt.Errorf("cancel tasks for agent %s: %w", agent.ID, err))
				// Continue with other operations even if cancel fails — the agent
				// instance and member record should still be cleaned up.
			}
			if err := repository.DeleteAgentInstance(s.db, agent.ID); err != nil {
				slog.Warn("cleanupInvitedAgents: DeleteAgentInstance failed",
					"session_id", sessionID, "inviter_user_id", inviterUserID,
					"agent_id", agent.ID, "error", err)
				allErrors = append(allErrors, fmt.Errorf("delete agent %s: %w", agent.ID, err))
			}
			if err := repository.SoftDeleteMember(s.db, sessionID, model.MemberTypeAgent, agent.ID); err != nil {
				slog.Warn("cleanupInvitedAgents: SoftDeleteMember failed",
					"session_id", sessionID, "inviter_user_id", inviterUserID,
					"agent_id", agent.ID, "error", err)
				allErrors = append(allErrors, fmt.Errorf("soft delete member for agent %s: %w", agent.ID, err))
			}
		}
	}

	return errors.Join(allErrors...)
}
