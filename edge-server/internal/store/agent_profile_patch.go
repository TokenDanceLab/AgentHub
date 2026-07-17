package store

import "fmt"

func applyAgentProfilePatch(profile AgentProfile, patch map[string]any) AgentProfile {
	if v, found := patch["name"]; found {
		if sv, valid := v.(string); valid {
			profile.Name = sv
		}
	}
	if v, found := patch["description"]; found {
		if sv, valid := v.(string); valid {
			profile.Description = sv
		}
	}
	if v, found := patch["adapterId"]; found {
		if sv, valid := v.(string); valid {
			profile.AdapterID = sv
		}
	}
	if v, found := patch["model"]; found {
		if sv, valid := v.(string); valid {
			profile.Model = sv
		}
	}
	if v, found := patch["provider"]; found {
		if sv, valid := v.(string); valid {
			profile.Provider = sv
		}
	}
	if v, found := patch["reasoningEffort"]; found {
		if sv, valid := v.(string); valid {
			profile.ReasoningEffort = sv
		}
	}
	if v, found := patch["thinkingMode"]; found {
		if sv, valid := v.(string); valid {
			profile.ThinkingMode = sv
		}
	}
	if v, found := patch["maxThinkingTokens"]; found {
		switch n := v.(type) {
		case float64:
			profile.MaxThinkingTokens = int(n)
		case int:
			profile.MaxThinkingTokens = n
		}
	}
	if v, found := patch["permissionMode"]; found {
		if sv, valid := v.(string); valid {
			profile.PermissionMode = sv
		}
	}
	if v, found := patch["systemPrompt"]; found {
		if sv, valid := v.(string); valid {
			profile.SystemPrompt = sv
		}
	}
	if v, found := patch["allowedTools"]; found {
		if arr, valid := v.([]any); valid {
			tools := make([]string, 0, len(arr))
			for _, item := range arr {
				if sv, ok := item.(string); ok {
					tools = append(tools, sv)
				}
			}
			profile.AllowedTools = tools
		}
	}
	if v, found := patch["mcpConfig"]; found {
		if sv, valid := v.(string); valid {
			profile.MCPConfig = sv
		}
	}
	if v, found := patch["skills"]; found {
		if arr, valid := v.([]any); valid {
			skills := make([]string, 0, len(arr))
			for _, item := range arr {
				if sv, ok := item.(string); ok {
					skills = append(skills, sv)
				}
			}
			profile.Skills = skills
		}
	}
	if v, found := patch["avatarRef"]; found {
		if sv, valid := v.(string); valid {
			profile.AvatarRef = sv
		}
	}
	return profile
}

func validateAgentProfileCreate(profile AgentProfile) error {
	if profile.ID == "" {
		return fmt.Errorf("agent profile id is required")
	}
	if profile.AdapterID == "" {
		return fmt.Errorf("agent profile adapterId is required")
	}
	return nil
}
