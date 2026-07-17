package dispatch

import (
	"encoding/json"
	"net"
	"net/url"
	"strings"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

// IsLoopback reports whether rawURL has a loopback hostname.
// Uses url.Parse + net.ParseIP for accurate loopback detection — simple
// substring matching (e.g. strings.Contains) is vulnerable to bypass via
// domains like localhost.evil.com.
func IsLoopback(rawURL string) bool {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return false
	}
	host := u.Hostname()
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// NormalizeRuntimeAgentType maps free-form agent type labels onto the runtime
// keys DispatchService uses for edge payloads (claude-code / opencode / codex).
func NormalizeRuntimeAgentType(agentType string) string {
	key := strings.TrimSpace(strings.ToLower(agentType))
	if key == "" {
		return ""
	}
	if key == "claude" || strings.Contains(key, "claude-code") || strings.Contains(key, "claude") {
		return "claude-code"
	}
	if strings.Contains(key, "opencode") {
		return "opencode"
	}
	if strings.Contains(key, "codex") || strings.Contains(key, "gpt") {
		return "codex"
	}
	return key
}

// SelectAgentInstance picks a session agent by optional instance ID, runtime
// type, and/or custom agent ID. When no target is requested, returns the first
// agent. Returns errcode.AgentNotFound when the list is empty or no match.
func SelectAgentInstance(agents []model.AgentInstance, targetAgentInstanceID, targetAgentType, targetCustomAgentID string) (*model.AgentInstance, error) {
	targetAgentInstanceID = strings.TrimSpace(targetAgentInstanceID)
	targetAgentType = NormalizeRuntimeAgentType(targetAgentType)
	targetCustomAgentID = strings.TrimSpace(targetCustomAgentID)
	targetRequested := targetAgentInstanceID != "" || targetAgentType != "" || targetCustomAgentID != ""

	if len(agents) == 0 {
		return nil, errcode.AgentNotFound
	}
	if !targetRequested {
		return &agents[0], nil
	}

	for i := range agents {
		agent := &agents[i]
		if targetAgentInstanceID != "" && agent.ID != targetAgentInstanceID {
			continue
		}
		if targetAgentType != "" && NormalizeRuntimeAgentType(agent.AgentType) != targetAgentType {
			continue
		}
		if targetCustomAgentID != "" && (agent.CustomAgentID == nil || *agent.CustomAgentID != targetCustomAgentID) {
			continue
		}
		return agent, nil
	}
	return nil, errcode.AgentNotFound
}

// MergeModelParams shallow-merges two JSON object strings. Override keys win.
// Invalid or non-object JSON falls back to override (or base when override empty).
func MergeModelParams(base, override string) string {
	base = strings.TrimSpace(base)
	override = strings.TrimSpace(override)
	if base == "" {
		return override
	}
	if override == "" {
		return base
	}

	var merged map[string]any
	if err := json.Unmarshal([]byte(base), &merged); err != nil || merged == nil {
		return override
	}
	var incoming map[string]any
	if err := json.Unmarshal([]byte(override), &incoming); err != nil || incoming == nil {
		return override
	}
	for key, value := range incoming {
		merged[key] = value
	}
	data, err := json.Marshal(merged)
	if err != nil {
		return override
	}
	return string(data)
}

// PromptFromMessage extracts the dispatch prompt from a trigger message.
// Text/code/diff content prefers the JSON "text" field; otherwise returns raw content.
func PromptFromMessage(msg *model.Message) string {
	if msg == nil {
		return ""
	}
	switch msg.ContentType {
	case model.ContentTypeText, model.ContentTypeCode, model.ContentTypeDiff:
		var payload struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal([]byte(msg.Content), &payload); err == nil && strings.TrimSpace(payload.Text) != "" {
			return payload.Text
		}
	}
	return msg.Content
}

// ExtractMessageText extracts the human-readable text from a message's JSON content
// for thread-history / pinned context projection.
func ExtractMessageText(msg *model.Message) string {
	if msg == nil {
		return ""
	}
	switch msg.ContentType {
	case model.ContentTypeText, model.ContentTypeCode, model.ContentTypeDiff:
		var payload struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal([]byte(msg.Content), &payload); err == nil && payload.Text != "" {
			return payload.Text
		}
	}
	// For non-text messages or unparseable content, just return raw content.
	return msg.Content
}

// MapSenderType maps Hub sender types to standard roles (user/assistant/system).
func MapSenderType(t string) string {
	switch t {
	case model.SenderTypeAgent:
		return "assistant"
	case model.SenderTypeUser:
		return "user"
	default:
		return t
	}
}
