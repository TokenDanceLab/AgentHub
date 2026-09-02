package repository

import (
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
	"gorm.io/gorm"
)

const defaultSkillPageSize = 50

func CreateSkill(db *gorm.DB, s *model.Skill) error {
	return db.Create(s).Error
}

func GetSkillByID(db *gorm.DB, id string) (*model.Skill, error) {
	var s model.Skill
	err := db.Where("id = ? AND deleted_at IS NULL", id).First(&s).Error
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func UpdateSkill(db *gorm.DB, s *model.Skill) error {
	return db.Save(s).Error
}

func SoftDeleteSkill(db *gorm.DB, id, ownerID string) error {
	return db.Model(&model.Skill{}).
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL", id, ownerID).
		Update("deleted_at", time.Now()).Error
}

// ListSkills returns skills for an owner with optional filters and cursor pagination.
func ListSkills(db *gorm.DB, ownerID, q, skillType, cursor string, pageSize int) ([]model.Skill, bool, error) {
	pageSize = config.ClampPageSize(pageSize, config.MaxListPageSize, defaultSkillPageSize)

	qry := db.Where("owner_id = ? AND deleted_at IS NULL", ownerID)
	if skillType != "" {
		qry = qry.Where("skill_type = ?", skillType)
	}
	if q != "" {
		qry = qry.Where("(name ILIKE ? ESCAPE '\\' OR description ILIKE ? ESCAPE '\\')", "%"+escapeILIKE(q)+"%", "%"+escapeILIKE(q)+"%")
	}
	if cursor != "" {
		qry = qry.Where("id > ?", cursor)
	}

	var skills []model.Skill
	if err := qry.Order("id ASC").Limit(pageSize + 1).Find(&skills).Error; err != nil {
		return nil, false, err
	}

	hasMore := len(skills) > pageSize
	if hasMore {
		skills = skills[:pageSize]
	}
	return skills, hasMore, nil
}

// ListPublicSkills returns published skills for the market.
func ListPublicSkills(db *gorm.DB, q, skillType, cursor string, pageSize int) ([]model.Skill, bool, error) {
	pageSize = config.ClampPageSize(pageSize, config.MaxListPageSize, defaultSkillPageSize)

	qry := db.Where("is_public = TRUE AND deleted_at IS NULL")
	if skillType != "" {
		qry = qry.Where("skill_type = ?", skillType)
	}
	if q != "" {
		qry = qry.Where("(name ILIKE ? ESCAPE '\\' OR description ILIKE ? ESCAPE '\\')", "%"+escapeILIKE(q)+"%", "%"+escapeILIKE(q)+"%")
	}
	if cursor != "" {
		qry = qry.Where("id > ?", cursor)
	}

	var skills []model.Skill
	if err := qry.Order("id ASC").Limit(pageSize + 1).Find(&skills).Error; err != nil {
		return nil, false, err
	}

	hasMore := len(skills) > pageSize
	if hasMore {
		skills = skills[:pageSize]
	}
	return skills, hasMore, nil
}

// FindSkillByOwnerAndName checks for duplicate skill names.
func FindSkillByOwnerAndName(db *gorm.DB, ownerID, name string) (*model.Skill, error) {
	var s model.Skill
	err := db.Where("owner_id = ? AND name = ? AND deleted_at IS NULL", ownerID, name).First(&s).Error
	if err != nil {
		return nil, err
	}
	return &s, nil
}
