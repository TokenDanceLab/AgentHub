package repository

import (
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
	"gorm.io/gorm"
)

const defaultMCPServerPageSize = 50

// CreateMCPServer inserts a new MCP server record.
func CreateMCPServer(db *gorm.DB, m *model.MCPServer) error {
	return db.Create(m).Error
}

// GetMCPServerByID returns a single MCP server by ID (excluding soft-deleted).
func GetMCPServerByID(db *gorm.DB, id string) (*model.MCPServer, error) {
	var m model.MCPServer
	err := db.Where("id = ? AND deleted_at IS NULL", id).First(&m).Error
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// UpdateMCPServer saves updates to an existing MCP server.
func UpdateMCPServer(db *gorm.DB, m *model.MCPServer) error {
	return db.Save(m).Error
}

// SoftDeleteMCPServer marks an MCP server as deleted by the owner.
func SoftDeleteMCPServer(db *gorm.DB, id, ownerID string) error {
	return db.Model(&model.MCPServer{}).
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL", id, ownerID).
		Update("deleted_at", time.Now()).Error
}

// ListMCPServers returns MCP servers for an owner with optional filters and cursor pagination.
func ListMCPServers(db *gorm.DB, ownerID, q, transport, cursor string, pageSize int) ([]model.MCPServer, bool, error) {
	pageSize = config.ClampPageSize(pageSize, config.MaxListPageSize, defaultMCPServerPageSize)

	qry := db.Where("owner_id = ? AND deleted_at IS NULL", ownerID)
	if transport != "" {
		qry = qry.Where("transport = ?", transport)
	}
	if q != "" {
		qry = qry.Where("(name ILIKE ? ESCAPE '\\' OR command ILIKE ? ESCAPE '\\')", "%"+escapeILIKE(q)+"%", "%"+escapeILIKE(q)+"%")
	}
	if cursor != "" {
		qry = qry.Where("id > ?", cursor)
	}

	var servers []model.MCPServer
	if err := qry.Order("id ASC").Limit(pageSize + 1).Find(&servers).Error; err != nil {
		return nil, false, err
	}

	hasMore := len(servers) > pageSize
	if hasMore {
		servers = servers[:pageSize]
	}
	return servers, hasMore, nil
}

// ListPublicMCPServers returns published MCP servers for the public market.
func ListPublicMCPServers(db *gorm.DB, q, transport, cursor string, pageSize int) ([]model.MCPServer, bool, error) {
	pageSize = config.ClampPageSize(pageSize, config.MaxListPageSize, defaultMCPServerPageSize)

	qry := db.Where("is_public = TRUE AND deleted_at IS NULL")
	if transport != "" {
		qry = qry.Where("transport = ?", transport)
	}
	if q != "" {
		qry = qry.Where("(name ILIKE ? ESCAPE '\\' OR command ILIKE ? ESCAPE '\\')", "%"+escapeILIKE(q)+"%", "%"+escapeILIKE(q)+"%")
	}
	if cursor != "" {
		qry = qry.Where("id < ?", cursor)
	}

	qry = qry.Order("id DESC")

	var servers []model.MCPServer
	if err := qry.Limit(pageSize + 1).Find(&servers).Error; err != nil {
		return nil, false, err
	}
	hasMore := len(servers) > pageSize
	if hasMore {
		servers = servers[:pageSize]
	}
	return servers, hasMore, nil
}

// IncrementMCPServerInstallCount atomically increases install_count.
func IncrementMCPServerInstallCount(db *gorm.DB, id string) error {
	return db.Model(&model.MCPServer{}).Where("id = ?", id).
		UpdateColumn("install_count", gorm.Expr("install_count + 1")).Error
}

// FindMCPServerByOwnerAndName checks for duplicate MCP server names for an owner.
func FindMCPServerByOwnerAndName(db *gorm.DB, ownerID, name string) (*model.MCPServer, error) {
	var m model.MCPServer
	err := db.Where("owner_id = ? AND name = ? AND deleted_at IS NULL", ownerID, name).First(&m).Error
	if err != nil {
		return nil, err
	}
	return &m, nil
}
