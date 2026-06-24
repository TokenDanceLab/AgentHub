package model

import (
	"encoding/json"
	"testing"
)

func TestUserJSONPasswordExcluded(t *testing.T) {
	// Even if JSON includes password_hash, it should NOT be deserialized
	// into the struct because of the json:"-" tag.
	jsonStr := `{
		"id": "user-1",
		"username": "eve",
		"nickname": "Eve",
		"password_hash": "should-be-ignored"
	}`

	var u User
	if err := json.Unmarshal([]byte(jsonStr), &u); err != nil {
		t.Fatalf("json.Unmarshal error = %v", err)
	}
	if u.PasswordHash != nil {
		t.Errorf("PasswordHash = %q, want nil (json:\"-\" should skip it)", *u.PasswordHash)
	}
}

func stringPtr(s string) *string {
	return &s
}

// --- TableName tests ---

func TestTableNames(t *testing.T) {
	tests := []struct {
		instance interface{ TableName() string }
		want     string
	}{
		{AgentTeam{}, "agent_teams"},
		{AgentTeamMember{}, "agent_team_members"},
		{AgentTeamRun{}, "agent_team_runs"},
		{AgentTeamAssignment{}, "agent_team_assignments"},
		{AgentTeamTask{}, "agent_team_tasks"},
		{AgentTeamEvent{}, "agent_team_events"},
		{AgentTeamArtifact{}, "agent_team_artifacts"},
	}
	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			if got := tt.instance.TableName(); got != tt.want {
				t.Errorf("TableName() = %q, want %q", got, tt.want)
			}
		})
	}
}

// --- ValidActions ---

func TestValidActions(t *testing.T) {
	actions := ValidActions()
	expected := []string{"delegate", "review", "approve", "compete", "finish"}
	for _, a := range expected {
		if !actions[a] {
			t.Errorf("ValidActions() missing %q", a)
		}
	}
	if len(actions) != len(expected) {
		t.Errorf("ValidActions() has %d entries, want %d", len(actions), len(expected))
	}
}
