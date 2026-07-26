package dispatch

import (
	"fmt"
	"strings"
	"time"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

// NormalizeOptionalTargetID trims an optional execution-target id for validation.
func NormalizeOptionalTargetID(targetID string) string {
	return strings.TrimSpace(targetID)
}

// IsEmptyTargetID is true when no execution target was requested (validate no-op).
func IsEmptyTargetID(targetID string) bool {
	return strings.TrimSpace(targetID) == ""
}

// TriggerSessionDissolvedError returns SessionDissolved when the session is dissolved.
func TriggerSessionDissolvedError(dissolved bool) error {
	if dissolved {
		return errcode.SessionDissolved
	}
	return nil
}

// TriggerAgentsAvailableError returns AgentNotFound when the inviter has no agents
// or the list query failed (historical TriggerAgentTask error collapse).
func TriggerAgentsAvailableError(listErr error, agentCount int) error {
	if listErr != nil || agentCount == 0 {
		return errcode.AgentNotFound
	}
	return nil
}

// TriggerMemberActiveError surfaces the membership lookup error when the check
// itself failed — a DB fault must not be misread as "not a member" — and
// returns SessionNotMember when the inviter is not an active session member.
func TriggerMemberActiveError(checkErr error, active bool) error {
	if checkErr != nil {
		return fmt.Errorf("check session member active: %w", checkErr)
	}
	if !active {
		return errcode.SessionNotMember
	}
	return nil
}

// ApplyValidatedTarget maps a validated TargetSnapshot onto trigger task fields.
// When target is nil (no target requested / validation no-op), all returns are empty.
func ApplyValidatedTarget(target *TargetSnapshot) (targetID, targetType, edgeDeviceID string) {
	if target == nil {
		return "", "", ""
	}
	return target.ID, target.TargetType, target.DeviceID
}

// CustomAgentIDValue returns the trimmed non-empty custom agent id pointer value, or "".
func CustomAgentIDValue(customAgentID *string) string {
	if customAgentID == nil {
		return ""
	}
	return strings.TrimSpace(*customAgentID)
}

// NeedsCustomAgentPreload is true when TriggerAgentTask should load the custom
// agent profile before spawning the dispatch goroutine.
func NeedsCustomAgentPreload(customAgentID *string) bool {
	return CustomAgentIDValue(customAgentID) != ""
}

// AcceptCustomAgentPreload is true when a custom-agent preload query succeeded
// (historical TriggerAgentTask: err == nil then assign ca).
func AcceptCustomAgentPreload(err error) bool {
	return err == nil
}

// CustomAgentPreloadOrNil returns ca when preload succeeded, else nil.
func CustomAgentPreloadOrNil(err error, ca *model.CustomAgent) *model.CustomAgent {
	if !AcceptCustomAgentPreload(err) {
		return nil
	}
	return ca
}

// HasCustomAgentBinding is true when an agent instance is bound to a custom agent.
func HasCustomAgentBinding(customAgentID *string) bool {
	return CustomAgentIDValue(customAgentID) != ""
}

// NewQueuedPendingTask builds a pending task row in queued status. expireAt is
// injected by the caller (TTL / clock stay orchestration-side).
func NewQueuedPendingTask(
	agentInstanceID, triggeredByUserID, triggerMessageID, targetID, edgeDeviceID string,
	expireAt time.Time,
) *model.PendingAgentTask {
	return &model.PendingAgentTask{
		AgentInstanceID:   agentInstanceID,
		TriggeredByUserID: triggeredByUserID,
		TriggerMessageID:  triggerMessageID,
		TargetID:          targetID,
		EdgeDeviceID:      edgeDeviceID,
		Status:            model.TaskStatusQueued,
		ExpireAt:          expireAt,
	}
}
