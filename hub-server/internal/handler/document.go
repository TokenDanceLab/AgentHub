package handler

import (
	"context"
	"errors"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

// DocumentService defines the interface consumed by DocumentHandler.
type DocumentService interface {
	CreateDocument(ctx context.Context, userID, title, docType, location string, tag *string, content *string) (*model.Document, error)
	GetDocument(ctx context.Context, userID, docID string) (*model.Document, error)
	UpdateDocument(ctx context.Context, userID, docID string, title, docType *string, tag *string, content *string) (*model.Document, error)
	DeleteDocument(ctx context.Context, userID, docID string) error
	ListDocuments(ctx context.Context, userID string, filter model.DocumentFilter) ([]model.DocumentListItem, error)
}

// DocumentHandler handles HTTP requests for cloud documents.
type DocumentHandler struct {
	service DocumentService
}

// NewDocumentHandler creates a new DocumentHandler.
func NewDocumentHandler(s DocumentService) *DocumentHandler {
	return &DocumentHandler{service: s}
}

// --- Request types ---

type createDocumentReq struct {
	Title    string  `json:"title" binding:"required"`
	Type     string  `json:"type"`
	Tag      *string `json:"tag"`
	Location string  `json:"location"`
	Content  *string `json:"content"`
}

type updateDocumentReq struct {
	Title   *string `json:"title"`
	Type    *string `json:"type"`
	Tag     *string `json:"tag"`
	Content *string `json:"content"`
}

// CreateDocument handles POST /web/documents.
func (h *DocumentHandler) CreateDocument(c *gin.Context) {
	userID := c.GetString("user_id")
	var req createDocumentReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	doc, err := h.service.CreateDocument(c.Request.Context(), userID, req.Title, req.Type, req.Location, req.Tag, req.Content)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, doc)
}

// GetDocument handles GET /web/documents/:id.
func (h *DocumentHandler) GetDocument(c *gin.Context) {
	userID := c.GetString("user_id")
	docID := c.Param("id")
	doc, err := h.service.GetDocument(c.Request.Context(), userID, docID)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, doc)
}

// ListDocuments handles GET /web/documents.
func (h *DocumentHandler) ListDocuments(c *gin.Context) {
	userID := c.GetString("user_id")
	var filter model.DocumentFilter
	_ = c.ShouldBindQuery(&filter)
	items, err := h.service.ListDocuments(c.Request.Context(), userID, filter)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	if items == nil {
		items = []model.DocumentListItem{}
	}
	OK(c, gin.H{"items": items})
}

// UpdateDocument handles PATCH /web/documents/:id.
func (h *DocumentHandler) UpdateDocument(c *gin.Context) {
	userID := c.GetString("user_id")
	docID := c.Param("id")
	var req updateDocumentReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	doc, err := h.service.UpdateDocument(c.Request.Context(), userID, docID, req.Title, req.Type, req.Tag, req.Content)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, doc)
}

// DeleteDocument handles DELETE /web/documents/:id.
func (h *DocumentHandler) DeleteDocument(c *gin.Context) {
	userID := c.GetString("user_id")
	docID := c.Param("id")
	if err := h.service.DeleteDocument(c.Request.Context(), userID, docID); err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}
