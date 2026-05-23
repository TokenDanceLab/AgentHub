package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/pkg/uuidv7"
)

const (
	MemberTypeUser  = "user"
	MemberTypeAgent = "agent_instance"

	MemberRoleOwner  = "owner"
	MemberRoleMember = "member"
)

type SessionMember struct {
	ID          string     `gorm:"primaryKey;type:uuid" json:"id"`
	SessionID   string     `gorm:"type:uuid;not null" json:"session_id"`
	MemberType  string     `gorm:"type:varchar(16);not null" json:"member_type"`
	MemberID    string     `gorm:"type:uuid;not null" json:"member_id"`
	Role        string     `gorm:"type:varchar(16);not null" json:"role"`
	Pinned      bool       `gorm:"not null;default:false" json:"pinned"`
	Archived    bool       `gorm:"not null;default:false" json:"archived"`
	Muted       bool       `gorm:"not null;default:false" json:"muted"`
	LastReadSeq int64      `gorm:"not null;default:0" json:"last_read_seq"`
	JoinedAt    time.Time  `gorm:"autoCreateTime" json:"joined_at"`
	LeftAt      *time.Time `gorm:"type:timestamptz" json:"left_at,omitempty"`
}

func (sm *SessionMember) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	sm.ID = id
	return nil
}
