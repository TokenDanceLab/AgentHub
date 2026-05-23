package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/pkg/uuidv7"
)

type RefreshToken struct {
	ID         string    `gorm:"primaryKey;type:uuid" json:"id"`
	UserID     string    `gorm:"type:uuid;not null;index:idx_rt_user_device,unique" json:"user_id"`
	DeviceType string    `gorm:"type:varchar(16);not null;index:idx_rt_user_device,unique" json:"device_type"`
	DeviceID   string    `gorm:"type:uuid;not null;index:idx_rt_user_device,unique" json:"device_id"`
	TokenHash  string    `gorm:"type:varchar(128);uniqueIndex;not null" json:"-"`
	ExpiresAt  time.Time `gorm:"not null" json:"expires_at"`
	Revoked    bool      `gorm:"not null;default:false" json:"revoked"`
	CreatedAt  time.Time `gorm:"autoCreateTime" json:"created_at"`
}

func (r *RefreshToken) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	r.ID = id
	return nil
}
