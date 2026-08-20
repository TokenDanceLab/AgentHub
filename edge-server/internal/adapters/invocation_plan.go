package adapters

import (
	"path"
	"path/filepath"
	"strings"
)

// CLIInvocationPlan is a redacted, non-executing projection of an adapter
// request into the command shape ProcessExecutor would invoke.
type CLIInvocationPlan struct {
	AdapterID               string   `json:"adapterId"`
	CommandName             string   `json:"commandName"`
	ArgFlags                []string `json:"argFlags,omitempty"`
	ConfigKeys              []string `json:"configKeys,omitempty"`
	PositionalArgCount      int      `json:"positionalArgCount"`
	EnvNames                []string `json:"envNames,omitempty"`
	WorkDir                 string   `json:"workDir,omitempty"`
	PromptRedacted          bool     `json:"promptRedacted"`
	Observed                bool     `json:"observed"`
	RealTested              bool     `json:"realTested"`
	RealTestedReason        string   `json:"realTestedReason"`
	MockAdapterUsed         bool     `json:"mockAdapterUsed"`
	RealCliTested           bool     `json:"realCliTested"`
	RealCliTestedReason     string   `json:"realCliTestedReason"`
	RealModelTested         bool     `json:"realModelTested"`
	RealModelTestedReason   string   `json:"realModelTestedReason"`
	TokenDanceIDLogin       bool     `json:"tokenDanceIdLogin"`
	TokenDanceIDLoginReason string   `json:"tokenDanceIdLoginReason"`
	ExecutionMode           string   `json:"executionMode"`
	NoSpendDefault          bool     `json:"noSpendDefault"`
	RedactionApplied        bool     `json:"redactionApplied"`
	ApprovalRequired        bool     `json:"approvalRequired"`
	ApprovalEvidenceRef     string   `json:"approvalEvidenceRef,omitempty"`
}

// BuildCLIInvocationPlan calls the adapter's BuildCommand without starting the
// command and keeps only safe command-shape evidence. It never marks the plan
// observed or real-tested; those claims require a separate approved observation
// chain.
func BuildCLIInvocationPlan(adapter AgentAdapter, ctx RunProcessContext) CLIInvocationPlan {
	if adapter == nil {
		return CLIInvocationPlan{
			RealTestedReason:        "no adapter",
			ExecutionMode:           "fixture",
			NoSpendDefault:          true,
			RedactionApplied:        true,
			ApprovalRequired:        true,
			RealCliTestedReason:     "no adapter",
			RealModelTestedReason:   "no adapter",
			TokenDanceIDLoginReason: "no TokenDanceID login attempted by invocation planning",
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
			CommandName:             CommandNameOnly(cmdPath),
			RealTestedReason:        "no adapter",
			ExecutionMode:           "fixture",
			NoSpendDefault:          true,
			RedactionApplied:        true,
			ApprovalRequired:        true,
			RealCliTestedReason:     "no adapter",
			RealModelTestedReason:   "no adapter",
			TokenDanceIDLoginReason: "no TokenDanceID login attempted by invocation planning",
		}
	}
	flags, configKeys, positionalCount := summarizeCLIInvocationArgs(args)
	// firstNonEmpty 随 sdk_fixture_mapper 家族迁入 adapters/sdk（#1760
	// mapper 增量）；此处仅剩单个调用点，行为等价地内联（取首个非空白值）。
	projectedWorkDir := workDir
	if strings.TrimSpace(projectedWorkDir) == "" {
		projectedWorkDir = ctx.WorkDir
	}
	return CLIInvocationPlan{
		AdapterID:               adapter.Metadata().ID,
		CommandName:             CommandNameOnly(cmdPath),
		ArgFlags:                flags,
		ConfigKeys:              configKeys,
		PositionalArgCount:      positionalCount,
		EnvNames:                EnvNamesOnly(env),
		WorkDir:                 InvocationPathNameOnly(projectedWorkDir),
		PromptRedacted:          strings.TrimSpace(ctx.Prompt) != "",
		Observed:                false,
		RealTested:              false,
		RealTestedReason:        "fixture plan only; no approved observed CLI chain",
		MockAdapterUsed:         false,
		RealCliTested:           false,
		RealCliTestedReason:     "fixture plan only; no approved observed CLI chain",
		RealModelTested:         false,
		RealModelTestedReason:   "fixture/no-spend plan only; no model call observed",
		TokenDanceIDLogin:       false,
		TokenDanceIDLoginReason: "TokenDanceID login is outside Edge CLI invocation planning",
		ExecutionMode:           "fixture",
		NoSpendDefault:          true,
		RedactionApplied:        true,
		ApprovalRequired:        true,
	}
}

func (p CLIInvocationPlan) Payload() map[string]any {
	payload := map[string]any{
		"adapterId":               p.AdapterID,
		"commandName":             p.CommandName,
		"positionalArgCount":      p.PositionalArgCount,
		"promptRedacted":          p.PromptRedacted,
		"observed":                p.Observed,
		"realTested":              p.RealTested,
		"realTestedReason":        p.RealTestedReason,
		"mockAdapterUsed":         p.MockAdapterUsed,
		"realCliTested":           p.RealCliTested,
		"realCliTestedReason":     p.RealCliTestedReason,
		"realModelTested":         p.RealModelTested,
		"realModelTestedReason":   p.RealModelTestedReason,
		"tokenDanceIdLogin":       p.TokenDanceIDLogin,
		"tokenDanceIdLoginReason": p.TokenDanceIDLoginReason,
		"executionMode":           p.ExecutionMode,
		"noSpendDefault":          p.NoSpendDefault,
		"redactionApplied":        p.RedactionApplied,
		"approvalRequired":        p.ApprovalRequired,
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

// EnvNamesOnly extracts the variable names from "KEY=VALUE" entries, deduped
// and order-preserved. Exported so the sdk subpackage can reuse the SSOT
// path-name/plan helpers from the root package (#1760 mapper 增量).
func EnvNamesOnly(env []string) []string {
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

// CommandNameOnly returns the basename of a command path (backslashes
// normalized). Exported for the sdk subpackage (#1760 mapper 增量).
func CommandNameOnly(value string) string {
	cleaned := strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if cleaned == "" {
		return ""
	}
	return path.Base(cleaned)
}

// InvocationPathNameOnly reduces a workspace path to its basename when
// absolute, otherwise strips "./" prefixes (plan redaction). Exported for
// the sdk subpackage (#1760 mapper 增量).
func InvocationPathNameOnly(value string) string {
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
