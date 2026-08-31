package agent

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// CreateCustomAgent creates a new custom agent owned by the given user.
func (s *Service) CreateCustomAgent(ctx context.Context, ownerID, name, avatarURL, agentType, systemPrompt, capabilityTags, toolWhitelist, modelParams string) (*model.CustomAgent, error) {
	ca := &model.CustomAgent{
		OwnerUserID:    ownerID,
		Name:           name,
		AvatarURL:      avatarURL,
		AgentType:      agentType,
		SystemPrompt:   systemPrompt,
		CapabilityTags: capabilityTags,
		ToolWhitelist:  toolWhitelist,
		ModelParams:    modelParams,
	}
	if err := repository.CreateCustomAgent(s.db, ca); err != nil {
		return nil, err
	}
	return ca, nil
}

// ListCustomAgents returns all custom agents owned by the given user.
func (s *Service) ListCustomAgents(ctx context.Context, ownerID string) ([]model.CustomAgent, error) {
	return repository.ListCustomAgentsByOwner(s.db, ownerID)
}

// UpdateCustomAgent updates an existing custom agent, verifying ownership.
func (s *Service) UpdateCustomAgent(ctx context.Context, ownerID string, ca *model.CustomAgent) error {
	existing, err := repository.GetCustomAgentByID(s.db, ca.ID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentNotFound
		}
		return err
	}
	if existing.OwnerUserID != ownerID {
		return errcode.AgentNotFound
	}
	ca.OwnerUserID = ownerID
	if ca.CapabilityTags == "" {
		ca.CapabilityTags = existing.CapabilityTags
	}
	if ca.ToolWhitelist == "" {
		ca.ToolWhitelist = existing.ToolWhitelist
	}
	if ca.ModelParams == "" {
		ca.ModelParams = existing.ModelParams
	}
	ca.CreatedAt = existing.CreatedAt
	return repository.UpdateCustomAgent(s.db, ca)
}

// DeleteCustomAgent soft-deletes a custom agent, verifying ownership.
func (s *Service) DeleteCustomAgent(ctx context.Context, ownerID, id string) error {
	ca, err := repository.GetCustomAgentByID(s.db, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentNotFound
		}
		return err
	}
	if ca.OwnerUserID != ownerID {
		return errcode.AgentNotFound
	}
	return repository.SoftDeleteCustomAgent(s.db, id)
}
