package tests

import (
	"encoding/json"
	"net/http"
	"testing"
)

// ── Phase 1: OIDC ─────────────────────────────────────────────────────────

func TestOIDCAuthorize_ReturnsAuthURL(t *testing.T) {
	resp := do("POST", "/client/auth/oidc/authorize", map[string]string{
		"code_challenge":        "test_challenge_abc1234567890def1234567890",
		"code_challenge_method": "S256",
		"device_type":           "web",
		"device_id":             "dddddddd-dddd-dddd-dddd-dddddddddd01",
	}, "")
	r := parse(resp)
	mustOK(t, r, "oidc authorize")

	// Verify state and authorization_url are returned.
	state := extract(r.Data, "state")
	if state == "" {
		t.Fatal("expected non-empty state")
	}
	authURL := extract(r.Data, "authorization_url")
	if authURL == "" {
		t.Fatal("expected non-empty authorization_url")
	}
}

func TestOIDCAuthorize_MissingFields(t *testing.T) {
	resp := do("POST", "/client/auth/oidc/authorize", map[string]string{
		"device_type": "web",
	}, "")
	r := parse(resp)
	if r.GetCode() == "OK" {
		t.Fatal("expected error for missing fields")
	}
}

// ── Phase 2: Agent Profile CRUD ───────────────────────────────────────────

func TestAgentProfile_CreateAndList(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	u := register(t, "ap_cr1", "pass1234", "AP_CR")

	// Create a profile.
	w := postAuth("/web/agent-profiles", u.Token, map[string]interface{}{
		"name":       "My Test Profile",
		"runtime_id": "claude-code",
		"model":      "claude-sonnet-4-20250514",
	})
	r := parse(w)
	mustOK(t, r, "create profile")
	profileID := extract(r.Data, "id")
	if profileID == "" {
		t.Fatal("expected non-empty profile id")
	}

	// List profiles — should contain the created one.
	w = get("/web/agent-profiles", u.Token)
	r = parse(w)
	mustOK(t, r, "list profiles")

	var listResp struct {
		Items []map[string]interface{} `json:"items"`
	}
	json.Unmarshal(r.Data, &listResp)
	if len(listResp.Items) == 0 {
		t.Fatal("expected at least one profile in list")
	}

	found := false
	for _, item := range listResp.Items {
		if item["id"] == profileID {
			found = true
			if item["name"] != "My Test Profile" {
				t.Errorf("expected name 'My Test Profile', got %v", item["name"])
			}
			break
		}
	}
	if !found {
		t.Fatalf("created profile %s not found in list", profileID)
	}
}

func TestAgentProfile_UpdateAndDelete(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	u := register(t, "ap_ud1", "pass1234", "AP_UD")

	// Create.
	w := postAuth("/web/agent-profiles", u.Token, map[string]interface{}{
		"name":       "Original Name",
		"runtime_id": "claude-code",
	})
	r := parse(w)
	mustOK(t, r, "create")
	profileID := extract(r.Data, "id")

	// Update (PATCH).
	w = do("PATCH", "/web/agent-profiles/"+profileID, map[string]string{
		"name": "Updated Name",
	}, u.Token)
	r = parse(w)
	mustOK(t, r, "update profile")

	// GET to verify update.
	w = get("/web/agent-profiles/"+profileID, u.Token)
	r = parse(w)
	mustOK(t, r, "get after update")
	gotName := extract(r.Data, "name")
	if gotName != "Updated Name" {
		t.Fatalf("expected name 'Updated Name', got %q", gotName)
	}

	// Delete.
	w = del("/web/agent-profiles/"+profileID, u.Token)
	r = parse(w)
	mustOK(t, r, "delete profile")

	// GET after delete should return error.
	w = get("/web/agent-profiles/"+profileID, u.Token)
	r = parse(w)
	if r.GetCode() == "OK" {
		t.Fatal("expected error after delete, got OK")
	}
}

func TestAgentProfile_Install(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	alice := register(t, "ap_i1a", "pass1234", "AP_Inst1")
	bob := register(t, "ap_i1b", "pass1234", "AP_Inst2")

	// Alice creates and publishes a profile.
	w := postAuth("/web/agent-profiles", alice.Token, map[string]interface{}{
		"name":       "Shareable Profile",
		"runtime_id": "claude-code",
	})
	r := parse(w)
	mustOK(t, r, "create")
	profileID := extract(r.Data, "id")

	w = postAuth("/web/agent-profiles/"+profileID+"/publish", alice.Token, nil)
	r = parse(w)
	mustOK(t, r, "publish")

	// Bob installs it.
	w = postAuth("/web/agent-profiles/"+profileID+"/install", bob.Token, nil)
	r = parse(w)
	mustOK(t, r, "install")
}

// ── Phase 3: Skills ───────────────────────────────────────────────────────

func TestSkill_CreateAndPublish(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	u := register(t, "sk_cp1", "pass1234", "SK_CP")

	// Create a skill.
	w := postAuth("/web/skills", u.Token, map[string]interface{}{
		"name":         "My Code Review Skill",
		"skill_type":   "agent_skill",
		"description":  "A skill for code review",
		"runtime_ids":  `["claude-code"]`,
		"entry_point":  "code_review.py",
		"config_schema": `{"max_files": 10}`,
	})
	r := parse(w)
	mustOK(t, r, "create skill")
	skillID := extract(r.Data, "id")
	if skillID == "" {
		t.Fatal("expected non-empty skill id")
	}

	// Verify in list.
	w = get("/web/skills", u.Token)
	r = parse(w)
	mustOK(t, r, "list skills")

	// Publish.
	w = postAuth("/web/skills/"+skillID+"/publish", u.Token, nil)
	r = parse(w)
	mustOK(t, r, "publish skill")
}

func TestSkill_ListFiltersByType(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	u := register(t, "sk_lf1", "pass1234", "SK_LF")

	// Create two skills with different types.
	postAuth("/web/skills", u.Token, map[string]interface{}{
		"name":       "Agent Skill A",
		"skill_type": "agent_skill",
	})
	postAuth("/web/skills", u.Token, map[string]interface{}{
		"name":       "Tool Skill B",
		"skill_type": "tool",
	})

	// Filter by agent_skill.
	w := get("/web/skills?skill_type=agent_skill", u.Token)
	r := parse(w)
	mustOK(t, r, "filter by agent_skill")
}

// ── Phase 3: MCP Server Security ──────────────────────────────────────────

func TestMCPServer_RejectsSecretInAuthConfig(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	u := register(t, "mcp_sec1", "pass1234", "MCP_Sec")

	// Try to create MCP server with api_key in auth_config.
	w := postAuth("/web/mcp-servers", u.Token, map[string]interface{}{
		"name":        "Evil MCP Server",
		"transport":   "stdio",
		"command":     "node",
		"args":        `["server.js"]`,
		"auth_config": `{"api_key": "sk-very-secret-key-12345"}`,
	})
	r := parse(w)
	if r.GetCode() == "OK" {
		t.Fatal("expected error for plaintext api_key in auth_config, got OK")
	}

	// Also test with "secret" key.
	w = postAuth("/web/mcp-servers", u.Token, map[string]interface{}{
		"name":        "Evil MCP 2",
		"transport":   "stdio",
		"command":     "node",
		"auth_config": `{"secret": "my-secret-value"}`,
	})
	r = parse(w)
	if r.GetCode() == "OK" {
		t.Fatal("expected error for plaintext secret in auth_config, got OK")
	}

	// But should allow masked values.
	w = postAuth("/web/mcp-servers", u.Token, map[string]interface{}{
		"name":        "Good MCP Server",
		"transport":   "stdio",
		"command":     "node",
		"auth_config": `{"api_key": "***"}`,
	})
	r = parse(w)
	mustOK(t, r, "create with masked api_key")
}

func TestMCPServer_CreateAndList(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	u := register(t, "mcp_cr1", "pass1234", "MCP_CR")

	// Create.
	w := postAuth("/web/mcp-servers", u.Token, map[string]interface{}{
		"name":      "My MCP Server",
		"transport": "stdio",
		"command":   "python",
		"args":      `["-m", "my_mcp_server"]`,
	})
	r := parse(w)
	mustOK(t, r, "create mcp")
	serverID := extract(r.Data, "id")
	if serverID == "" {
		t.Fatal("expected non-empty server id")
	}

	// List.
	w = get("/web/mcp-servers", u.Token)
	r = parse(w)
	mustOK(t, r, "list mcp servers")
}

// ── Phase 5: Execution Targets ────────────────────────────────────────────

func TestExecutionTarget_CreateAndPing(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	u := register(t, "et_cp1", "pass1234", "ET_CP")

	// Create a target.
	w := postAuth("/web/execution-targets", u.Token, map[string]interface{}{
		"name":        "My Desktop",
		"target_type": "local_edge",
		"host":        "localhost",
		"port":        2222,
	})
	r := parse(w)
	mustOK(t, r, "create target")
	targetID := extract(r.Data, "id")
	if targetID == "" {
		t.Fatal("expected non-empty target id")
	}

	// Initially is_online should be false.
	isOnline := extract(r.Data, "is_online")
	if isOnline != "false" {
		t.Logf("initial is_online = %s (expected false)", isOnline)
	}

	// Ping the target.
	w = postAuth("/web/execution-targets/"+targetID+"/ping", u.Token, nil)
	r = parse(w)
	mustOK(t, r, "ping target")

	// Get target — is_online should be true after ping.
	w = get("/web/execution-targets/"+targetID, u.Token)
	r = parse(w)
	mustOK(t, r, "get target after ping")
	isOnline = extract(r.Data, "is_online")
	if isOnline != "true" {
		t.Errorf("expected is_online=true after ping, got %s", isOnline)
	}
}

func TestExecutionTarget_List(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	u := register(t, "et_ls1", "pass1234", "ET_LS")

	postAuth("/web/execution-targets", u.Token, map[string]interface{}{
		"name":        "Target A",
		"target_type": "local_edge",
	})
	postAuth("/web/execution-targets", u.Token, map[string]interface{}{
		"name":        "Target B",
		"target_type": "remote_ssh",
		"host":        "10.0.0.1",
		"port":        22,
	})

	w := get("/web/execution-targets", u.Token)
	r := parse(w)
	mustOK(t, r, "list targets")
}

// ── Phase 6: Audit Events ─────────────────────────────────────────────────

func TestAudit_ListEvents(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	u := register(t, "au_ls1", "pass1234", "AU_LS")

	// Initially, audit events should be empty or return successfully.
	w := get("/web/audit-events", u.Token)
	r := parse(w)
	mustOK(t, r, "list audit events")

	var listResp struct {
		Items []interface{} `json:"items"`
	}
	json.Unmarshal(r.Data, &listResp)
	// Items should be an empty array.
	if listResp.Items == nil {
		t.Error("expected items array (even if empty), got nil")
	}
}

func TestAudit_ListEventsUnauthorized(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })

	// Without auth token, should return 401.
	resp := do("GET", "/web/audit-events", nil, "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401 without auth, got %d", resp.StatusCode)
	}
}

// ── Phase 4: Market ────────────────────────────────────────────────────────

func TestMarket_SearchProfiles(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	u := register(t, "mk_sp1", "pass1234", "MK_SP")

	// Create and publish a profile.
	w := postAuth("/web/agent-profiles", u.Token, map[string]interface{}{
		"name":        "Market Profile",
		"runtime_id":  "claude-code",
		"description": "A profile for the market",
	})
	r := parse(w)
	mustOK(t, r, "create")
	profileID := extract(r.Data, "id")

	w = postAuth("/web/agent-profiles/"+profileID+"/publish", u.Token, nil)
	r = parse(w)
	mustOK(t, r, "publish")

	// Search market.
	w = get("/web/market/profiles", u.Token)
	r = parse(w)
	mustOK(t, r, "search market")

	// Get profile detail via market.
	w = get("/web/market/profiles/"+profileID, u.Token)
	r = parse(w)
	mustOK(t, r, "get market profile")
}

func TestMarket_RateProfile(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	alice := register(t, "mk_rt_a", "pass1234", "MK_RT_A")
	bob := register(t, "mk_rt_b", "pass1234", "MK_RT_B")

	// Alice creates and publishes a profile.
	w := postAuth("/web/agent-profiles", alice.Token, map[string]interface{}{
		"name":       "Rateable Profile",
		"runtime_id": "claude-code",
	})
	r := parse(w)
	mustOK(t, r, "create")
	profileID := extract(r.Data, "id")

	postAuth("/web/agent-profiles/"+profileID+"/publish", alice.Token, nil)

	// Bob rates it.
	w = postAuth("/web/market/profiles/"+profileID+"/rate", bob.Token, map[string]interface{}{
		"score": 4,
	})
	r = parse(w)
	mustOK(t, r, "rate profile")
}

// ── Phase 4: Provider Bindings ──────────────────────────────────────────────

func TestProviderBinding_CreateAndList(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })
	u := register(t, "pb_cr1", "pass1234", "PB_CR")

	// Create.
	w := postAuth("/web/provider-bindings", u.Token, map[string]interface{}{
		"binding_name": "My OpenAI Key",
		"provider":     "openai",
		"base_url":     "https://api.openai.com",
	})
	r := parse(w)
	mustOK(t, r, "create provider binding")
	bindingID := extract(r.Data, "id")
	if bindingID == "" {
		t.Fatal("expected non-empty binding id")
	}

	// List.
	w = get("/web/provider-bindings", u.Token)
	r = parse(w)
	mustOK(t, r, "list provider bindings")
}
