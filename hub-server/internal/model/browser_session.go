package model

import "time"

// BrowserSession stores only a digest of the HttpOnly browser credential.
// CSRFToken is a separate anti-forgery value, not an authentication credential.
type BrowserSession struct {
	TokenHash      string     `gorm:"primaryKey;size:64" json:"-"`
	UserID         string     `gorm:"type:uuid;not null" json:"-"`
	UserIdentityID string     `gorm:"type:uuid;not null;index" json:"-"`
	OIDCClientID   string     `gorm:"column:oidc_client_id;size:255;not null" json:"-"`
	DeviceID       string     `gorm:"type:uuid;not null" json:"-"`
	Generation     int64      `gorm:"not null" json:"-"`
	CSRFToken      string     `gorm:"size:64;not null" json:"-"`
	CreatedAt      time.Time  `json:"-"`
	ExpiresAt      time.Time  `gorm:"not null;index" json:"-"`
	RevokedAt      *time.Time `json:"-"`
}

// OIDCSubjectEpoch also exists for subjects that have not yet signed into Hub.
// A logout racing a first login must not disappear because no identity exists.
type OIDCSubjectEpoch struct {
	Issuer        string `gorm:"primaryKey;size:512"`
	Subject       string `gorm:"primaryKey;size:255"`
	Generation    int64  `gorm:"not null"`
	LastLogoutIAT int64  `gorm:"column:last_logout_iat;not null"`
}

func (OIDCSubjectEpoch) TableName() string { return "oidc_subject_epochs" }

type OIDCLogoutEvent struct {
	Issuer     string    `gorm:"primaryKey;size:512"`
	JTI        string    `gorm:"primaryKey;column:jti;size:512"`
	ClaimsHash string    `gorm:"size:64;not null"`
	ReceivedAt time.Time `gorm:"not null"`
	ExpiresAt  time.Time `gorm:"not null;index"`
}

func (OIDCLogoutEvent) TableName() string { return "oidc_logout_events" }
