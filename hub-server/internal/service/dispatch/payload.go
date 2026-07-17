package dispatch

import (
	"encoding/json"

	"github.com/agenthub/hub-server/internal/model"
)

// CustomAgentFields is the pure subset of a custom-agent profile used when
// assembling a dispatch payload (no GORM / repository dependency).
type CustomAgentFields struct {
	SystemPrompt  string
	ModelParams   string
	ToolWhitelist string
	OutputSchema  *json.RawMessage
}

// CustomAgentFieldsFromModel projects a CustomAgent row into pure payload fields.
// Nil model yields nil (no custom-agent profile applied).
func CustomAgentFieldsFromModel(ca *model.CustomAgent) *CustomAgentFields {
	if ca == nil {
		return nil
	}
	return &CustomAgentFields{
		SystemPrompt:  ca.SystemPrompt,
		ModelParams:   ca.ModelParams,
		ToolWhitelist: ca.ToolWhitelist,
		OutputSchema:  ca.OutputSchema,
	}
}

// ApplyCustomAgentToPayload returns system prompt, model params, tool whitelist,
// and output schema for a payload when a custom agent profile is present.
// When customAgentID is empty or fields is nil, all return values are empty/nil.
func ApplyCustomAgentToPayload(customAgentID string, fields *CustomAgentFields) (systemPrompt, modelParams, toolWhitelist string, outputSchema *json.RawMessage) {
	if customAgentID == "" || fields == nil {
		return "", "", "", nil
	}
	return fields.SystemPrompt, fields.ModelParams, fields.ToolWhitelist, fields.OutputSchema
}

// ApplyTeamContextToPayload returns team attribution fields when TeamRunID is set.
// Empty TeamRunID yields zero strings (payload team fields stay omitted).
func ApplyTeamContextToPayload(tc TeamContext) (teamID, teamRunID, teamMemberID, teamMemberRole string) {
	if tc.TeamRunID == "" {
		return "", "", "", ""
	}
	return tc.TeamID, tc.TeamRunID, tc.TeamMemberID, tc.TeamMemberRole
}

// TeamMemberRefsFromProfiles maps (id, role, profileID) triples into TeamMemberRef
// rows for MatchTeamContext. Length of each slice must match; mismatched lengths
// use the minimum common length.
func TeamMemberRefsFromProfiles(ids, roles []string, profileIDs []*string) []TeamMemberRef {
	n := len(ids)
	if len(roles) < n {
		n = len(roles)
	}
	if len(profileIDs) < n {
		n = len(profileIDs)
	}
	if n == 0 {
		return nil
	}
	refs := make([]TeamMemberRef, n)
	for i := 0; i < n; i++ {
		refs[i] = TeamMemberRef{
			ID:             ids[i],
			Role:           roles[i],
			AgentProfileID: profileIDs[i],
		}
	}
	return refs
}

// TeamMemberRefsFromMembers maps team-member rows into pure refs without building
// intermediate id/role/profile triple slices.
func TeamMemberRefsFromMembers(members []model.AgentTeamMember) []TeamMemberRef {
	if len(members) == 0 {
		return nil
	}
	refs := make([]TeamMemberRef, len(members))
	for i := range members {
		refs[i] = TeamMemberRef{
			ID:             members[i].ID,
			Role:           members[i].Role,
			AgentProfileID: members[i].AgentProfileID,
		}
	}
	return refs
}
