package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/uuidv7"
)

const (
	IdentityProviderAccount = "account"
	IdentityStatusActive    = "active"
	IdentityStatusRetired   = "retired"
)

// UserIdentity is a stable external identity binding. (Issuer, Subject) is the
// unique key; email and provider-specific profile values never claim a user.
type UserIdentity struct {
	ID        string    `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	UserID    string    `gorm:"column:user_id;type:uuid;not null;index:idx_user_identities_user_id" json:"user_id"`
	Provider  string    `gorm:"type:varchar(64);not null" json:"provider"`
	Issuer    string    `gorm:"type:varchar(512);not null;uniqueIndex:idx_user_identities_issuer_subject,priority:1" json:"issuer"`
	Subject   string    `gorm:"type:varchar(255);not null;uniqueIndex:idx_user_identities_issuer_subject,priority:2" json:"subject"`
	Status    string    `gorm:"type:varchar(16);not null;default:active" json:"status"`
	LinkedAt  time.Time `gorm:"not null" json:"linked_at"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (u *UserIdentity) BeforeCreate(tx *gorm.DB) error {
	if u.ID != "" {
		return nil
	}
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	u.ID = id
	return nil
}
