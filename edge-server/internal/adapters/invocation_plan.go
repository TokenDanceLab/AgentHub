package adapters

import (
	"path"
	"path/filepath"
	"strings"
)

// CLIInvocationPlan is a redacted, non-executing projection of an adapter
// request into the command shape ProcessExecutor would invoke.
type CLIInvocationPlan struct {
	AdapterID           string   `json:"adapterId"`
	CommandName         string   `json:"commandName"`
	ArgFlags            []string `json:"argFlags,omitempty"`
	ConfigKeys          []string `json:"configKeys,omitempty"`
	PositionalArgCount  int      `json:"positionalArgCount"`
	EnvNames            []string `json:"envNames,omitempty"`
	WorkDir             string   `json:"workDir,omitempty"`
	PromptRedacted      bool     `json:"promptRedacted"`
	Observed            bool     `json:"observed"`
	RealTested          bool     `json:"realTested"`
	RealTestedReason    string   `json:"realTestedReason"`
	ExecutionMode       string   `json:"executionMode"`
	NoSpendDefault      bool     `json:"noSpendDefault"`
	RedactionApplied    bool     `json:"redactionApplied"`
	ApprovalRequired    bool     `json:"approvalRequired"`
	ApprovalEvidenceRef string   `json:"approvalEvidenceRef,omitempty"`
}

// BuildCLIInvocationPlan calls the adapter's BuildCommand without starting the
// command and keeps only safe command-shape evidence. It never marks the plan
// observed or real-tested; those claims require a separate approved observation
// chain.
func BuildCLIInvocationPlan(adapter AgentAdapter, ctx RunProcessContext) CLIInvocationPlan {
	if adapter == nil {
		return CLIInvocationPlan{
			RealTestedReason: "no adapter",
			ExecutionMode:    "fixture",
			NoSpendDefault:   true,
			RedactionApplied: true,
			ApprovalRequired: true,
		}
	}
	cmdPath, args, env, workDir := adapter.BuildCommand(ctx)
	return BuildCLIInvocationPlanFromCommand(adapter, ctx, cmdPath, args, env, workDir)
}

// BuildCLIInvocationPlanFromCommand builds a redacted plan from command data
// already returned by BuildCommand.
func BuildCLIInvocationPlanFromCommand(adapter AgentAdapter, ctx RunProcessContext, cmdPath string, args []string, env []string, workDir string) CLIInvocationPlan {
	if adapter == nil {
		return CLIInvocationPlan{
			CommandName:      commandNameOnly(cmdPath),
			RealTestedReason: "no adapter",
			ExecutionMode:    "fixture",
			NoSpendDefault:   true,
			RedactionApplied: true,
			ApprovalRequired: true,
		}
	}
	flags, configKeys, positionalCount := summarizeCLIInvocationArgs(args)
	return CLIInvocationPlan{
		AdapterID:          adapter.Metadata().ID,
		CommandName:        commandNameOnly(cmdPath),
		ArgFlags:           flags,
		ConfigKeys:         configKeys,
		PositionalArgCount: positionalCount,
		EnvNames:           envNamesOnly(env),
		WorkDir:            invocationPathNameOnly(firstNonEmpty(workDir, ctx.WorkDir)),
		PromptRedacted:     strings.TrimSpace(ctx.Prompt) != "",
		Observed:           false,
		RealTested:         false,
		RealTestedReason:   "fixture plan only; no approved observed CLI chain",
		ExecutionMode:      "fixture",
		NoSpendDefault:     true,
		RedactionApplied:   true,
		ApprovalRequired:   true,
	}
}

func (p CLIInvocationPlan) Payload() map[string]any {
	payload := map[string]any{
		"adapterId":          p.AdapterID,
		"commandName":        p.CommandName,
		"positionalArgCount": p.PositionalArgCount,
		"promptRedacted":     p.PromptRedacted,
		"observed":           p.Observed,
		"realTested":         p.RealTested,
		"realTestedReason":   p.RealTestedReason,
		"executionMode":      p.ExecutionMode,
		"noSpendDefault":     p.NoSpendDefault,
		"redactionApplied":   p.RedactionApplied,
		"approvalRequired":   p.ApprovalRequired,
	}
	if len(p.ArgFlags) > 0 {
		payload["argFlags"] = append([]string(nil), p.ArgFlags...)
	}
	if len(p.ConfigKeys) > 0 {
		payload["configKeys"] = append([]string(nil), p.ConfigKeys...)
	}
	if len(p.EnvNames) > 0 {
		payload["envNames"] = append([]string(nil), p.EnvNames...)
	}
	if p.WorkDir != "" {
		payload["workDir"] = p.WorkDir
	}
	if p.ApprovalEvidenceRef != "" {
		payload["approvalEvidenceRef"] = p.ApprovalEvidenceRef
	}
	return payload
}

func summarizeCLIInvocationArgs(args []string) ([]string, []string, int) {
	var flags []string
	var configKeys []string
	positionalCount := 0
	afterSeparator := false
	for i := 0; i < len(args); i++ {
		arg := strings.TrimSpace(args[i])
		if arg == "" {
			continue
		}
		if arg == "--" {
			afterSeparator = true
			continue
		}
		if !afterSeparator && strings.HasPrefix(arg, "-") {
			flagName, _, _ := strings.Cut(arg, "=")
			flags = appendUniqueString(flags, flagName)
			if (arg == "-c" || arg == "--config") && i+1 < len(args) {
				if key, _, ok := strings.Cut(args[i+1], "="); ok && strings.TrimSpace(key) != "" {
					configKeys = appendUniqueString(configKeys, strings.TrimSpace(key))
				}
			}
			continue
		}
		positionalCount++
	}
	return flags, configKeys, positionalCount
}

func envNamesOnly(env []string) []string {
	names := make([]string, 0, len(env))
	for _, kv := range env {
		name, _, _ := strings.Cut(kv, "=")
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		names = appendUniqueString(names, name)
	}
	return names
}

func commandNameOnly(value string) string {
	cleaned := strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if cleaned == "" {
		return ""
	}
	return path.Base(cleaned)
}

func invocationPathNameOnly(value string) string {
	cleaned := strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if cleaned == "" {
		return ""
	}
	cleaned = path.Clean(cleaned)
	if cleaned == "." {
		return ""
	}
	if path.IsAbs(cleaned) || filepath.IsAbs(value) || strings.Contains(cleaned, ":/") || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return path.Base(cleaned)
	}
	return strings.TrimPrefix(cleaned, "./")
}

func appendUniqueString(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}
