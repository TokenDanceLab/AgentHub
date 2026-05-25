package model

import "time"

type Device struct {
	ID           string    `gorm:"primaryKey;type:uuid" json:"id"`
	UserID       string    `gorm:"type:uuid;not null;index:idx_devices_user_type" json:"user_id"`
	DeviceType   string    `gorm:"type:varchar(16);not null;index:idx_devices_user_type" json:"device_type"`
	AppVersion   string    `gorm:"type:varchar(32)" json:"app_version,omitempty"`
	Capabilities string    `gorm:"type:jsonb;default:'[]'" json:"capabilities,omitempty"`
	LastActiveAt time.Time `gorm:"not null;default:now()" json:"last_active_at"`
	CreatedAt    time.Time `gorm:"autoCreateTime" json:"created_at"`
}
