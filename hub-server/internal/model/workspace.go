package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/pkg/uuidv7"
)

// Workspace represents a collaborative workspace that sessions and agent
// instances can belong to. It models the "workspaces" table that already
// exists in the database schema.
type Workspace struct {
	ID          string    `gorm:"primaryKey;type:uuid" json:"id"`
	Name        string    `gorm:"type:varchar(128);not null" json:"name"`
	Description string    `gorm:"type:text" json:"description,omitempty"`
	OwnerUserID string    `gorm:"type:uuid;not null" json:"owner_user_id"`
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (w *Workspace) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	w.ID = id
	return nil
}
