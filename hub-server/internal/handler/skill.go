package handler

import (
	"context"
	"errors"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/skill"
)

// SkillService is the subset of *skill.Service used by SkillHandler.
type SkillService interface {
	Create(ctx context.Context, ownerID string, req *model.Skill) (*model.Skill, error)
	Get(ctx context.Context, id, ownerID string) (*model.Skill, error)
	Update(ctx context.Context, id, ownerID string, req *model.Skill) (*model.Skill, error)
	Delete(ctx context.Context, id, ownerID string) error
	List(ctx context.Context, ownerID, q, skillType, cursor string, pageSize int) (*skill.ListResult, error)
	Publish(ctx context.Context, id, ownerID string) error
	Unpublish(ctx context.Context, id, ownerID string) error
	SearchPublic(ctx context.Context, q, skillType, cursor string, pageSize int) (*skill.ListResult, error)
}

type SkillHandler struct {
	service SkillService
}

func NewSkillHandler(service SkillService) *SkillHandler {
	return &SkillHandler{service: service}
}

type createSkillReq struct {
	Name         string `json:"name" binding:"required"`
	Description  string `json:"description"`
	SkillType    string `json:"skill_type" binding:"required"`
	RuntimeIDs   string `json:"runtime_ids"`
	EntryPoint   string `json:"entry_point"`
	ConfigSchema string `json:"config_schema"`
}

func (h *SkillHandler) CreateSkill(c *gin.Context) {
	var req createSkillReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")

	skill := &model.Skill{
		Name:         req.Name,
		Description:  req.Description,
		SkillType:    req.SkillType,
		RuntimeIDs:   req.RuntimeIDs,
		EntryPoint:   req.EntryPoint,
		ConfigSchema: req.ConfigSchema,
	}

	result, err := h.service.Create(c.Request.Context(), userID, skill)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, result)
}

func (h *SkillHandler) GetSkill(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")
	skill, err := h.service.Get(c.Request.Context(), id, userID)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, skill)
}

func (h *SkillHandler) ListSkills(c *gin.Context) {
	userID := c.GetString("user_id")
	q := c.Query("q")
	skillType := c.Query("skill_type")
	cursor := c.Query("pageCursor")
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", strconv.Itoa(config.DefaultPaginationLimit)))
	isPublic := c.DefaultQuery("is_public", "")
	// Ceiling = the one the queries below actually execute: repository.ListSkills
	// and repository.ListPublicSkills both ClampPageSize(.., MaxListPageSize, ..),
	// which is also what api/openapi.yaml declares for the shared PageSize
	// parameter on GET /web/skills. The old MaxPageLimit ceiling forwarded 300 to
	// a query that returned 200 rows with HTTP 200 and no signal (#2243).
	pageSize = config.ClampPageSize(pageSize, config.MaxListPageSize, config.DefaultPaginationLimit)

	if isPublic == "true" {
		// Public market: return all published skills (no owner filter).
		result, err := h.service.SearchPublic(c.Request.Context(), q, skillType, cursor, pageSize)
		if err != nil {
			Fail(c, errcode.ErrInternal)
			return
		}
		OK(c, gin.H{
			"items": result.Items,
			"page":  gin.H{"nextCursor": result.Cursor, "hasMore": result.HasMore},
		})
		return
	}

	result, err := h.service.List(c.Request.Context(), userID, q, skillType, cursor, pageSize)
	if err != nil {
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, gin.H{
		"items": result.Items,
		"page":  gin.H{"nextCursor": result.Cursor, "hasMore": result.HasMore},
	})
}

func (h *SkillHandler) UpdateSkill(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	var updates model.Skill
	if err := c.ShouldBindJSON(&updates); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}

	skill, err := h.service.Update(c.Request.Context(), id, userID, &updates)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, skill)
}

func (h *SkillHandler) DeleteSkill(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	if err := h.service.Delete(c.Request.Context(), id, userID); err != nil {
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

func (h *SkillHandler) PublishSkill(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	if err := h.service.Publish(c.Request.Context(), id, userID); err != nil {
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

func (h *SkillHandler) UnpublishSkill(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	if err := h.service.Unpublish(c.Request.Context(), id, userID); err != nil {
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
