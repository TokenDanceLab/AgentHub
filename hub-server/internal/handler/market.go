package handler

import (
	"context"
	"errors"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/agentprofile"
)

// MarketService is the subset of *agentprofile.Service used by MarketHandler.
type MarketService interface {
	SearchMarket(ctx context.Context, runtimeID, q, sortBy, cursor string, pageSize int) (*agentprofile.ListResult, error)
	GetPublic(ctx context.Context, id string) (*model.AgentProfile, error)
	Install(ctx context.Context, id, installerID string) (*model.AgentProfile, error)
	Rate(ctx context.Context, profileID, raterID string, score int) (float64, int, error)
}

// MarketHandler handles agent market endpoints.
type MarketHandler struct {
	service MarketService
}

// NewMarketHandler creates a new MarketHandler.
func NewMarketHandler(service MarketService) *MarketHandler {
	return &MarketHandler{service: service}
}

// rateReq is the request body for rating a profile.
type rateReq struct {
	Score int `json:"score" binding:"required"`
}

// SearchMarketProfiles handles GET /web/market/profiles.
func (h *MarketHandler) SearchMarketProfiles(c *gin.Context) {
	runtimeID := c.Query("runtime_id")
	q := c.Query("q")
	sortBy := c.DefaultQuery("sort_by", "recent")
	cursor := c.Query("pageCursor")
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", strconv.Itoa(config.DefaultPaginationLimit)))
	// Ceiling = repository.ListPublicProfiles (MaxListPageSize), which is also the
	// PageSize maximum api/openapi.yaml declares for GET /web/market/profiles
	// (#2243).
	pageSize = config.ClampPageSize(pageSize, config.MaxListPageSize, config.DefaultPaginationLimit)

	result, err := h.service.SearchMarket(c.Request.Context(), runtimeID, q, sortBy, cursor, pageSize)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, gin.H{
		"items": result.Items,
		"page":  gin.H{"nextCursor": result.Cursor, "hasMore": result.HasMore},
	})
}

// GetMarketProfile handles GET /web/market/profiles/:id.
func (h *MarketHandler) GetMarketProfile(c *gin.Context) {
	id := c.Param("id")
	profile, err := h.service.GetPublic(c.Request.Context(), id)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, profile)
}

// InstallMarketProfile handles POST /web/market/profiles/:id/install.
func (h *MarketHandler) InstallMarketProfile(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	profile, err := h.service.Install(c.Request.Context(), id, userID)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, profile)
}

// RateMarketProfile handles POST /web/market/profiles/:id/rate.
func (h *MarketHandler) RateMarketProfile(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	var req rateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	newAvg, newCount, err := h.service.Rate(c.Request.Context(), id, userID, req.Score)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, gin.H{
		"rating_avg":   newAvg,
		"rating_count": newCount,
	})
}
