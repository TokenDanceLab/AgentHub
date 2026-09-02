package repository

import (
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
	"gorm.io/gorm"
)

const defaultWorkspacePageSize = 50

func CreateWorkspace(db *gorm.DB, w *model.Workspace) error {
	return db.Create(w).Error
}

func GetWorkspaceByID(db *gorm.DB, id string) (*model.Workspace, error) {
	var w model.Workspace
	if err := db.Where("id = ?", id).First(&w).Error; err != nil {
		return nil, err
	}
	return &w, nil
}

func UpdateWorkspace(db *gorm.DB, w *model.Workspace) error {
	return db.Save(w).Error
}

func ListWorkspaces(db *gorm.DB, ownerID, q, cursor string, pageSize int) ([]model.Workspace, bool, error) {
	pageSize = config.ClampPageSize(pageSize, config.MaxListPageSize, defaultWorkspacePageSize)

	query := db.Where("owner_id = ?", ownerID)
	if q != "" {
		// LIKE wildcards in user input are escaped so % and _ match
		// literally (message.go escapeILIKE sample, #2154).
		like := "%" + escapeILIKE(q) + "%"
		query = query.Where("name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'", like, like)
	}
	if cursor != "" {
		query = query.Where("id > ?", cursor)
	}

	var workspaces []model.Workspace
	if err := query.Order("id ASC").Limit(pageSize + 1).Find(&workspaces).Error; err != nil {
		return nil, false, err
	}

	hasMore := len(workspaces) > pageSize
	if hasMore {
		workspaces = workspaces[:pageSize]
	}
	return workspaces, hasMore, nil
}

func FindWorkspaceByOwnerAndName(db *gorm.DB, ownerID, name string) (*model.Workspace, error) {
	var w model.Workspace
	if err := db.Where("owner_id = ? AND name = ?", ownerID, name).First(&w).Error; err != nil {
		return nil, err
	}
	return &w, nil
}
