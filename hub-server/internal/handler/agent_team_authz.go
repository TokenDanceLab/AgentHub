package handler

import (
	"errors"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/repository"
)

// TeamRole enumerates the minimum team role required by an endpoint.
type TeamRole int

const (
	// TeamRoleMember allows any user who owns the team OR owns an agent
	// profile installed as a team member.
	TeamRoleMember TeamRole = iota
	// TeamRoleOwner restricts access to the team owner only.
	TeamRoleOwner
)

// checkTeamAccess enforces team-level authorization for the requesting user.
// It returns nil when access is granted; otherwise it writes a 403 Forbidden
// response via Fail and returns a non-nil sentinel error so callers can
// short-circuit with `return`.
//
// Why 403 instead of the existing service-layer 404? The service layer
// historically returned errcode.AgentNotFound for both "team does not exist"
// and "user has no access", which conflates absence with denial and lets
// authenticated users probe for team IDs. Handler-level 403 makes the
// boundary explicit without modifying the service contract (#2100 P0).
func checkTeamAccess(c *gin.Context, db *gorm.DB, teamID string, minRole TeamRole) error {
	userID := c.GetString("user_id")
	if userID == "" {
		Fail(c, errcode.AuthInvalidToken)
		return errSentinel
	}
	if teamID == "" {
		Fail(c, errcode.ErrBadRequest)
		return errSentinel
	}

	team, err := repository.GetTeamByID(db, teamID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// Keep existing behaviour: unknown team surfaces as 404 so
			// clients cannot distinguish missing from forbidden.
			Fail(c, errcode.AgentNotFound)
			return errSentinel
		}
		Fail(c, errcode.ErrInternal)
		return errSentinel
	}

	isOwner := team.OwnerID == userID
	if minRole == TeamRoleOwner {
		if !isOwner {
			Fail(c, errcode.ErrForbidden.WithMessage("team owner required"))
			return errSentinel
		}
		return nil
	}

	// TeamRoleMember: owner passes; otherwise check membership via agent
	// profile ownership (matches getTeamForRead semantics).
	if isOwner {
		return nil
	}
	hasMember, err := repository.TeamHasAgentOwnedByUser(db, teamID, userID)
	if err != nil {
		Fail(c, errcode.ErrInternal)
		return errSentinel
	}
	if !hasMember {
		Fail(c, errcode.ErrForbidden.WithMessage("team membership required"))
		return errSentinel
	}
	return nil
}

// resolveTeamIDFromRun extracts the team_id from a team run and enforces
// team-level access. Used by endpoints addressed by run_id or assignment_id
// where the team_id is not present in the URL path.
func resolveTeamIDFromRun(c *gin.Context, db *gorm.DB, runID string, minRole TeamRole) error {
	if runID == "" {
		Fail(c, errcode.ErrBadRequest)
		return errSentinel
	}
	run, err := repository.GetTeamRunByID(db, runID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			Fail(c, errcode.AgentTaskNotFound)
			return errSentinel
		}
		Fail(c, errcode.ErrInternal)
		return errSentinel
	}
	return checkTeamAccess(c, db, run.TeamID, minRole)
}

// resolveTeamIDFromAssignment extracts the team_id via assignment → run → team
// and enforces team-level access.
func resolveTeamIDFromAssignment(c *gin.Context, db *gorm.DB, assignmentID string, minRole TeamRole) error {
	if assignmentID == "" {
		Fail(c, errcode.ErrBadRequest)
		return errSentinel
	}
	a, err := repository.GetAssignmentByID(db, assignmentID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			Fail(c, errcode.AgentTaskNotFound)
			return errSentinel
		}
		Fail(c, errcode.ErrInternal)
		return errSentinel
	}
	return resolveTeamIDFromRun(c, db, a.TeamRunID, minRole)
}

// errSentinel is an unexported marker so callers can `return` after Fail
// without leaking a nil-error success path.
var errSentinel = errors.New("authz: response written")
