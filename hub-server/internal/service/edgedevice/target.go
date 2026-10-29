package edgedevice

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/dispatch"
	"github.com/agenthub/hub-server/internal/service/edgeenrollment"
	"gorm.io/gorm"
)

// IsPairedDevice includes revoked credentials: ownership of delivery never
// falls back to legacy Desktop routing after a device is revoked.
func IsPairedDevice(db *gorm.DB, deviceID string) (bool, error) {
	if deviceID == "" {
		return false, nil
	}
	if db == nil {
		return false, errcode.TargetNotRoutable
	}
	var count int64
	err := db.Model(&model.EdgeDeviceCredential{}).Where("device_id = ?", deviceID).Count(&count).Error
	return count > 0, err
}

func (s *Service) IsPairedDevice(ctx context.Context, deviceID string) (bool, error) {
	return IsPairedDevice(s.db.WithContext(ctx), deviceID)
}

func (s *Service) ValidateTarget(ctx context.Context, target *model.ExecutionTarget, evidence *model.ExecutionTargetEvidence) error {
	if _, err := ResolveTarget(ctx, s.db, s.enrollment, target); err != nil {
		return err
	}
	return dispatch.ValidateTargetHealth(Health(target, evidence, time.Now()))
}

func ResolveTarget(ctx context.Context, db *gorm.DB, enrollment *edgeenrollment.Service, target *model.ExecutionTarget) (*edgeenrollment.Principal, error) {
	if enrollment == nil || target == nil || target.TargetType != "cloud_edge" || target.DeviceID == nil {
		return nil, errcode.TargetNotRoutable
	}
	p, err := resolveTargetPrincipal(db.WithContext(ctx), target)
	if err != nil {
		return nil, err
	}
	if err := enrollment.ValidatePrincipal(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}

func resolveTargetPrincipal(db *gorm.DB, target *model.ExecutionTarget) (*edgeenrollment.Principal, error) {
	if target == nil || target.TargetType != "cloud_edge" || target.DeviceID == nil {
		return nil, errcode.TargetNotRoutable
	}
	var row model.EdgeDeviceCredential
	if err := db.Where("target_id = ? AND device_id = ? AND user_id = ?", target.ID, *target.DeviceID, target.OwnerID).Take(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errcode.TargetNotRoutable
		}
		return nil, err
	}
	p := &edgeenrollment.Principal{DeviceID: row.DeviceID, UserID: row.UserID, IdentityID: row.UserIdentityID,
		Generation: row.Generation, OIDCClientID: row.OIDCClientID, TargetID: row.TargetID,
		RuntimeID: row.RuntimeID, WorkspaceRoot: row.WorkspaceRoot, ExpiresAt: row.ExpiresAt, CredentialHash: row.CredentialHash}
	return p, nil
}

// Health requires the authenticated heartbeat for this exact target/device.
func Health(target *model.ExecutionTarget, evidence *model.ExecutionTargetEvidence, now time.Time) string {
	if target == nil || target.DeviceID == nil || evidence == nil {
		return "registered"
	}
	if evidence.Source != "paired_device" || evidence.ObservedTargetID != target.ID || evidence.RouteKey != target.OwnerID+":edge:"+*target.DeviceID || evidence.ExpiresAt == nil {
		return "unknown"
	}
	return dispatch.ResolveExecutionTargetHealthState(target, evidence, now)
}

// ValidateModelParams rejects every execution-affecting browser/profile
// option outside the deliberately narrow SDK text contract.
func ValidateModelParams(raw string, workspace string) error {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var params map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &params); err != nil || params == nil {
		return errcode.ErrBadRequest.WithMessage("model_params must be an object")
	}
	for key, value := range params {
		switch key {
		case "work_dir", "workDir":
			var requested string
			if json.Unmarshal(value, &requested) != nil || requested != workspace {
				return errcode.ErrBadRequest.WithMessage("workspace is fixed by device pairing")
			}
		case "runtime_id", "runtimeId", "agent_id", "agentId", "agent_type":
			var requested string
			if json.Unmarshal(value, &requested) != nil || requested != "openai-sdk" {
				return errcode.ErrBadRequest.WithMessage("runtime is fixed by device pairing")
			}
		case "model", "reasoning_effort", "reasoningEffort", "system_prompt", "systemPrompt", "append_system_prompt", "appendSystemPrompt":
			var text string
			if json.Unmarshal(value, &text) != nil {
				return errcode.ErrBadRequest.WithMessage("invalid paired model parameter")
			}
		case "max_thinking_tokens", "maxThinkingTokens":
			var n int
			if json.Unmarshal(value, &n) != nil || n < 0 {
				return errcode.ErrBadRequest.WithMessage("invalid thinking token limit")
			}
		default:
			return errcode.ErrBadRequest.WithMessage("unsupported paired device model parameter: " + key)
		}
	}
	return nil
}

func BuildRunRequest(p *edgeenrollment.Principal, payload dispatch.Payload) (dispatch.EdgeRunRequest, error) {
	if p == nil || p.RuntimeID != "openai-sdk" || payload.AgentType != p.RuntimeID || p.WorkspaceRoot == "" || payload.SessionID == "" {
		return dispatch.EdgeRunRequest{}, errcode.TargetNotRoutable
	}
	if err := ValidateModelParams(payload.ModelParams, p.WorkspaceRoot); err != nil {
		return dispatch.EdgeRunRequest{}, err
	}
	if strings.TrimSpace(payload.ToolWhitelist) != "" {
		var tools []string
		if err := json.Unmarshal([]byte(payload.ToolWhitelist), &tools); err != nil || len(tools) > 0 {
			return dispatch.EdgeRunRequest{}, errcode.ErrBadRequest.WithMessage("paired SDK target does not support tools")
		}
	}
	if payload.OutputSchema != nil || payload.TeamRunID != "" {
		return dispatch.EdgeRunRequest{}, errcode.ErrBadRequest.WithMessage("paired SDK target supports text conversations only")
	}
	req := dispatch.BuildEdgeRunRequest(payload)
	req.ProjectID, req.ThreadID, req.WorkDir = "paired-"+p.DeviceID, "hub-"+payload.SessionID, p.WorkspaceRoot
	// Multi-turn state comes solely from Hub messages, not an implicit local
	// runtime continuation that can mix a different conversation's context.
	noContinue := false
	req.Continue = &noContinue
	return req, nil
}
