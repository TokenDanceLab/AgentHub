package handler

import (
	"errors"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/service/agentteam"
)

// TeamRole re-exports the service-layer enum so handler call sites remain
// unchanged. The canonical definition lives in the service package to satisfy
// the handler→service→repository layering constraint.
type TeamRole = agentteam.TeamRole

const (
	TeamRoleMember = agentteam.TeamRoleMember
	TeamRoleOwner  = agentteam.TeamRoleOwner
)

// checkTeamAccess enforces team-level authorization for the requesting user.
// It returns nil when access is granted; otherwise it writes an HTTP error
// response via Fail and returns errSentinel so callers can short-circuit
// with `return`.
func checkTeamAccess(c *gin.Context, svc AgentTeamService, teamID string, minRole TeamRole) error {
	userID := c.GetString("user_id")
	if err := svc.CheckTeamAccess(c.Request.Context(), userID, teamID, minRole); err != nil {
		failAuthz(c, err)
		return errSentinel
	}
	return nil
}

// resolveTeamIDFromRun extracts the team_id from a team run and enforces
// team-level access. Used by endpoints addressed by run_id or assignment_id
// where the team_id is not present in the URL path.
func resolveTeamIDFromRun(c *gin.Context, svc AgentTeamService, runID string, minRole TeamRole) error {
	teamID, err := svc.ResolveTeamIDFromRun(c.Request.Context(), runID)
	if err != nil {
		failAuthz(c, err)
		return errSentinel
	}
	return checkTeamAccess(c, svc, teamID, minRole)
}

// resolveTeamIDFromAssignment extracts the team_id via assignment → run → team
// and enforces team-level access.
func resolveTeamIDFromAssignment(c *gin.Context, svc AgentTeamService, assignmentID string, minRole TeamRole) error {
	teamID, err := svc.ResolveTeamIDFromAssignment(c.Request.Context(), assignmentID)
	if err != nil {
		failAuthz(c, err)
		return errSentinel
	}
	return checkTeamAccess(c, svc, teamID, minRole)
}

// failAuthz translates a service-layer authz error into an HTTP response.
func failAuthz(c *gin.Context, err error) {
	var ec *errcode.Error
	if errors.As(err, &ec) {
		Fail(c, ec)
		return
	}
	Fail(c, errcode.ErrInternal)
}

// errSentinel is an unexported marker so callers can `return` after Fail
// without leaking a nil-error success path.
var errSentinel = errors.New("authz: response written")
