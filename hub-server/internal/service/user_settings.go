package service

import (
	"fmt"
	"strings"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// UserSettingsService provides business logic for user settings.
type UserSettingsService struct {
	repo *repository.UserSettingsRepository
}

// NewUserSettingsService creates a new service instance.
func NewUserSettingsService(repo *repository.UserSettingsRepository) *UserSettingsService {
	return &UserSettingsService{repo: repo}
}

// GetSettings returns all settings for a user as a map.
func (s *UserSettingsService) GetSettings(userID string) (map[string]string, error) {
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
func (s *UserSettingsService) UpsertSettings(userID string, values map[string]string) (map[string]string, error) {
	// Validate keys and values
	cleaned := make(map[string]string, len(values))
	for key, value := range values {
		k := strings.TrimSpace(key)
		if k == "" {
			continue
		}
		if len(k) > 128 {
			return nil, fmt.Errorf("setting key too long: %s", k)
		}
		if len(value) > 4096 {
			return nil, fmt.Errorf("setting value too long for key: %s", k)
		}
		cleaned[k] = value
	}
	if len(cleaned) == 0 {
		return nil, fmt.Errorf("no valid settings to upsert")
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
