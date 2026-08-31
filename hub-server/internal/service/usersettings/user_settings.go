package usersettings

import (
	"fmt"
	"strings"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/pkg/errcode"
)

// Service provides business logic for user settings.
type Service struct {
	repo *repository.UserSettingsRepository
}

// NewService creates a new service instance.
func NewService(repo *repository.UserSettingsRepository) *Service {
	return &Service{repo: repo}
}

// GetSettings returns all settings for a user as a map.
func (s *Service) GetSettings(userID string) (map[string]string, error) {
	settings, err := s.repo.GetSettings(userID)
	if err != nil {
		return nil, fmt.Errorf("get user settings: %w", err)
	}
	result := make(map[string]string, len(settings))
	for _, setting := range settings {
		result[setting.Key] = setting.Value
	}
	return result, nil
}

// UpsertSettings validates and upserts settings for a user.
func (s *Service) UpsertSettings(userID string, values map[string]string) (map[string]string, error) {
	// Validate keys and values
	cleaned := make(map[string]string, len(values))
	for key, value := range values {
		k := strings.TrimSpace(key)
		if k == "" {
			continue
		}
		if len(k) > 128 {
			return nil, errcode.ErrValidation.WithMessage("setting key too long: " + k)
		}
		if len(value) > 4096 {
			return nil, errcode.ErrValidation.WithMessage("setting value too long for key: " + k)
		}
		cleaned[k] = value
	}
	if len(cleaned) == 0 {
		return nil, errcode.ErrValidation.WithMessage("no valid settings to upsert")
	}

	_, err := s.repo.UpsertSettings(userID, cleaned)
	if err != nil {
		return nil, fmt.Errorf("upsert user settings: %w", err)
	}

	// Return all settings after upsert
	return s.GetSettings(userID)
}

// SettingsToMap converts a slice of UserSetting to a map.
func SettingsToMap(settings []model.UserSetting) map[string]string {
	result := make(map[string]string, len(settings))
	for _, setting := range settings {
		result[setting.Key] = setting.Value
	}
	return result
}
