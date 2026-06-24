package service

import (
	"context"
	"errors"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"gorm.io/gorm"
)

func (s *AgentTeamService) AddTeamMember(ctx context.Context, userID, teamID, agentProfileID, role string) error {
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

	// Validate the agent profile exists and is owned by the user.
	if agentProfileID == "" {
		return errcode.ErrBadRequest
	}
	ca, err := repository.GetCustomAgentByID(s.db, agentProfileID)
	if err != nil {
		return errcode.AgentNotFound
	}
	if ca.OwnerUserID != userID {
		return errcode.AgentNotFound
	}

	// Validate role.
	if role == "" {
		role = model.TeamMemberRoleExecutor
	}
	if role != model.TeamMemberRoleSupervisor && role != model.TeamMemberRoleExecutor && role != model.TeamMemberRoleReviewer {
		return errcode.ErrBadRequest
	}

	member := &model.AgentTeamMember{
		TeamID:         teamID,
		Role:           role,
		AgentProfileID: &agentProfileID,
	}
	return repository.AddTeamMember(s.db, member)
}

// RemoveTeamMember removes a member from a team, verifying owner access.
func (s *AgentTeamService) RemoveTeamMember(ctx context.Context, userID, teamID, memberID string) error {
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

	member, err := repository.GetTeamMemberByID(s.db, memberID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentNotFound
		}
		return err
	}
	if member.TeamID != teamID {
		return errcode.AgentNotFound
	}
	return repository.RemoveTeamMember(s.db, memberID)
}

// TeamDetail is returned when fetching a team with its members.
