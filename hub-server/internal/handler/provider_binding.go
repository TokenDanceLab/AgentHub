package handler

import (
	"context"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service"
)

// ProviderBindingService is the subset of *service.ProviderBindingService used by ProviderBindingHandler.
type ProviderBindingService interface {
	Create(ctx context.Context, ownerID string, req *model.ProviderBinding) (*model.ProviderBinding, error)
	Get(ctx context.Context, id, ownerID string) (*model.ProviderBinding, error)
	Update(ctx context.Context, id, ownerID string, req *model.ProviderBinding) (*model.ProviderBinding, error)
	Delete(ctx context.Context, id, ownerID string) error
	List(ctx context.Context, ownerID, cursor string, pageSize int) (*service.PBListResult, error)
}

type ProviderBindingHandler struct {
	service ProviderBindingService
}

func NewProviderBindingHandler(service ProviderBindingService) *ProviderBindingHandler {
	return &ProviderBindingHandler{service: service}
}

type createProviderBindingReq struct {
	BindingName string `json:"binding_name"`
	Provider    string `json:"provider" binding:"required"`
	BaseURL     string `json:"base_url"`
	IsAvailable *bool  `json:"is_available"`
	QuotaLimit  int64  `json:"quota_limit"`
	Metadata    string `json:"metadata"`
}

func (h *ProviderBindingHandler) List(c *gin.Context) {
	userID := c.GetString("user_id")
	cursor := c.Query("pageCursor")
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "50"))

	result, err := h.service.List(c.Request.Context(), userID, cursor, pageSize)
	if err != nil {
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, gin.H{
		"items": result.Items,
		"page":  gin.H{"nextCursor": result.Cursor, "hasMore": result.HasMore},
	})
}

func (h *ProviderBindingHandler) Create(c *gin.Context) {
	var req createProviderBindingReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")

	pb := &model.ProviderBinding{
		BindingName: req.BindingName,
		Provider:    req.Provider,
		BaseURL:     req.BaseURL,
		QuotaLimit:  req.QuotaLimit,
		Metadata:    req.Metadata,
	}
	if req.IsAvailable != nil {
		pb.IsAvailable = *req.IsAvailable
	}

	result, err := h.service.Create(c.Request.Context(), userID, pb)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, result)
}

func (h *ProviderBindingHandler) Update(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	var updates model.ProviderBinding
	if err := c.ShouldBindJSON(&updates); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	pb, err := h.service.Update(c.Request.Context(), id, userID, &updates)
	if err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, pb)
}

func (h *ProviderBindingHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	if err := h.service.Delete(c.Request.Context(), id, userID); err != nil {
		if e, ok := err.(*errcode.Error); ok {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, nil)
}
