package repository

import (
	"net/http"
	"strings"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"gorm.io/gorm"
)

const defaultProfilePageSize = 50

// ErrProfileVersionConflict is returned when an UpdateAgentProfile CAS
// (compare-and-set on version) matched zero rows: either the profile was
// deleted, or another writer incremented version between the caller's read
// and write. Surfaced as HTTP 409 so the existing handler errors.As(err, &e)
// path surfaces the conflict without needing service/handler edits.
var ErrProfileVersionConflict = errcode.New(
	"profile_version_conflict",
	"agent profile version conflict: another update modified the profile concurrently",
	http.StatusConflict,
)

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

// UpdateAgentProfile performs an optimistic-concurrency CAS update: the
// UPDATE is scoped to WHERE id = ? AND version = ? so a concurrent writer
// that bumped version between the caller's read and this write matches zero
// rows and returns ErrProfileVersionConflict (HTTP 409).
//
// Select("*") + Updates(p) writes ALL columns (including zero-value bools
// like is_public=false when toggled from true), preserving the previous
// db.Save(p) full-row write semantics. Callers (Publish/Unpublish/Update)
// always load the full profile via GetAgentProfileByID before mutating, so
// writing all fields back is a no-op for unchanged columns and the version
// bump is atomic in the same statement.
//
// Replaces the previous db.Save(p) path which did Version++ then a blind
// full-row write with no version guard — two concurrent updates would both
// read version=N, both write version=N+1, and the second would silently
// overwrite the first's fields (#1381 concurrent overwrite).
func UpdateAgentProfile(db *gorm.DB, p *model.AgentProfile) error {
	expectedVersion := p.Version
	p.Version = expectedVersion + 1

	result := db.Model(&model.AgentProfile{}).
		Where("id = ? AND version = ?", p.ID, expectedVersion).
		Select("*").
		Updates(p)
	if result.Error != nil {
		// Roll back the in-memory version bump so the caller's copy reflects
		// the pre-update state (the row did not change).
		p.Version = expectedVersion
		return result.Error
	}
	if result.RowsAffected == 0 {
		p.Version = expectedVersion
		return ErrProfileVersionConflict
	}
	return nil
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
	pageSize = config.ClampPageSize(pageSize, config.MaxListPageSize, defaultProfilePageSize)

	qry := db.Where("owner_id = ? AND deleted_at IS NULL", ownerID)
	if runtimeID != "" {
		qry = qry.Where("runtime_id = ?", runtimeID)
	}
	if q != "" {
		qry = qry.Where("(name ILIKE ? ESCAPE '\\' OR description ILIKE ? ESCAPE '\\')", "%"+escapeILIKE(q)+"%", "%"+escapeILIKE(q)+"%")
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
	pageSize = config.ClampPageSize(pageSize, config.MaxListPageSize, defaultProfilePageSize)

	qry := db.Where("is_public = TRUE AND deleted_at IS NULL")
	if runtimeID != "" {
		qry = qry.Where("runtime_id = ?", runtimeID)
	}
	if q != "" {
		qry = qry.Where("(name ILIKE ? ESCAPE '\\' OR description ILIKE ? ESCAPE '\\')", "%"+escapeILIKE(q)+"%", "%"+escapeILIKE(q)+"%")
	}
	if cursor != "" {
		switch sortBy {
		case "install_count", "rating":
			// Composite cursor "<sortValue>|<lastID>" from the service layer.
			// sortValue stays a numeric literal (the column is numeric, so
			// PostgreSQL coerces it); comparing it against uuid id would 500.
			parts := strings.SplitN(cursor, "|", 2)
			if len(parts) != 2 {
				break // malformed/legacy cursor: treat as fresh page
			}
			sortVal, lastID := parts[0], parts[1]
			if sortBy == "install_count" {
				qry = qry.Where("install_count < ? OR (install_count = ? AND id > ?)", sortVal, sortVal, lastID)
			} else {
				qry = qry.Where("rating_avg < ? OR (rating_avg = ? AND id > ?)", sortVal, sortVal, lastID)
			}
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
	dup.ID = "" // let BeforeCreate generate new UUID
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
