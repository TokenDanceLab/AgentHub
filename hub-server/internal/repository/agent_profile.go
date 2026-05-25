package repository

import (
	"time"

	"github.com/agenthub/hub-server/internal/model"
	"gorm.io/gorm"
)

const defaultProfilePageSize = 50

func CreateAgentProfile(db *gorm.DB, p *model.AgentProfile) error {
	return db.Create(p).Error
}

func GetAgentProfileByID(db *gorm.DB, id string) (*model.AgentProfile, error) {
	var p model.AgentProfile
	err := db.Where("id = ? AND deleted_at IS NULL", id).First(&p).Error
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func UpdateAgentProfile(db *gorm.DB, p *model.AgentProfile) error {
	p.Version++
	return db.Save(p).Error
}

func SoftDeleteAgentProfile(db *gorm.DB, id, ownerID string) error {
	return db.Model(&model.AgentProfile{}).
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL", id, ownerID).
		Update("deleted_at", time.Now()).Error
}

// ListAgentProfiles returns profiles for an owner with optional filters and cursor pagination.
// If cursor is empty, returns the first page.
// If q is non-empty, filters by name/description ILIKE match.
// If runtimeID is non-empty, filters by runtime_id.
func ListAgentProfiles(db *gorm.DB, ownerID, runtimeID, q, cursor string, pageSize int) ([]model.AgentProfile, bool, error) {
	if pageSize <= 0 || pageSize > 200 {
		pageSize = defaultProfilePageSize
	}

	qry := db.Where("owner_id = ? AND deleted_at IS NULL", ownerID)
	if runtimeID != "" {
		qry = qry.Where("runtime_id = ?", runtimeID)
	}
	if q != "" {
		qry = qry.Where("(name ILIKE ? OR description ILIKE ?)", "%"+q+"%", "%"+q+"%")
	}
	if cursor != "" {
		qry = qry.Where("id > ?", cursor)
	}

	var profiles []model.AgentProfile
	if err := qry.Order("id ASC").Limit(pageSize + 1).Find(&profiles).Error; err != nil {
		return nil, false, err
	}

	hasMore := len(profiles) > pageSize
	if hasMore {
		profiles = profiles[:pageSize]
	}
	return profiles, hasMore, nil
}

// ListPublicProfiles returns published profiles for the agent market.
func ListPublicProfiles(db *gorm.DB, runtimeID, q, sortBy, cursor string, pageSize int) ([]model.AgentProfile, bool, error) {
	if pageSize <= 0 || pageSize > 200 {
		pageSize = defaultProfilePageSize
	}

	qry := db.Where("is_public = TRUE AND deleted_at IS NULL")
	if runtimeID != "" {
		qry = qry.Where("runtime_id = ?", runtimeID)
	}
	if q != "" {
		qry = qry.Where("(name ILIKE ? OR description ILIKE ?)", "%"+q+"%", "%"+q+"%")
	}
	if cursor != "" {
		switch sortBy {
		case "install_count":
			qry = qry.Where("install_count < ? OR (install_count = ? AND id > ?)", cursor, cursor, cursor)
		case "rating":
			qry = qry.Where("rating_avg < ? OR (rating_avg = ? AND id > ?)", cursor, cursor, cursor)
		default: // "recent"
			qry = qry.Where("id < ?", cursor)
		}
	}

	switch sortBy {
	case "install_count":
		qry = qry.Order("install_count DESC, id ASC")
	case "rating":
		qry = qry.Order("rating_avg DESC, id ASC")
	default:
		qry = qry.Order("id DESC")
	}

	var profiles []model.AgentProfile
	if err := qry.Limit(pageSize + 1).Find(&profiles).Error; err != nil {
		return nil, false, err
	}
	hasMore := len(profiles) > pageSize
	if hasMore {
		profiles = profiles[:pageSize]
	}
	return profiles, hasMore, nil
}

// IncrementProfileInstallCount atomically increases install_count.
func IncrementProfileInstallCount(db *gorm.DB, id string) error {
	return db.Model(&model.AgentProfile{}).Where("id = ?", id).
		UpdateColumn("install_count", gorm.Expr("install_count + 1")).Error
}

// UpdateProfileRating updates the rating average and count.
func UpdateProfileRating(db *gorm.DB, id string, newAvg float64, newCount int) error {
	return db.Model(&model.AgentProfile{}).Where("id = ?", id).Updates(map[string]interface{}{
		"rating_avg":   newAvg,
		"rating_count": newCount,
	}).Error
}

// FindProfileByOwnerAndName checks for duplicate profile names.
func FindProfileByOwnerAndName(db *gorm.DB, ownerID, name string) (*model.AgentProfile, error) {
	var p model.AgentProfile
	err := db.Where("owner_id = ? AND name = ? AND deleted_at IS NULL", ownerID, name).First(&p).Error
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// DuplicateProfile copies a profile for install.
func DuplicateProfile(db *gorm.DB, src *model.AgentProfile, newOwnerID string) (*model.AgentProfile, error) {
	dup := *src
	dup.ID = ""        // let BeforeCreate generate new UUID
	dup.OwnerID = newOwnerID
	dup.IsPublic = false
	dup.InstallCount = 0
	dup.RatingAvg = 0
	dup.RatingCount = 0
	dup.Version = 1
	dup.CreatedAt = time.Time{}
	dup.UpdatedAt = time.Time{}
	dup.DeletedAt = nil
	if err := db.Create(&dup).Error; err != nil {
		return nil, err
	}
	return &dup, nil
}
