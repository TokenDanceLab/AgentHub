package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/sessionindex"
	"github.com/agenthub/edge-server/internal/store"
)

// Node-level shared configuration write gate (#2250 round-65 wave lane A):
//
//	POST   /v1/agent-profiles              — create an agent profile
//	PATCH  /v1/agent-profiles/{profileId}  — mutate systemPrompt/allowedTools/mcpConfig/permissionMode
//	DELETE /v1/agent-profiles/{profileId}  — remove a profile every local run resolves through
//	PATCH  /v1/settings                     — patch node settings (persisted, survives restart)
//
// The read side of these surfaces has been fail-closed since AH-SR-045 (#878):
// GetAgentProfiles / GetAgentProfile / GetSettings / GetRuntimeSessions all call
// denyRemoteHubSharedConfig, so a Hub multi-user caller cannot read them. The
// write side had no gate at all, i.e. the very same caller could not see an
// agent profile but could create, rewrite or delete one, and could patch node
// settings on disk. AgentProfile (store_types.go) carries no OwnerID/ProjectID/
// RunID, so the run-ownership paradigm (isRunOwnedBy) does not apply here; the
// asserted paradigm is therefore exactly the one the read gates already use —
// denyRemoteHubSharedConfig — with these invariants:
//
//   - Hub JWT multi-user caller: 404 on all four writes and all four reads.
//   - Denial bodies are byte-identical (after traceId) to the read-gate body,
//     so neither "not allowed" nor "does not exist" is distinguishable: the
//     endpoints must not become a profileId / settings existence oracle.
//   - Empty principal under Hub JWT (multi-user, no Hub identity) fails closed.
//   - The gate runs before decodeOptionalJSON: an unauthorized caller must not
//     be able to make the Edge decode a request body at all (#2154 1MB limit).
//   - Local single-tenant mode (no HubJWTSecret → documented sentinel) keeps
//     every pre-gate behaviour, field for field.

// ---------------------------------------------------------------------------
// Fixtures — real store/handler concretes, no fakes on the gated path
// ---------------------------------------------------------------------------

// newNodeConfigMultiUserHandler returns the standard fixture in multi-user mode
// (Hub JWT validation configured), which is the mode the gate must fail closed in.
func newNodeConfigMultiUserHandler() *Handler {
	h := newTestHandler()
	h.HubJWTSecret = "test-secret" // multi-user mode
	return h
}

// seedNodeConfigProfile creates a node-level agent profile the way the Edge
// itself does (no owner binding — that is the point of this slice).
func seedNodeConfigProfile(t *testing.T, h *Handler, id, name string) store.AgentProfile {
	t.Helper()
	profile, err := ensureStore(h).CreateAgentProfile(store.AgentProfile{
		ID:             id,
		Name:           name,
		AdapterID:      "codex",
		Model:          "gpt-5",
		PermissionMode: "ask",
		SystemPrompt:   "seed prompt",
		AllowedTools:   []string{"shell"},
		MCPConfig:      `{"mcpServers":{}}`,
	})
	if err != nil {
		t.Fatalf("CreateAgentProfile(%s): %v", id, err)
	}
	return profile
}

// seedNodeConfigSettings writes node settings directly through the store so a
// read/patch case has something to leak or mutate.
func seedNodeConfigSettings(t *testing.T, h *Handler, values map[string]string) {
	t.Helper()
	if _, err := ensureStore(h).UpsertSettings(values); err != nil {
		t.Fatalf("UpsertSettings(%v): %v", values, err)
	}
}

// stubNodeConfigRuntimeSessions pins the local session index so the runtime
// sessions surface has observable data (same override the existing
// handlers_runtime_sessions_test.go uses).
func stubNodeConfigRuntimeSessions(t *testing.T) {
	t.Helper()
	prev := listRuntimeSessions
	t.Cleanup(func() { listRuntimeSessions = prev })
	listRuntimeSessions = func(_ int, _ []sessionindex.RuntimeID) ([]sessionindex.SessionSummary, error) {
		return []sessionindex.SessionSummary{{
			Runtime:    sessionindex.RuntimeCodex,
			ID:         "sess-node-config",
			Title:      "observed title",
			Path:       "/tmp/fixture.jsonl",
			UpdatedAt:  "2026-07-16T10:00:00Z",
			SourceMode: sessionindex.SourceModeImport,
		}}, nil
	}
}

func nodeConfigRequest(method, target, userID, body string) *http.Request {
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, target, nil)
	} else {
		req = httptest.NewRequest(method, target, strings.NewReader(body))
	}
	return req.WithContext(withHubUser(req.Context(), userID))
}

func doNodeConfigPostAgentProfiles(h *Handler, userID, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.PostAgentProfiles(rec, nodeConfigRequest(http.MethodPost, "/v1/agent-profiles", userID, body))
	return rec
}

func doNodeConfigPatchAgentProfile(h *Handler, profileID, userID, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.PatchAgentProfile(rec, nodeConfigRequest(http.MethodPatch, "/v1/agent-profiles/"+profileID, userID, body), profileID)
	return rec
}

func doNodeConfigDeleteAgentProfile(h *Handler, profileID, userID string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.DeleteAgentProfile(rec, nodeConfigRequest(http.MethodDelete, "/v1/agent-profiles/"+profileID, userID, ""), profileID)
	return rec
}

func doNodeConfigPatchSettings(h *Handler, userID, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.PatchSettings(rec, nodeConfigRequest(http.MethodPatch, "/v1/settings", userID, body))
	return rec
}

func doNodeConfigGetAgentProfiles(h *Handler, userID string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.GetAgentProfiles(rec, nodeConfigRequest(http.MethodGet, "/v1/agent-profiles", userID, ""))
	return rec
}

func doNodeConfigGetAgentProfile(h *Handler, profileID, userID string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.GetAgentProfile(rec, nodeConfigRequest(http.MethodGet, "/v1/agent-profiles/"+profileID, userID, ""), profileID)
	return rec
}

func doNodeConfigGetSettings(h *Handler, userID string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.GetSettings(rec, nodeConfigRequest(http.MethodGet, "/v1/settings", userID, ""))
	return rec
}

func doNodeConfigGetRuntimeSessions(h *Handler, userID string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.GetRuntimeSessions(rec, nodeConfigRequest(http.MethodGet, "/v1/runtime-sessions", userID, ""))
	return rec
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

func nodeConfigErrorObject(t *testing.T, body string) map[string]any {
	t.Helper()
	var decoded map[string]any
	if err := json.Unmarshal([]byte(body), &decoded); err != nil {
		t.Fatalf("decode error body %q: %v", body, err)
	}
	errObj, ok := decoded["error"].(map[string]any)
	if !ok {
		t.Fatalf("error body = %#v, want error object", decoded)
	}
	return errObj
}

// assertNodeConfigDenied pins the exact denial shape of the shared-config gate:
// 404 + errcode.ErrNotFound + message "not found" — the shape the read gates
// have emitted since AH-SR-045. A distinct code or a "forbidden"/"shared config"
// message would tell an unauthorized caller that the profileId or the settings
// surface exists, i.e. turn the endpoint into an existence oracle.
func assertNodeConfigDenied(t *testing.T, rec *httptest.ResponseRecorder, what string) {
	t.Helper()
	if rec.Code != http.StatusNotFound {
		t.Fatalf("%s: status = %d, want 404; body=%s", what, rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), errcode.ErrNotFound.Code)
	if msg := nodeConfigErrorObject(t, rec.Body.String())["message"]; msg != "not found" {
		t.Fatalf("%s: error.message = %#v, want %q (distinct message = existence oracle)", what, msg, "not found")
	}
}

func nodeConfigData(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body %q: %v", rec.Body.String(), err)
	}
	if !strings.EqualFold(fmtCode(body), "ok") {
		t.Fatalf("envelope = %#v, want code ok", body)
	}
	return unwrapSuccess(body)
}

func fmtCode(body map[string]any) string {
	code, _ := body["code"].(string)
	return code
}

func nodeConfigListItems(t *testing.T, rec *httptest.ResponseRecorder) []any {
	t.Helper()
	items, ok := nodeConfigData(t, rec)["items"].([]any)
	if !ok {
		t.Fatalf("data = %#v, want items list", nodeConfigData(t, rec))
	}
	return items
}

func nodeConfigString(t *testing.T, data map[string]any, key, what string) string {
	t.Helper()
	got, ok := data[key].(string)
	if !ok {
		t.Fatalf("%s: data[%q] = %#v, want string", what, key, data[key])
	}
	return got
}

// ---------------------------------------------------------------------------
// Class 1 — Hub JWT multi-user: the four write paths must be denied
// ---------------------------------------------------------------------------

// TestNodeConfigGatePostAgentProfilesDeniedForHubUser is the privilege-escalation
// red test for creation: a Hub user who cannot even list profiles must not be
// able to plant one (systemPrompt / allowedTools / mcpConfig / permissionMode
// are what local runs then execute with).
func TestNodeConfigGatePostAgentProfilesDeniedForHubUser(t *testing.T) {
	h := newNodeConfigMultiUserHandler()
	seedNodeConfigProfile(t, h, "profile_seed", "Seed")

	rec := doNodeConfigPostAgentProfiles(h, "user-a",
		`{"name":"Attacker","adapterId":"codex","systemPrompt":"pwn","allowedTools":["shell"],"mcpConfig":"{\"mcpServers\":{\"evil\":{}}}","permissionMode":"bypassPermissions"}`)

	assertNodeConfigDenied(t, rec, "POST /v1/agent-profiles as Hub user")
	if profiles := ensureStore(h).ListAgentProfiles(""); len(profiles) != 1 {
		t.Errorf("ESCAPE: shared config was written — profiles = %d, want 1 (the seed only)", len(profiles))
	}
}

// TestNodeConfigGatePatchAgentProfileDeniedForHubUser pins that no field of an
// existing profile is mutated by a denied patch.
func TestNodeConfigGatePatchAgentProfileDeniedForHubUser(t *testing.T) {
	h := newNodeConfigMultiUserHandler()
	seedNodeConfigProfile(t, h, "profile_victim", "Victim")

	rec := doNodeConfigPatchAgentProfile(h, "profile_victim", "user-a",
		`{"name":"Hijacked","systemPrompt":"pwn","allowedTools":["shell","write"],"mcpConfig":"{\"mcpServers\":{\"evil\":{}}}","permissionMode":"bypassPermissions"}`)

	assertNodeConfigDenied(t, rec, "PATCH /v1/agent-profiles/{profileId} as Hub user")
	profile, ok := ensureStore(h).GetAgentProfile("profile_victim")
	if !ok {
		t.Fatal("ESCAPE: the denied patch removed the profile")
	}
	if profile.Name != "Victim" {
		t.Errorf("ESCAPE: name mutated to %q", profile.Name)
	}
	if profile.SystemPrompt != "seed prompt" {
		t.Errorf("ESCAPE: systemPrompt mutated to %q", profile.SystemPrompt)
	}
	if profile.PermissionMode != "ask" {
		t.Errorf("ESCAPE: permissionMode mutated to %q", profile.PermissionMode)
	}
	if len(profile.AllowedTools) != 1 || profile.AllowedTools[0] != "shell" {
		t.Errorf("ESCAPE: allowedTools mutated to %#v", profile.AllowedTools)
	}
	if profile.MCPConfig != `{"mcpServers":{}}` {
		t.Errorf("ESCAPE: mcpConfig mutated to %q", profile.MCPConfig)
	}
}

// TestNodeConfigGateDeleteAgentProfileDeniedForHubUser pins that a denied delete
// leaves the profile in place for its local runs.
func TestNodeConfigGateDeleteAgentProfileDeniedForHubUser(t *testing.T) {
	h := newNodeConfigMultiUserHandler()
	seedNodeConfigProfile(t, h, "profile_victim", "Victim")

	rec := doNodeConfigDeleteAgentProfile(h, "profile_victim", "user-a")

	assertNodeConfigDenied(t, rec, "DELETE /v1/agent-profiles/{profileId} as Hub user")
	if _, ok := ensureStore(h).GetAgentProfile("profile_victim"); !ok {
		t.Error("ESCAPE: the profile was deleted by a Hub multi-user caller")
	}
}

// TestNodeConfigGatePatchSettingsDeniedForHubUser pins the node settings write
// path: a denied patch must not reach the persisted settings map.
func TestNodeConfigGatePatchSettingsDeniedForHubUser(t *testing.T) {
	h := newNodeConfigMultiUserHandler()
	seedNodeConfigSettings(t, h, map[string]string{"theme": "light"})

	rec := doNodeConfigPatchSettings(h, "user-a", `{"theme":"dark","model":"attacker-model"}`)

	assertNodeConfigDenied(t, rec, "PATCH /v1/settings as Hub user")
	values := ensureStore(h).GetSettings().Values
	if values["theme"] != "light" {
		t.Errorf("ESCAPE: node settings mutated — theme = %q, want light", values["theme"])
	}
	if _, ok := values["model"]; ok {
		t.Errorf("ESCAPE: node settings gained key model = %q", values["model"])
	}
}

// ---------------------------------------------------------------------------
// Class 1b — the four existing read gates, pinned (they were green but untested)
// ---------------------------------------------------------------------------

func TestNodeConfigGateGetAgentProfilesDeniedForHubUser(t *testing.T) {
	h := newNodeConfigMultiUserHandler()
	seedNodeConfigProfile(t, h, "profile_read", "Read")

	assertNodeConfigDenied(t, doNodeConfigGetAgentProfiles(h, "user-a"), "GET /v1/agent-profiles as Hub user")
}

func TestNodeConfigGateGetAgentProfileDeniedForHubUser(t *testing.T) {
	h := newNodeConfigMultiUserHandler()
	seedNodeConfigProfile(t, h, "profile_read", "Read")

	assertNodeConfigDenied(t, doNodeConfigGetAgentProfile(h, "profile_read", "user-a"), "GET /v1/agent-profiles/{profileId} as Hub user")
}

func TestNodeConfigGateGetSettingsDeniedForHubUser(t *testing.T) {
	h := newNodeConfigMultiUserHandler()
	seedNodeConfigSettings(t, h, map[string]string{"theme": "dark"})

	assertNodeConfigDenied(t, doNodeConfigGetSettings(h, "user-a"), "GET /v1/settings as Hub user")
}

func TestNodeConfigGateGetRuntimeSessionsDeniedForHubUser(t *testing.T) {
	h := newNodeConfigMultiUserHandler()
	stubNodeConfigRuntimeSessions(t)

	assertNodeConfigDenied(t, doNodeConfigGetRuntimeSessions(h, "user-a"), "GET /v1/runtime-sessions as Hub user")
}

// ---------------------------------------------------------------------------
// Class 1c — write denial and read denial are the same response
// ---------------------------------------------------------------------------

// TestNodeConfigGateWriteAndReadDenialsAreByteIdentical is the oracle guard: the
// 404 body of every gated write must equal the 404 body of every gated read once
// the per-request traceId is stripped, and a denied write on an existing
// profileId must equal a denied write on a nonexistent one. Otherwise an
// unauthorized caller can distinguish "exists but not yours" from "does not
// exist" and enumerate the node's shared configuration.
func TestNodeConfigGateWriteAndReadDenialsAreByteIdentical(t *testing.T) {
	h := newNodeConfigMultiUserHandler()
	seedNodeConfigProfile(t, h, "profile_oracle", "Oracle")
	seedNodeConfigSettings(t, h, map[string]string{"theme": "dark"})
	stubNodeConfigRuntimeSessions(t)

	bodies := map[string]string{
		// write paths
		"POST /v1/agent-profiles":                  stripTraceID(doNodeConfigPostAgentProfiles(h, "user-a", `{"name":"x","adapterId":"codex"}`).Body.String()),
		"PATCH /v1/agent-profiles/profile_oracle":  stripTraceID(doNodeConfigPatchAgentProfile(h, "profile_oracle", "user-a", `{"name":"x"}`).Body.String()),
		"PATCH /v1/agent-profiles/profile_ghost":   stripTraceID(doNodeConfigPatchAgentProfile(h, "profile_ghost", "user-a", `{"name":"x"}`).Body.String()),
		"DELETE /v1/agent-profiles/profile_oracle": stripTraceID(doNodeConfigDeleteAgentProfile(h, "profile_oracle", "user-a").Body.String()),
		"DELETE /v1/agent-profiles/profile_ghost":  stripTraceID(doNodeConfigDeleteAgentProfile(h, "profile_ghost", "user-a").Body.String()),
		"PATCH /v1/settings":                       stripTraceID(doNodeConfigPatchSettings(h, "user-a", `{"theme":"dark"}`).Body.String()),
		// read paths (the pre-existing gate shape, AH-SR-045)
		"GET /v1/agent-profiles":                stripTraceID(doNodeConfigGetAgentProfiles(h, "user-a").Body.String()),
		"GET /v1/agent-profiles/profile_oracle": stripTraceID(doNodeConfigGetAgentProfile(h, "profile_oracle", "user-a").Body.String()),
		"GET /v1/agent-profiles/profile_ghost":  stripTraceID(doNodeConfigGetAgentProfile(h, "profile_ghost", "user-a").Body.String()),
		"GET /v1/settings":                      stripTraceID(doNodeConfigGetSettings(h, "user-a").Body.String()),
		"GET /v1/runtime-sessions":              stripTraceID(doNodeConfigGetRuntimeSessions(h, "user-a").Body.String()),
	}

	want := bodies["GET /v1/agent-profiles/profile_oracle"]
	if want == "" {
		t.Fatalf("read-gate body is empty; bodies = %#v", bodies)
	}
	for name, body := range bodies {
		if body != want {
			t.Errorf("%s denial body differs from the read gate (profileId/settings existence oracle):\n got  = %s\n read = %s", name, body, want)
		}
	}
	assertNodeConfigDenialMessage(t, want, "read gate")
	if _, ok := ensureStore(h).GetAgentProfile("profile_oracle"); !ok {
		t.Error("ESCAPE: the oracle probes deleted the profile")
	}
}

func assertNodeConfigDenialMessage(t *testing.T, body, what string) {
	t.Helper()
	if msg := nodeConfigErrorObject(t, body)["message"]; msg != "not found" {
		t.Fatalf("%s: error.message = %#v, want %q", what, msg, "not found")
	}
}

// ---------------------------------------------------------------------------
// Class 2 — empty principal under Hub JWT fails closed on all eight handlers
// ---------------------------------------------------------------------------

// TestNodeConfigGateFailsClosedWithoutHubIdentity mirrors AH-SR-045 for the whole
// surface: multi-user mode + no Hub identity = empty principal = nothing readable
// and nothing writable.
func TestNodeConfigGateFailsClosedWithoutHubIdentity(t *testing.T) {
	h := newNodeConfigMultiUserHandler()
	seedNodeConfigProfile(t, h, "profile_noid", "NoId")
	seedNodeConfigSettings(t, h, map[string]string{"theme": "dark"})
	stubNodeConfigRuntimeSessions(t)

	cases := []struct {
		name string
		call func() *httptest.ResponseRecorder
	}{
		{"post-agent-profiles", func() *httptest.ResponseRecorder {
			return doNodeConfigPostAgentProfiles(h, "", `{"name":"x","adapterId":"codex"}`)
		}},
		{"patch-agent-profile", func() *httptest.ResponseRecorder {
			return doNodeConfigPatchAgentProfile(h, "profile_noid", "", `{"name":"x"}`)
		}},
		{"delete-agent-profile", func() *httptest.ResponseRecorder {
			return doNodeConfigDeleteAgentProfile(h, "profile_noid", "")
		}},
		{"patch-settings", func() *httptest.ResponseRecorder {
			return doNodeConfigPatchSettings(h, "", `{"theme":"dark"}`)
		}},
		{"get-agent-profiles", func() *httptest.ResponseRecorder {
			return doNodeConfigGetAgentProfiles(h, "")
		}},
		{"get-agent-profile", func() *httptest.ResponseRecorder {
			return doNodeConfigGetAgentProfile(h, "profile_noid", "")
		}},
		{"get-settings", func() *httptest.ResponseRecorder {
			return doNodeConfigGetSettings(h, "")
		}},
		{"get-runtime-sessions", func() *httptest.ResponseRecorder {
			return doNodeConfigGetRuntimeSessions(h, "")
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assertNodeConfigDenied(t, tc.call(), tc.name+" without Hub identity")
		})
	}

	if profiles := ensureStore(h).ListAgentProfiles(""); len(profiles) != 1 {
		t.Errorf("ESCAPE: identity-less calls changed the profile set (%d, want 1)", len(profiles))
	}
	if values := ensureStore(h).GetSettings().Values; len(values) != 1 || values["theme"] != "dark" {
		t.Errorf("ESCAPE: identity-less calls changed node settings: %#v", values)
	}
}

// ---------------------------------------------------------------------------
// Gate position — denial happens before the request body is decoded
// ---------------------------------------------------------------------------

// TestNodeConfigGateDeniesBeforeDecodingBody pins the gate position mandated for
// this slice: method check → gate → decodeOptionalJSON. An unauthorized caller
// must not be able to make the Edge parse a body at all (decodeOptionalJSON is the
// shared 1MB limit point, #2154), so a malformed body must yield the same 404 and
// never a 400 that would prove the handler ran.
func TestNodeConfigGateDeniesBeforeDecodingBody(t *testing.T) {
	h := newNodeConfigMultiUserHandler()
	seedNodeConfigProfile(t, h, "profile_badjson", "BadJSON")

	cases := []struct {
		name string
		call func() *httptest.ResponseRecorder
	}{
		{"post-agent-profiles", func() *httptest.ResponseRecorder {
			return doNodeConfigPostAgentProfiles(h, "user-a", `{"name":`)
		}},
		{"patch-agent-profile", func() *httptest.ResponseRecorder {
			return doNodeConfigPatchAgentProfile(h, "profile_badjson", "user-a", `{"name":`)
		}},
		{"patch-settings", func() *httptest.ResponseRecorder {
			return doNodeConfigPatchSettings(h, "user-a", `{"theme":`)
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := tc.call()
			if rec.Code == http.StatusBadRequest {
				t.Fatalf("%s: 400 means the body was decoded before the gate ran; body=%s", tc.name, rec.Body.String())
			}
			assertNodeConfigDenied(t, rec, tc.name+" with malformed body as Hub user")
		})
	}
}

// ---------------------------------------------------------------------------
// Class 3 — local single-tenant mode is unchanged, field for field
// ---------------------------------------------------------------------------

// TestNodeConfigGateLocalSingleTenantPostAgentProfilesCreates guards the
// documented bypass: with no HubJWTSecret the sentinel principal keeps the
// pre-gate behaviour (201 + every submitted field echoed + persisted).
func TestNodeConfigGateLocalSingleTenantPostAgentProfilesCreates(t *testing.T) {
	h := newTestHandler() // HubJWTSecret empty → local single-tenant mode

	rec := doNodeConfigPostAgentProfiles(h, "",
		`{"name":"Local Profile","adapterId":"codex","model":"gpt-5","provider":"openai","systemPrompt":"local prompt","allowedTools":["shell","read"],"mcpConfig":"{\"mcpServers\":{}}","permissionMode":"ask","maxThinkingTokens":1024}`)

	if rec.Code != http.StatusCreated {
		t.Fatalf("local single-tenant POST status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	data := nodeConfigData(t, rec)
	id := nodeConfigString(t, data, "id", "local POST")
	if !strings.HasPrefix(id, "profile_") {
		t.Errorf("id = %q, want profile_ prefix", id)
	}
	for key, want := range map[string]string{
		"name":           "Local Profile",
		"adapterId":      "codex",
		"model":          "gpt-5",
		"provider":       "openai",
		"systemPrompt":   "local prompt",
		"mcpConfig":      `{"mcpServers":{}}`,
		"permissionMode": "ask",
	} {
		if got, _ := data[key].(string); got != want {
			t.Errorf("data[%q] = %#v, want %#v", key, got, want)
		}
	}
	tools, ok := data["allowedTools"].([]any)
	if !ok || len(tools) != 2 || tools[0] != "shell" || tools[1] != "read" {
		t.Errorf("data[allowedTools] = %#v, want [shell read]", data["allowedTools"])
	}
	if got, _ := data["maxThinkingTokens"].(float64); got != 1024 {
		t.Errorf("data[maxThinkingTokens] = %#v, want 1024", data["maxThinkingTokens"])
	}
	stored, ok := ensureStore(h).GetAgentProfile(id)
	if !ok {
		t.Fatalf("created profile %s is not in the store", id)
	}
	if stored.SystemPrompt != "local prompt" || stored.PermissionMode != "ask" {
		t.Errorf("stored profile = %+v, want the submitted fields", stored)
	}
	if stored.CreatedAt == "" || stored.UpdatedAt == "" {
		t.Errorf("stored timestamps empty: created=%q updated=%q", stored.CreatedAt, stored.UpdatedAt)
	}
}

// TestNodeConfigGateLocalSingleTenantPatchAgentProfileUpdates pins the local
// patch behaviour: 200 + patched fields + untouched fields preserved.
func TestNodeConfigGateLocalSingleTenantPatchAgentProfileUpdates(t *testing.T) {
	h := newTestHandler()
	seedNodeConfigProfile(t, h, "profile_local", "Local")

	rec := doNodeConfigPatchAgentProfile(h, "profile_local", "",
		`{"name":"Renamed","systemPrompt":"new prompt","permissionMode":"bypassPermissions"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("local single-tenant PATCH status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	data := nodeConfigData(t, rec)
	if got := nodeConfigString(t, data, "name", "local PATCH"); got != "Renamed" {
		t.Errorf("name = %q, want Renamed", got)
	}
	if got := nodeConfigString(t, data, "systemPrompt", "local PATCH"); got != "new prompt" {
		t.Errorf("systemPrompt = %q, want new prompt", got)
	}
	if got := nodeConfigString(t, data, "permissionMode", "local PATCH"); got != "bypassPermissions" {
		t.Errorf("permissionMode = %q, want bypassPermissions", got)
	}
	if got := nodeConfigString(t, data, "mcpConfig", "local PATCH"); got != `{"mcpServers":{}}` {
		t.Errorf("mcpConfig = %q, want the unpatched value", got)
	}
	stored, ok := ensureStore(h).GetAgentProfile("profile_local")
	if !ok {
		t.Fatal("patched profile disappeared from the store")
	}
	if stored.Name != "Renamed" || stored.SystemPrompt != "new prompt" || stored.PermissionMode != "bypassPermissions" {
		t.Errorf("stored profile = %+v, want the patched fields", stored)
	}
}

// TestNodeConfigGateLocalSingleTenantDeleteAgentProfileRemoves pins 204 + removal
// + the pre-existing 404 on a second delete.
func TestNodeConfigGateLocalSingleTenantDeleteAgentProfileRemoves(t *testing.T) {
	h := newTestHandler()
	seedNodeConfigProfile(t, h, "profile_local_del", "LocalDel")

	rec := doNodeConfigDeleteAgentProfile(h, "profile_local_del", "")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("local single-tenant DELETE status = %d, want 204; body=%s", rec.Code, rec.Body.String())
	}
	if rec.Body.Len() != 0 {
		t.Errorf("DELETE body = %q, want empty", rec.Body.String())
	}
	if _, ok := ensureStore(h).GetAgentProfile("profile_local_del"); ok {
		t.Error("profile survived the local delete")
	}

	again := doNodeConfigDeleteAgentProfile(h, "profile_local_del", "")
	if again.Code != http.StatusNotFound {
		t.Fatalf("second DELETE status = %d, want 404; body=%s", again.Code, again.Body.String())
	}
	assertErrorCode(t, again.Body.String(), errcode.ErrNotFound.Code)
}

// TestNodeConfigGateLocalSingleTenantPatchSettingsPersists pins the local settings
// write: 200 + merged values echoed + persisted in the store.
func TestNodeConfigGateLocalSingleTenantPatchSettingsPersists(t *testing.T) {
	h := newTestHandler()
	seedNodeConfigSettings(t, h, map[string]string{"theme": "light"})

	rec := doNodeConfigPatchSettings(h, "", `{"theme":"dark","locale":"zh-CN"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("local single-tenant PATCH /v1/settings status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	values, ok := nodeConfigData(t, rec)["values"].(map[string]any)
	if !ok {
		t.Fatalf("data = %#v, want a values map", nodeConfigData(t, rec))
	}
	if values["theme"] != "dark" || values["locale"] != "zh-CN" {
		t.Errorf("echoed values = %#v, want theme=dark locale=zh-CN", values)
	}
	stored := ensureStore(h).GetSettings().Values
	if stored["theme"] != "dark" || stored["locale"] != "zh-CN" {
		t.Errorf("stored values = %#v, want theme=dark locale=zh-CN", stored)
	}

	// The pre-existing validation errors must still fire in local mode.
	empty := doNodeConfigPatchSettings(h, "", `{}`)
	if empty.Code != http.StatusBadRequest {
		t.Fatalf("empty patch status = %d, want 400; body=%s", empty.Code, empty.Body.String())
	}
	assertErrorCode(t, empty.Body.String(), errcode.ErrBadRequest.Code)
	malformed := doNodeConfigPatchSettings(h, "", `{"theme":`)
	if malformed.Code != http.StatusBadRequest {
		t.Fatalf("malformed patch status = %d, want 400; body=%s", malformed.Code, malformed.Body.String())
	}
	assertErrorCode(t, malformed.Body.String(), errcode.ErrBadRequest.Code)
}

// TestNodeConfigGateLocalSingleTenantReadsReturnData pins that the four reads keep
// returning real data in local single-tenant mode (the gate must not turn into a
// blanket denial when no Hub JWT secret is configured).
func TestNodeConfigGateLocalSingleTenantReadsReturnData(t *testing.T) {
	h := newTestHandler()
	seedNodeConfigProfile(t, h, "profile_local_read", "LocalRead")
	seedNodeConfigSettings(t, h, map[string]string{"theme": "dark"})
	stubNodeConfigRuntimeSessions(t)

	list := doNodeConfigGetAgentProfiles(h, "")
	if list.Code != http.StatusOK {
		t.Fatalf("GET /v1/agent-profiles status = %d, want 200; body=%s", list.Code, list.Body.String())
	}
	items := nodeConfigListItems(t, list)
	if len(items) != 1 {
		t.Fatalf("profile items = %#v, want exactly the seeded profile", items)
	}
	first, _ := items[0].(map[string]any)
	if got, _ := first["id"].(string); got != "profile_local_read" {
		t.Errorf("item id = %q, want profile_local_read", got)
	}

	single := doNodeConfigGetAgentProfile(h, "profile_local_read", "")
	if single.Code != http.StatusOK {
		t.Fatalf("GET /v1/agent-profiles/{profileId} status = %d, want 200; body=%s", single.Code, single.Body.String())
	}
	singleData := nodeConfigData(t, single)
	if got := nodeConfigString(t, singleData, "name", "local GET profile"); got != "LocalRead" {
		t.Errorf("name = %q, want LocalRead", got)
	}
	if got := nodeConfigString(t, singleData, "systemPrompt", "local GET profile"); got != "seed prompt" {
		t.Errorf("systemPrompt = %q, want seed prompt", got)
	}

	settings := doNodeConfigGetSettings(h, "")
	if settings.Code != http.StatusOK {
		t.Fatalf("GET /v1/settings status = %d, want 200; body=%s", settings.Code, settings.Body.String())
	}
	settingsValues, ok := nodeConfigData(t, settings)["values"].(map[string]any)
	if !ok || settingsValues["theme"] != "dark" {
		t.Errorf("settings data = %#v, want values.theme=dark", nodeConfigData(t, settings))
	}

	sessions := doNodeConfigGetRuntimeSessions(h, "")
	if sessions.Code != http.StatusOK {
		t.Fatalf("GET /v1/runtime-sessions status = %d, want 200; body=%s", sessions.Code, sessions.Body.String())
	}
	sessionItems := nodeConfigListItems(t, sessions)
	if len(sessionItems) != 1 {
		t.Fatalf("runtime session items = %#v, want the stubbed session", sessionItems)
	}
	session, _ := sessionItems[0].(map[string]any)
	if got, _ := session["id"].(string); got != "sess-node-config" {
		t.Errorf("session id = %q, want sess-node-config", got)
	}

	missing := doNodeConfigGetAgentProfile(h, "profile_ghost", "")
	if missing.Code != http.StatusNotFound {
		t.Fatalf("GET unknown profile status = %d, want 404; body=%s", missing.Code, missing.Body.String())
	}
	assertErrorCode(t, missing.Body.String(), errcode.ErrNotFound.Code)
}
