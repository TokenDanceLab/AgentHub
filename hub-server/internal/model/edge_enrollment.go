package model

import "time"

// EdgeEnrollment contains digests only. The raw polling secret and user code
// are disclosed only when Start returns; confirmation cannot obtain a device
// credential. The confirmed identity is immutable until the record expires.
type EdgeEnrollment struct {
	ID             string     `gorm:"primaryKey;type:uuid" json:"-"`
	DeviceID       string     `gorm:"type:uuid;not null" json:"-"`
	Name           string     `gorm:"size:128;not null" json:"-"`
	RuntimeID      string     `gorm:"size:64;not null" json:"-"`
	WorkspaceRoot  string     `gorm:"size:512;not null" json:"-"`
	UserCodeHash   string     `gorm:"size:64;not null;uniqueIndex" json:"-"`
	PollSecretHash string     `gorm:"size:64;not null" json:"-"`
	UserID         *string    `gorm:"type:uuid" json:"-"`
	UserIdentityID *string    `gorm:"type:uuid" json:"-"`
	OIDCClientID   string     `gorm:"column:oidc_client_id;size:255;not null" json:"-"`
	Generation     int64      `gorm:"not null" json:"-"`
	CreatedAt      time.Time  `json:"-"`
	ExpiresAt      time.Time  `gorm:"not null;index" json:"-"`
	ConfirmedAt    *time.Time `json:"-"`
	ExchangedAt    *time.Time `json:"-"`
}

// EdgeDeviceCredential binds an opaque credential to one Account identity and
// one execution target. Revoked rows remain as the paired-device routing marker;
// they must never fall back to the legacy Desktop WS delivery path.
type EdgeDeviceCredential struct {
	DeviceID       string     `gorm:"primaryKey;type:uuid" json:"-"`
	TargetID       string     `gorm:"type:uuid;not null;uniqueIndex" json:"-"`
	UserID         string     `gorm:"type:uuid;not null" json:"-"`
	UserIdentityID string     `gorm:"type:uuid;not null;index" json:"-"`
	OIDCClientID   string     `gorm:"column:oidc_client_id;size:255;not null" json:"-"`
	Generation     int64      `gorm:"not null" json:"-"`
	CredentialHash string     `gorm:"size:64;not null;uniqueIndex" json:"-"`
	RuntimeID      string     `gorm:"size:64;not null" json:"-"`
	WorkspaceRoot  string     `gorm:"size:512;not null" json:"-"`
	CreatedAt      time.Time  `json:"-"`
	ExpiresAt      time.Time  `gorm:"not null;index" json:"-"`
	RevokedAt      *time.Time `json:"-"`
}
