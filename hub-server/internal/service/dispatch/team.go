package dispatch

import "strings"

// MatchTeamContext maps a custom-agent profile onto team-run attribution.
// When customAgentID is empty, returns a zero TeamContext (no team fields).
// When a matching member is found, fills TeamMemberID/Role; otherwise returns
// team+run IDs only (member fields empty).
func MatchTeamContext(teamID, teamRunID, customAgentID string, members []TeamMemberRef) TeamContext {
	customAgentID = strings.TrimSpace(customAgentID)
	if customAgentID == "" || teamRunID == "" {
		return TeamContext{}
	}
	for _, member := range members {
		if member.AgentProfileID == nil || strings.TrimSpace(*member.AgentProfileID) != customAgentID {
			continue
		}
		return TeamContext{
			TeamID:         teamID,
			TeamRunID:      teamRunID,
			TeamMemberID:   member.ID,
			TeamMemberRole: member.Role,
		}
	}
	return TeamContext{
		TeamID:    teamID,
		TeamRunID: teamRunID,
	}
}
