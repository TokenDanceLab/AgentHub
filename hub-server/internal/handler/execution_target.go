package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/executiontarget"
)

// ExecutionTargetService is the subset of *executiontarget.Service used by ExecutionTargetHandler.
type ExecutionTargetService interface {
	Create(ctx context.Context, ownerID string, req *model.ExecutionTarget) (*model.ExecutionTarget, error)
	Get(ctx context.Context, id, ownerID string) (*model.ExecutionTarget, error)
	Update(ctx context.Context, id, ownerID string, patch *model.ExecutionTargetPatch) (*model.ExecutionTarget, error)
	Delete(ctx context.Context, id, ownerID string) error
	List(ctx context.Context, ownerID, targetType, cursor string, pageSize int) (*executiontarget.ListResult, error)
	Ping(ctx context.Context, id, ownerID string) error
}

type ExecutionTargetHandler struct {
	service ExecutionTargetService
}

func NewExecutionTargetHandler(service ExecutionTargetService) *ExecutionTargetHandler {
	return &ExecutionTargetHandler{service: service}
}

type createTargetReq struct {
	Name               string `json:"name" binding:"required"`
	TargetType         string `json:"target_type"`
	Host               string `json:"host"`
	Port               int    `json:"port"`
	WorkspaceRoot      string `json:"workspace_root"`
	WorkspaceAllowlist any    `json:"workspace_allowlist"`
	TrustLevel         string `json:"trust_level"`
	HealthState        string `json:"health_state"`
	AuthMethod         string `json:"auth_method"`
	DeviceID           string `json:"device_id"`
	Capabilities       any    `json:"capabilities"`
	Metadata           any    `json:"metadata"`
}

type executionTargetResponse struct {
	ID                 string     `json:"id"`
	OwnerID            string     `json:"owner_id"`
	DeviceID           *string    `json:"device_id,omitempty"`
	Name               string     `json:"name"`
	TargetType         string     `json:"target_type,omitempty"`
	Host               string     `json:"host,omitempty"`
	Port               int        `json:"port,omitempty"`
	WorkspaceRoot      string     `json:"workspace_root,omitempty"`
	WorkspaceAllowlist string     `json:"workspace_allowlist,omitempty"`
	TrustLevel         string     `json:"trust_level,omitempty"`
	HealthState        string     `json:"health_state,omitempty"`
	AuthMethod         string     `json:"auth_method,omitempty"`
	IsOnline           bool       `json:"is_online"`
	LastSeenAt         *time.Time `json:"last_seen_at,omitempty"`
	Capabilities       string     `json:"capabilities,omitempty"`
	Metadata           string     `json:"metadata,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

func toExecutionTargetResponse(target *model.ExecutionTarget) executionTargetResponse {
	if target == nil {
		return executionTargetResponse{}
	}
	authMethod := ""
	if model.IsValidExecutionTargetAuthMethod(target.AuthMethod) {
		authMethod = target.AuthMethod
	}
	return executionTargetResponse{
		ID:                 target.ID,
		OwnerID:            target.OwnerID,
		DeviceID:           target.DeviceID,
		Name:               target.Name,
		TargetType:         target.TargetType,
		Host:               target.Host,
		Port:               target.Port,
		WorkspaceRoot:      target.WorkspaceRoot,
		WorkspaceAllowlist: target.WorkspaceAllowlist,
		TrustLevel:         target.TrustLevel,
		HealthState:        target.HealthState,
		AuthMethod:         authMethod,
		IsOnline:           target.IsOnline,
		LastSeenAt:         target.LastSeenAt,
		Capabilities:       target.Capabilities,
		Metadata:           target.Metadata,
		CreatedAt:          target.CreatedAt,
		UpdatedAt:          target.UpdatedAt,
	}
}

func toExecutionTargetResponses(targets []model.ExecutionTarget) []executionTargetResponse {
	items := make([]executionTargetResponse, 0, len(targets))
	for i := range targets {
		items = append(items, toExecutionTargetResponse(&targets[i]))
	}
	return items
}

func normalizeTargetJSONField(field string, value any, wantObject bool) (string, *errcode.Error) {
	if value == nil {
		return "", nil
	}
	if s, ok := value.(string); ok {
		if s == "" {
			return "", nil
		}
		if wantObject {
			var obj map[string]any
			if err := json.Unmarshal([]byte(s), &obj); err != nil {
				return "", errcode.ErrBadRequest.WithMessage(field + " must be a JSON object")
			}
			return s, nil
		}
		var arr []any
		if err := json.Unmarshal([]byte(s), &arr); err != nil {
			return "", errcode.ErrBadRequest.WithMessage(field + " must be a JSON array")
		}
		return s, nil
	}
	if wantObject {
		if _, ok := value.(map[string]any); !ok {
			return "", errcode.ErrBadRequest.WithMessage(field + " must be a JSON object")
		}
	} else {
		switch value.(type) {
		case []any, []string:
		default:
			return "", errcode.ErrBadRequest.WithMessage(field + " must be a JSON array")
		}
	}
	b, err := json.Marshal(value)
	if err != nil {
		return "", errcode.ErrBadRequest.WithMessage(field + " is not valid JSON")
	}
	return string(b), nil
}

func (h *ExecutionTargetHandler) CreateTarget(c *gin.Context) {
	var req createTargetReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, errcode.ErrBadRequest)
		return
	}
	userID := c.GetString("user_id")

	if strings.TrimSpace(req.HealthState) != "" {
		Fail(c, errcode.ErrBadRequest.WithMessage("health_state is system-managed"))
		return
	}

	workspaceAllowlist, normErr := normalizeTargetJSONField("workspace_allowlist", req.WorkspaceAllowlist, false)
	if normErr != nil {
		Fail(c, normErr)
		return
	}
	capabilities, normErr := normalizeTargetJSONField("capabilities", req.Capabilities, true)
	if normErr != nil {
		Fail(c, normErr)
		return
	}
	metadata, normErr := normalizeTargetJSONField("metadata", req.Metadata, true)
	if normErr != nil {
		Fail(c, normErr)
		return
	}

	target := &model.ExecutionTarget{
		Name:               req.Name,
		TargetType:         req.TargetType,
		Host:               req.Host,
		Port:               req.Port,
		WorkspaceRoot:      req.WorkspaceRoot,
		WorkspaceAllowlist: workspaceAllowlist,
		TrustLevel:         req.TrustLevel,
		AuthMethod:         req.AuthMethod,
		Capabilities:       capabilities,
		Metadata:           metadata,
	}
	if req.DeviceID != "" {
		target.DeviceID = &req.DeviceID
	}

	result, err := h.service.Create(c.Request.Context(), userID, target)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	c.JSON(http.StatusCreated, Response{
		Code: errcode.OK.Code,
		Data: toExecutionTargetResponse(result),
	})
}

func (h *ExecutionTargetHandler) GetTarget(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")
	target, err := h.service.Get(c.Request.Context(), id, userID)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, toExecutionTargetResponse(target))
}

func (h *ExecutionTargetHandler) ListTargets(c *gin.Context) {
	userID := c.GetString("user_id")
	targetType := c.Query("target_type")
	cursor := c.Query("pageCursor")
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "50"))
	if pageSize <= 0 {
		pageSize = config.DefaultPaginationLimit
	}
	if pageSize > config.MaxPageLimit {
		pageSize = config.MaxPageLimit
	}

	result, err := h.service.List(c.Request.Context(), userID, targetType, cursor, pageSize)
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
		"items": toExecutionTargetResponses(result.Items),
		"page":  gin.H{"nextCursor": result.Cursor, "hasMore": result.HasMore},
	})
}

func (h *ExecutionTargetHandler) UpdateTarget(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	// PATCH semantics (#1545): absent = keep, value = set, null = clear
	// (nullable fields). The DTO uses three-state PatchField so omitted,
	// empty, and null are distinguishable; target_type / health_state are
	// not patchable at all.
	var patch model.ExecutionTargetPatch
	if err := c.ShouldBindJSON(&patch); err != nil {
		slog.Error("execution target update bind error", "request_id", middleware.GetRequestID(c), "user_id", userID, "target_id", id, "error", err)
		Fail(c, errcode.ErrBadRequest.WithMessage("invalid patch body"))
		return
	}

	target, err := h.service.Update(c.Request.Context(), id, userID, &patch)
	if err != nil {
		var e *errcode.Error
		if errors.As(err, &e) {
			Fail(c, e)
			return
		}
		Fail(c, errcode.ErrInternal)
		return
	}
	OK(c, toExecutionTargetResponse(target))
}

func (h *ExecutionTargetHandler) DeleteTarget(c *gin.Context) {
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

func (h *ExecutionTargetHandler) PingTarget(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("user_id")

	if err := h.service.Ping(c.Request.Context(), id, userID); err != nil {
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
