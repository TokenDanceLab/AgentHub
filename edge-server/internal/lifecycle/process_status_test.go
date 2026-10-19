package lifecycle

import "testing"

func TestSubAgentRegistryTerminalStatus(t *testing.T) {
	cases := []struct {
		status string
		want   string
		update bool
	}{
		{"finished", "completed", true},
		{"completed_with_issues", "completed", true},
		{"failed", "error", true},
		{"cancelled", "error", true},
		{"running", "", false},
		{"queued", "", false},
	}
	for _, tc := range cases {
		got, update := subAgentRegistryTerminalStatus(tc.status)
		if string(got) != tc.want || update != tc.update {
			t.Errorf("subAgentRegistryTerminalStatus(%q) = (%q, %v), want (%q, %v)",
				tc.status, got, update, tc.want, tc.update)
		}
	}
}

func TestSubAgentResultMsgType(t *testing.T) {
	if got := subAgentResultMsgType("failed"); got != "error" {
		t.Errorf("failed msg type = %q, want error", got)
	}
	if got := subAgentResultMsgType("cancelled"); got != "error" {
		t.Errorf("cancelled msg type = %q, want error", got)
	}
	if got := subAgentResultMsgType("finished"); got != "result" {
		t.Errorf("finished msg type = %q, want result", got)
	}
}
