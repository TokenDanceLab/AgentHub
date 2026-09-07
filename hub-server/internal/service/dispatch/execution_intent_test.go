package dispatch

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type executionIntentFixture struct {
	Version int `json:"version"`
	Cases   []struct {
		Name     string         `json:"name"`
		Payload  Payload        `json:"payload"`
		Expected map[string]any `json:"expectedIntent"`
	} `json:"cases"`
}

func TestExecutionIntentFixtureProjection(t *testing.T) {
	raw, err := os.ReadFile("../../../../tests/fixtures/dispatch/execution-intent.json")
	require.NoError(t, err)

	var fixture executionIntentFixture
	require.NoError(t, json.Unmarshal(raw, &fixture))
	require.NotEmpty(t, fixture.Cases)

	for _, c := range fixture.Cases {
		t.Run(c.Name, func(t *testing.T) {
			req := BuildEdgeRunRequest(c.Payload)
			assert.Equal(t, LocalProjectID, req.ProjectID)
			assert.Equal(t, LocalThreadID, req.ThreadID)
			assert.Equal(t, "edge", req.CallbackOwner)

			body, err := json.Marshal(req)
			require.NoError(t, err)
			got := map[string]any{}
			require.NoError(t, json.Unmarshal(body, &got))
			delete(got, "projectId")
			delete(got, "threadId")
			delete(got, "callbackOwner")

			want := cloneMap(c.Expected)
			assertJSONFieldEqual(t, got, want, "structuredOutputSchema")
			delete(got, "structuredOutputSchema")
			delete(want, "structuredOutputSchema")
			assert.Equal(t, want, got)
		})
	}
}

func TestPrepareEdgeHTTPRequestUsesPayloadProjection(t *testing.T) {
	raw, err := os.ReadFile("../../../../tests/fixtures/dispatch/execution-intent.json")
	require.NoError(t, err)
	var fixture executionIntentFixture
	require.NoError(t, json.Unmarshal(raw, &fixture))
	require.NotEmpty(t, fixture.Cases)

	parts, insecure, err := PrepareEdgeHTTPRequest(
		DefaultEdgeHTTPURL, "auth-token", fixture.Cases[0].Payload, "cap-token",
	)
	require.NoError(t, err)
	assert.False(t, insecure)
	assert.Equal(t, DefaultEdgeHTTPURL+"/v1/runs", parts.RunsURL)
	assert.Equal(t, "Bearer auth-token", parts.Headers.Get("Authorization"))
	assert.Equal(t, "cap-token", parts.Headers.Get(CapabilityTokenHeader))

	got := map[string]any{}
	require.NoError(t, json.Unmarshal(parts.Body, &got))
	assert.Equal(t, "edge", got["callbackOwner"])
	assert.Equal(t, LocalProjectID, got["projectId"])
	assert.Equal(t, LocalThreadID, got["threadId"])
}

func cloneMap(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func assertJSONFieldEqual(t *testing.T, got, want map[string]any, key string) {
	t.Helper()
	gotValue, gotOK := got[key]
	wantValue, wantOK := want[key]
	if !gotOK && !wantOK {
		return
	}
	require.True(t, gotOK, "%s missing from projection", key)
	require.True(t, wantOK, "%s missing from expected intent", key)
	gotString, ok := gotValue.(string)
	require.True(t, ok, "%s must project as a string", key)
	wantString, ok := wantValue.(string)
	require.True(t, ok, "%s expected as a string", key)

	var gotJSON, wantJSON any
	require.NoError(t, json.Unmarshal([]byte(gotString), &gotJSON))
	require.NoError(t, json.Unmarshal([]byte(wantString), &wantJSON))
	assert.Equal(t, wantJSON, gotJSON, "%s must match after JSON semantic comparison", key)
}

func TestTeamDispatchRequiresAuthoritativeDesktopBridge(t *testing.T) {
	for _, payload := range []Payload{
		{TeamRunID: "team-run"},
		{ModelParams: `{"agenthub_team_context":{"team_id":"team","team_run_id":"run"}}`},
		{ModelParams: `{"agenthub_team_context":"{\"teamId\":\"team\",\"teamRunId\":\"run\"}"}`},
	} {
		if !RequiresDesktopTeamRouting(payload) {
			t.Fatalf("team control route was treated as output-only: %#v", payload)
		}
	}
	if RequiresDesktopTeamRouting(Payload{ModelParams: `{"work_dir":"/workspace/project"}`}) {
		t.Fatal("ordinary task unnecessarily requires team routing")
	}
}
