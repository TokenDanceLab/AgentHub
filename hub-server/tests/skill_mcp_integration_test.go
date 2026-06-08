package tests

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestSkillAndMCPIntegrationReadthrough(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })

	owner := register(t, "tsm01", "pass1234", "SkillMCPOwner")
	stranger := register(t, "tsm02", "pass1234", "SkillMCPStranger")

	t.Run("SkillCRUDAndOwnerBoundary", func(t *testing.T) {
		resp := postAuth("/web/skills", owner.Token, map[string]interface{}{
			"name":          "Skill Alpha",
			"description":   "test skill",
			"skill_type":    "agent_skill",
			"runtime_ids":   `["codex"]`,
			"entry_point":   "skills/alpha",
			"config_schema": `{"enabled":{"type":"boolean"}}`,
		})
		r := parse(resp)
		mustOK(t, r, "create skill")
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("create skill: expected HTTP 200 got %d", resp.StatusCode)
		}
		skillID := extract(r.Data, "id")
		if skillID == "" {
			t.Fatal("create skill: expected non-empty id")
		}

		resp = get("/web/skills/"+skillID, owner.Token)
		r = parse(resp)
		mustOK(t, r, "get skill")
		if extract(r.Data, "name") != "Skill Alpha" {
			t.Fatalf("get skill: expected Skill Alpha got %q", extract(r.Data, "name"))
		}
		if extract(r.Data, "runtime_ids") != `["codex"]` {
			t.Fatalf("get skill: expected runtime_ids JSON string, got %q", extract(r.Data, "runtime_ids"))
		}

		resp = get("/web/skills?pageSize=10", owner.Token)
		r = parse(resp)
		mustOK(t, r, "list skills")
		var listResp struct {
			Items []map[string]interface{} `json:"items"`
			Page  map[string]interface{}   `json:"page"`
		}
		if err := json.Unmarshal(r.Data, &listResp); err != nil {
			t.Fatalf("list skills: decode response: %v", err)
		}
		if len(listResp.Items) == 0 || listResp.Page == nil {
			t.Fatalf("list skills: expected items and page metadata, got %#v", listResp)
		}

		resp = put("/web/skills/"+skillID, owner.Token, map[string]interface{}{
			"name":          "Skill Alpha Updated",
			"skill_type":    "tool",
			"config_schema": `{"mode":{"type":"string"}}`,
		})
		r = parse(resp)
		mustOK(t, r, "update skill")
		if extract(r.Data, "name") != "Skill Alpha Updated" {
			t.Fatalf("update skill: expected updated name got %q", extract(r.Data, "name"))
		}

		resp = put("/web/skills/"+skillID, stranger.Token, map[string]interface{}{
			"name": "Hijacked Skill",
		})
		r = parse(resp)
		mustCode(t, r, "AUTH_DEVICE_MISMATCH", "stranger update skill")

		resp = del("/web/skills/"+skillID, owner.Token)
		mustOK(t, parse(resp), "delete skill")
		resp = get("/web/skills/"+skillID, owner.Token)
		mustCode(t, parse(resp), "USER_NOT_FOUND", "get deleted skill")
	})

	t.Run("MCPCRUDSecretGuardAndOwnerBoundary", func(t *testing.T) {
		resp := postAuth("/web/mcp-servers", owner.Token, map[string]interface{}{
			"name":        "MCP Alpha",
			"transport":   "stdio",
			"command":     "node",
			"args":        `["server.js"]`,
			"env_vars":    `{"NODE_ENV":"test"}`,
			"auth_config": `{"api_key":"***"}`,
			"tool_schema": `{"tools":[]}`,
		})
		r := parse(resp)
		mustOK(t, r, "create mcp server")
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("create mcp server: expected HTTP 200 got %d", resp.StatusCode)
		}
		mcpID := extract(r.Data, "id")
		if mcpID == "" {
			t.Fatal("create mcp server: expected non-empty id")
		}

		resp = get("/web/mcp-servers/"+mcpID, owner.Token)
		r = parse(resp)
		mustOK(t, r, "get mcp server")
		if extract(r.Data, "name") != "MCP Alpha" {
			t.Fatalf("get mcp server: expected MCP Alpha got %q", extract(r.Data, "name"))
		}
		if extract(r.Data, "args") != `["server.js"]` {
			t.Fatalf("get mcp server: expected args JSON string, got %q", extract(r.Data, "args"))
		}

		resp = get("/web/mcp-servers?transport=stdio&pageSize=10", owner.Token)
		r = parse(resp)
		mustOK(t, r, "list mcp servers")
		var listResp struct {
			Items []map[string]interface{} `json:"items"`
			Page  map[string]interface{}   `json:"page"`
		}
		if err := json.Unmarshal(r.Data, &listResp); err != nil {
			t.Fatalf("list mcp servers: decode response: %v", err)
		}
		if len(listResp.Items) == 0 || listResp.Page == nil {
			t.Fatalf("list mcp servers: expected items and page metadata, got %#v", listResp)
		}

		resp = put("/web/mcp-servers/"+mcpID, owner.Token, map[string]interface{}{
			"name":        "MCP Alpha Updated",
			"transport":   "stdio",
			"command":     "node",
			"args":        `["updated.js"]`,
			"env_vars":    `{}`,
			"auth_config": `{}`,
			"tool_schema": `{"tools":["list"]}`,
		})
		r = parse(resp)
		mustOK(t, r, "update mcp server")
		if extract(r.Data, "args") != `["updated.js"]` {
			t.Fatalf("update mcp server: expected updated args got %q", extract(r.Data, "args"))
		}

		resp = put("/web/mcp-servers/"+mcpID, stranger.Token, map[string]interface{}{
			"name": "Hijacked MCP",
		})
		r = parse(resp)
		mustCode(t, r, "AUTH_DEVICE_MISMATCH", "stranger update mcp server")

		resp = postAuth("/web/mcp-servers", owner.Token, map[string]interface{}{
			"name":        "MCP With Plain Secret",
			"transport":   "stdio",
			"command":     "node",
			"auth_config": `{"api_key":"sk-test-secret"}`,
		})
		r = parse(resp)
		mustCode(t, r, "BAD_REQUEST", "reject plaintext mcp auth_config")
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("reject plaintext mcp auth_config: expected HTTP 400 got %d", resp.StatusCode)
		}

		resp = del("/web/mcp-servers/"+mcpID, owner.Token)
		mustOK(t, parse(resp), "delete mcp server")
		resp = get("/web/mcp-servers/"+mcpID, owner.Token)
		mustCode(t, parse(resp), "USER_NOT_FOUND", "get deleted mcp server")
	})
}
