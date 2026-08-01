package store

import "fmt"

func applyAgentProfilePatch(profile AgentProfile, patch map[string]any) AgentProfile {
	applyStringPatch(&profile.Name, patch, "name")
	applyStringPatch(&profile.Description, patch, "description")
	applyStringPatch(&profile.AdapterID, patch, "adapterId")
	applyStringPatch(&profile.Model, patch, "model")
	applyStringPatch(&profile.Provider, patch, "provider")
	applyStringPatch(&profile.ReasoningEffort, patch, "reasoningEffort")
	applyStringPatch(&profile.ThinkingMode, patch, "thinkingMode")
	applyIntPatch(&profile.MaxThinkingTokens, patch, "maxThinkingTokens")
	applyStringPatch(&profile.PermissionMode, patch, "permissionMode")
	applyStringPatch(&profile.SystemPrompt, patch, "systemPrompt")
	applyStringListPatch(&profile.AllowedTools, patch, "allowedTools")
	applyStringPatch(&profile.MCPConfig, patch, "mcpConfig")
	applyStringListPatch(&profile.Skills, patch, "skills")
	applyStringPatch(&profile.AvatarRef, patch, "avatarRef")
	return profile
}

// applyStringPatch writes a string-typed patch field when present and valid.
func applyStringPatch(dst *string, patch map[string]any, key string) {
	v, found := patch[key]
	if !found {
		return
	}
	if sv, valid := v.(string); valid {
		*dst = sv
	}
}

// applyIntPatch writes an int-typed patch field, accepting float64 (JSON numbers)
// or int as the source value.
func applyIntPatch(dst *int, patch map[string]any, key string) {
	v, found := patch[key]
	if !found {
		return
	}
	switch n := v.(type) {
	case float64:
		*dst = int(n)
	case int:
		*dst = n
	}
}

// applyStringListPatch writes a []string patch field, keeping only string items.
func applyStringListPatch(dst *[]string, patch map[string]any, key string) {
	v, found := patch[key]
	if !found {
		return
	}
	arr, valid := v.([]any)
	if !valid {
		return
	}
	items := make([]string, 0, len(arr))
	for _, item := range arr {
		if sv, ok := item.(string); ok {
			items = append(items, sv)
		}
	}
	*dst = items
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
