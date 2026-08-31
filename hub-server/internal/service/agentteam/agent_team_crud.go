package agentteam

import (
	"context"
	"errors"
	"unicode/utf8"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"gorm.io/gorm"
)

func (s *AgentTeamService) CreateTeam(ctx context.Context, userID, name, description string) (*model.AgentTeam, error) {
	if name == "" {
		return nil, errcode.ErrBadRequest
	}
	if utf8.RuneCountInString(name) > config.MaxTeamNameLength {
		return nil, errcode.ErrBadRequest.WithMessage("team name exceeds maximum length")
	}
	team := &model.AgentTeam{
		OwnerID:     userID,
		Name:        name,
		Description: description,
	}
	if err := repository.CreateTeam(s.db, team); err != nil {
		return nil, err
	}
	return team, nil
}

// GetTeam returns a team by ID when the requesting user owns the team or owns
// an Agent Profile installed as a team member.
func (s *AgentTeamService) GetTeam(ctx context.Context, userID, teamID string) (*model.AgentTeam, error) {
	return s.getTeamForRead(ctx, userID, teamID)
}

func (s *AgentTeamService) getTeamForRead(ctx context.Context, userID, teamID string) (*model.AgentTeam, error) {
	team, err := repository.GetTeamByID(s.db, teamID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentNotFound
		}
		return nil, err
	}
	if team.OwnerID == userID {
		return team, nil
	}
	isMember, err := repository.TeamHasAgentOwnedByUser(s.db, teamID, userID)
	if err != nil {
		return nil, err
	}
	if !isMember {
		return nil, errcode.AgentNotFound
	}
	return team, nil
}

func (s *AgentTeamService) requireTeamOwner(ctx context.Context, userID, teamID string) (*model.AgentTeam, error) {
	team, err := repository.GetTeamByID(s.db, teamID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.AgentNotFound
		}
		return nil, err
	}
	if team.OwnerID != userID {
		return nil, errcode.AgentNotFound
	}
	return team, nil
}

// ListTeams returns all teams owned by the user or readable through one of the
// user's Agent Profiles installed as a team member.
func (s *AgentTeamService) ListTeams(ctx context.Context, userID string) ([]model.AgentTeam, error) {
	return repository.ListTeamsReadableByUser(s.db, userID)
}

// UpdateTeam updates a team's name and description, verifying owner access.
func (s *AgentTeamService) UpdateTeam(ctx context.Context, userID, teamID, name, description string) error {
	team, err := repository.GetTeamByID(s.db, teamID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentNotFound
		}
		return err
	}
	if team.OwnerID != userID {
		return errcode.AgentNotFound
	}
	if name != "" {
		team.Name = name
	}
	if description != "" {
		team.Description = description
	}
	return repository.UpdateTeam(s.db, team)
}

// DeleteTeam deletes a team, verifying owner access.
func (s *AgentTeamService) DeleteTeam(ctx context.Context, userID, teamID string) error {
	team, err := repository.GetTeamByID(s.db, teamID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentNotFound
		}
		return err
	}
	if team.OwnerID != userID {
		return errcode.AgentNotFound
	}

	// Teams with run history are non-deletable: hard-deleting would violate
	// the agent_team_runs FK and destroy audit/history records. Surface a 409
	// instead of leaking Postgres 23503 through the generic 500 fallback.
	runs, err := repository.ListTeamRunsByTeam(s.db, teamID)
	if err != nil {
		return err
	}
	if len(runs) > 0 {
		return errcode.TeamHasRuns
	}

	// Remove members first (member rows reference the team) inside a
	// transaction so a member-delete failure cannot leave a half-deleted team.
	// Batch delete in one statement (#2102 F10): the previous List + per-member
	// RemoveTeamMember loop was an N+1 on large teams.
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := repository.RemoveTeamMembersByTeam(tx, teamID); err != nil {
			return err
		}
		return repository.DeleteTeam(tx, teamID)
	})
}

type TeamDetail = model.TeamDetail

// GetTeamWithMembers returns a team along with its member list.
func (s *AgentTeamService) GetTeamWithMembers(ctx context.Context, userID, teamID string) (*TeamDetail, error) {
	team, err := s.GetTeam(ctx, userID, teamID)
	if err != nil {
		return nil, err
	}
	members, err := repository.ListTeamMembers(s.db, teamID)
	if err != nil {
		return nil, err
	}
	if members == nil {
		members = []model.AgentTeamMember{}
	}
	return &TeamDetail{
		AgentTeam: team,
		Members:   members,
	}, nil
}
