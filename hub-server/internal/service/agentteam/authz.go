package agentteam

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/repository"
)

// TeamRole enumerates the minimum team role required by an endpoint.
type TeamRole int

const (
	// TeamRoleMember allows any user who owns the team OR owns an agent
	// profile installed as a team member.
	TeamRoleMember TeamRole = iota
	// TeamRoleOwner restricts access to the team owner only.
	TeamRoleOwner
)

// CheckTeamAccess enforces team-level authorization. It returns nil when
// access is granted; otherwise it returns an errcode error that the handler
// layer maps to an HTTP response.
//
// Why 403 instead of the existing service-layer 404? The service layer
// historically returned errcode.AgentNotFound for both "team does not exist"
// and "user has no access", which conflates absence with denial and lets
// authenticated users probe for team IDs. Returning explicit 403 at the
// authorization boundary makes the distinction clear (#2100 P0).
func (s *AgentTeamService) CheckTeamAccess(ctx context.Context, userID, teamID string, minRole TeamRole) error {
	if userID == "" {
		return errcode.AuthInvalidToken
	}
	if teamID == "" {
		return errcode.ErrBadRequest
	}

	team, err := repository.GetTeamByID(s.db, teamID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// Keep existing behaviour: unknown team surfaces as 404 so
			// clients cannot distinguish missing from forbidden.
			return errcode.AgentNotFound
		}
		return errcode.ErrInternal
	}

	isOwner := team.OwnerID == userID
	if minRole == TeamRoleOwner {
		if !isOwner {
			return errcode.ErrForbidden.WithMessage("team owner required")
		}
		return nil
	}

	// TeamRoleMember: owner passes; otherwise check membership via agent
	// profile ownership (matches getTeamForRead semantics).
	if isOwner {
		return nil
	}
	hasMember, err := repository.TeamHasAgentOwnedByUser(s.db, teamID, userID)
	if err != nil {
		return errcode.ErrInternal
	}
	if !hasMember {
		return errcode.ErrForbidden.WithMessage("team membership required")
	}
	return nil
}

// ResolveTeamIDFromRun looks up the team_id for a given team run. Returns
// errcode.AgentTaskNotFound when the run does not exist.
func (s *AgentTeamService) ResolveTeamIDFromRun(ctx context.Context, runID string) (string, error) {
	if runID == "" {
		return "", errcode.ErrBadRequest
	}
	run, err := repository.GetTeamRunByID(s.db, runID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", errcode.AgentTaskNotFound
		}
		return "", errcode.ErrInternal
	}
	return run.TeamID, nil
}

// ResolveTeamIDFromAssignment resolves team_id via assignment → run → team.
func (s *AgentTeamService) ResolveTeamIDFromAssignment(ctx context.Context, assignmentID string) (string, error) {
	if assignmentID == "" {
		return "", errcode.ErrBadRequest
	}
	a, err := repository.GetAssignmentByID(s.db, assignmentID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", errcode.AgentTaskNotFound
		}
		return "", errcode.ErrInternal
	}
	return s.ResolveTeamIDFromRun(ctx, a.TeamRunID)
}
