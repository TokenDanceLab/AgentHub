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
	if err := repository.CreateCustomAgent(s.db.WithContext(ctx), ca); err != nil {
		return nil, err
	}
	return ca, nil
}

// ListCustomAgents returns all custom agents owned by the given user.
func (s *Service) ListCustomAgents(ctx context.Context, ownerID string) ([]model.CustomAgent, error) {
	return repository.ListCustomAgentsByOwner(s.db.WithContext(ctx), ownerID)
}

// UpdateCustomAgent updates an existing custom agent, verifying ownership.
//
// repository.UpdateCustomAgent writes only the columns updateCustomAgentReq can
// carry (#2253), so this method no longer reconstructs a row and must not try
// to: output_schema, deleted_at, created_at and owner_user_id are not written at
// all, which is why the old `ca.OwnerUserID = ownerID` / `ca.CreatedAt =
// existing.CreatedAt` assignments are gone — they fed a whole-row db.Save that
// needed them, and keeping them here would imply columns the write never
// touches.
//
// What is still backfilled are the three jsonb columns whose request contract is
// "absent means unchanged": handler.updateCustomAgentReq binds capability_tags,
// tool_whitelist and model_params with omitempty, so an omitted value must not
// be flattened to "" by a write that does include those columns.
func (s *Service) UpdateCustomAgent(ctx context.Context, ownerID string, ca *model.CustomAgent) error {
	existing, err := repository.GetCustomAgentByID(s.db.WithContext(ctx), ca.ID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentNotFound
		}
		return err
	}
	if existing.OwnerUserID != ownerID {
		return errcode.AgentNotFound
	}
	if ca.CapabilityTags == "" {
		ca.CapabilityTags = existing.CapabilityTags
	}
	if ca.ToolWhitelist == "" {
		ca.ToolWhitelist = existing.ToolWhitelist
	}
	if ca.ModelParams == "" {
		ca.ModelParams = existing.ModelParams
	}
	// The row can be soft-deleted between the read above and the write below.
	// repository.UpdateCustomAgent puts the not-deleted guard inside the UPDATE
	// and reports zero matched rows as ErrRecordNotFound, so that race surfaces
	// as the same 404 the read path returns instead of resurrecting the row.
	return repository.WrapNotFound(repository.UpdateCustomAgent(s.db.WithContext(ctx), ca), errcode.AgentNotFound)
}

// DeleteCustomAgent soft-deletes a custom agent, verifying ownership.
func (s *Service) DeleteCustomAgent(ctx context.Context, ownerID, id string) error {
	ca, err := repository.GetCustomAgentByID(s.db.WithContext(ctx), id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errcode.AgentNotFound
		}
		return err
	}
	if ca.OwnerUserID != ownerID {
		return errcode.AgentNotFound
	}
	return repository.SoftDeleteCustomAgent(s.db.WithContext(ctx), id)
}
