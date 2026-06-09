package tests

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/agenthub/hub-server/internal/model"
)

func TestSkillAndMCPIntegrationReadthrough(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })

	owner := register(t, "tsm01", "pass1234", "SkillMCPOwner")
	stranger := register(t, "tsm02", "pass1234", "SkillMCPStranger")

	skill := &model.Skill{
		OwnerID:      owner.ID,
		Name:         "Fixture Skill Alpha",
		Description:  "readthrough fixture",
		SkillType:    "fixture_skill",
		RuntimeIDs:   `["fixture-runtime"]`,
		EntryPoint:   "fixtures/skill-alpha",
		ConfigSchema: `{"enabled":{"type":"boolean"}}`,
	}
	if err := db.Create(skill).Error; err != nil {
		t.Fatalf("seed skill fixture: %v", err)
	}

	mcp := &model.MCPServer{
		OwnerID:    owner.ID,
		Name:       "Fixture MCP Alpha",
		Transport:  "stdio",
		Command:    "fixture-command",
		Args:       `["fixture-server.js"]`,
		EnvVars:    `{"FIXTURE_MODE":"true"}`,
		AuthConfig: `{"api_key":"***"}`,
		ToolSchema: `{"tools":[]}`,
	}
	if err := db.Create(mcp).Error; err != nil {
		t.Fatalf("seed mcp fixture: %v", err)
	}

	t.Run("SkillGetListAndOwnerScope", func(t *testing.T) {
		resp := get("/web/skills/"+skill.ID, owner.Token)
		r := parse(resp)
		mustOK(t, r, "get skill fixture")
		if extract(r.Data, "name") != skill.Name {
			t.Fatalf("get skill fixture: expected %q got %q", skill.Name, extract(r.Data, "name"))
		}
		if extract(r.Data, "runtime_ids") != skill.RuntimeIDs {
			t.Fatalf("get skill fixture: expected runtime_ids %q got %q", skill.RuntimeIDs, extract(r.Data, "runtime_ids"))
		}
		requireJSONEquivalent(t, "get skill fixture config_schema", skill.ConfigSchema, extract(r.Data, "config_schema"))

		resp = get("/web/skills?pageSize=10", owner.Token)
		r = parse(resp)
		mustOK(t, r, "list skill fixtures")
		var listResp struct {
			Items []map[string]interface{} `json:"items"`
			Page  map[string]interface{}   `json:"page"`
		}
		if err := json.Unmarshal(r.Data, &listResp); err != nil {
			t.Fatalf("list skill fixtures: decode response: %v", err)
		}
		if listResp.Page == nil {
			t.Fatal("list skill fixtures: expected page metadata")
		}
		if !containsID(listResp.Items, skill.ID) {
			t.Fatalf("list skill fixtures: expected seeded skill %s in owner list", skill.ID)
		}

		resp = get("/web/skills/"+skill.ID, stranger.Token)
		mustCode(t, parse(resp), "AUTH_DEVICE_MISMATCH", "stranger get skill fixture")

		resp = get("/web/skills?pageSize=10", stranger.Token)
		r = parse(resp)
		mustOK(t, r, "stranger list skill fixtures")
		listResp = struct {
			Items []map[string]interface{} `json:"items"`
			Page  map[string]interface{}   `json:"page"`
		}{}
		if err := json.Unmarshal(r.Data, &listResp); err != nil {
			t.Fatalf("stranger list skill fixtures: decode response: %v", err)
		}
		if containsID(listResp.Items, skill.ID) {
			t.Fatalf("stranger list skill fixtures: leaked owner skill %s", skill.ID)
		}
	})

	t.Run("MCPGetListAndOwnerScope", func(t *testing.T) {
		resp := get("/web/mcp-servers/"+mcp.ID, owner.Token)
		r := parse(resp)
		mustOK(t, r, "get mcp fixture")
		if extract(r.Data, "name") != mcp.Name {
			t.Fatalf("get mcp fixture: expected %q got %q", mcp.Name, extract(r.Data, "name"))
		}
		if extract(r.Data, "args") != mcp.Args {
			t.Fatalf("get mcp fixture: expected args %q got %q", mcp.Args, extract(r.Data, "args"))
		}
		requireJSONEquivalent(t, "get mcp fixture tool_schema", mcp.ToolSchema, extract(r.Data, "tool_schema"))

		resp = get("/web/mcp-servers?transport=stdio&pageSize=10", owner.Token)
		r = parse(resp)
		mustOK(t, r, "list mcp fixtures")
		var listResp struct {
			Items []map[string]interface{} `json:"items"`
			Page  map[string]interface{}   `json:"page"`
		}
		if err := json.Unmarshal(r.Data, &listResp); err != nil {
			t.Fatalf("list mcp fixtures: decode response: %v", err)
		}
		if listResp.Page == nil {
			t.Fatal("list mcp fixtures: expected page metadata")
		}
		if !containsID(listResp.Items, mcp.ID) {
			t.Fatalf("list mcp fixtures: expected seeded mcp %s in owner list", mcp.ID)
		}

		resp = get("/web/mcp-servers/"+mcp.ID, stranger.Token)
		mustCode(t, parse(resp), "AUTH_DEVICE_MISMATCH", "stranger get mcp fixture")

		resp = get("/web/mcp-servers?transport=stdio&pageSize=10", stranger.Token)
		r = parse(resp)
		mustOK(t, r, "stranger list mcp fixtures")
		listResp = struct {
			Items []map[string]interface{} `json:"items"`
			Page  map[string]interface{}   `json:"page"`
		}{}
		if err := json.Unmarshal(r.Data, &listResp); err != nil {
			t.Fatalf("stranger list mcp fixtures: decode response: %v", err)
		}
		if containsID(listResp.Items, mcp.ID) {
			t.Fatalf("stranger list mcp fixtures: leaked owner mcp %s", mcp.ID)
		}
	})
}

func containsID(items []map[string]interface{}, id string) bool {
	for _, item := range items {
		if item["id"] == id {
			return true
		}
	}
	return false
}

func requireJSONEquivalent(t *testing.T, label, expected, actual string) {
	t.Helper()
	var expectedValue interface{}
	var actualValue interface{}
	if err := json.Unmarshal([]byte(expected), &expectedValue); err != nil {
		t.Fatalf("%s: decode expected JSON: %v", label, err)
	}
	if err := json.Unmarshal([]byte(actual), &actualValue); err != nil {
		t.Fatalf("%s: decode actual JSON: %v", label, err)
	}
	if !reflect.DeepEqual(expectedValue, actualValue) {
		t.Fatalf("%s: expected JSON %s got %s", label, expected, actual)
	}
}
