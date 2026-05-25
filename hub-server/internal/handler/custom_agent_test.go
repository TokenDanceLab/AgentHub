package handler_test

import (
	"context"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/agenthub/hub-server/internal/handler"
	"github.com/agenthub/hub-server/internal/model"
)

type mockCustomAgentService struct {
	createCalled bool
	updateCalled bool
}

func (m *mockCustomAgentService) CreateCustomAgent(ctx context.Context, ownerID, name, avatarURL, agentType, systemPrompt, capabilityTags, toolWhitelist, modelParams string) (*model.CustomAgent, error) {
	m.createCalled = true
	return &model.CustomAgent{ID: "agent-1", OwnerUserID: ownerID, Name: name, AgentType: agentType, SystemPrompt: systemPrompt}, nil
}

func (m *mockCustomAgentService) ListCustomAgents(ctx context.Context, ownerID string) ([]model.CustomAgent, error) {
	return nil, nil
}

func (m *mockCustomAgentService) UpdateCustomAgent(ctx context.Context, ownerID string, ca *model.CustomAgent) error {
	m.updateCalled = true
	return nil
}

func (m *mockCustomAgentService) DeleteCustomAgent(ctx context.Context, ownerID, id string) error {
	return nil
}

func TestCustomAgentHandler_CreateRejectsInvalidJSONBShapeBeforeService(t *testing.T) {
	svc := &mockCustomAgentService{}
	h := handler.NewCustomAgentHandler(svc)

	c, w := newGinCtx("POST", "/web/custom-agents", map[string]string{
		"name":            "Reviewer",
		"agent_type":      "codex",
		"system_prompt":   "review code",
		"capability_tags": `{"code":true}`,
	}, "user_id", "user-1")
	h.Create(c)

	if w.Code != 400 {
		t.Fatalf("Create status = %d, want 400; body=%s", w.Code, w.Body.String())
	}
	if svc.createCalled {
		t.Fatal("CreateCustomAgent was called for invalid JSONB shape")
	}
	if !strings.Contains(w.Body.String(), "capability_tags must be a JSON array") {
		t.Fatalf("response body = %q, want capability_tags shape error", w.Body.String())
	}
}

func TestCustomAgentHandler_UpdateRejectsInvalidJSONBShapeBeforeService(t *testing.T) {
	svc := &mockCustomAgentService{}
	h := handler.NewCustomAgentHandler(svc)

	c, w := newGinCtx("PUT", "/web/custom-agents/agent-1", map[string]string{
		"name":          "Reviewer",
		"agent_type":    "codex",
		"system_prompt": "review code",
		"model_params":  `[]`,
	}, "user_id", "user-1")
	c.Params = gin.Params{{Key: "id", Value: "agent-1"}}
	h.Update(c)

	if w.Code != 400 {
		t.Fatalf("Update status = %d, want 400; body=%s", w.Code, w.Body.String())
	}
	if svc.updateCalled {
		t.Fatal("UpdateCustomAgent was called for invalid JSONB shape")
	}
	if !strings.Contains(w.Body.String(), "model_params must be a JSON object") {
		t.Fatalf("response body = %q, want model_params shape error", w.Body.String())
	}
}
