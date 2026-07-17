package lifecycle

import (
	"path/filepath"
	"strings"
)

type processArgLogSummary struct {
	ArgFlags               []string
	ConfigKeys             []string
	PositionalArgCount     int
	UnknownFlagCount       int
	RedactedConfigKeyCount int
}

func summarizeProcessArgsForLog(args []string) processArgLogSummary {
	var summary processArgLogSummary
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "" {
			continue
		}
		if arg == "--" {
			summary.PositionalArgCount += len(args) - i - 1
			break
		}
		if !strings.HasPrefix(arg, "-") || arg == "-" {
			summary.PositionalArgCount++
			continue
		}

		flag, value, hasInlineValue := strings.Cut(arg, "=")
		if !isSafeProcessArgFlag(flag) {
			summary.UnknownFlagCount++
			continue
		}
		summary.ArgFlags = appendUniqueString(summary.ArgFlags, flag)
		if flag == "-c" {
			if hasInlineValue {
				summary.ConfigKeys, summary.RedactedConfigKeyCount = appendConfigKeyName(summary.ConfigKeys, summary.RedactedConfigKeyCount, value)
			} else if i+1 < len(args) {
				summary.ConfigKeys, summary.RedactedConfigKeyCount = appendConfigKeyName(summary.ConfigKeys, summary.RedactedConfigKeyCount, args[i+1])
				i++
			}
			continue
		}
		if shouldConsumeNextProcessArgValue(flag, args, i) {
			i++
		}
	}
	return summary
}

func appendConfigKeyName(configKeys []string, redactedCount int, value string) ([]string, int) {
	key, _, _ := strings.Cut(value, "=")
	if key == "" || key == value || !isSafeProcessConfigKey(key) {
		return configKeys, redactedCount + 1
	}
	return appendUniqueString(configKeys, key), redactedCount
}

func processCommandNameForLog(cmdPath string) string {
	name := filepath.Base(cmdPath)
	if name == "." || name == string(filepath.Separator) {
		return ""
	}
	return name
}

func isSafeProcessArgFlag(flag string) bool {
	switch flag {
	case "-c",
		"-i",
		"-m",
		"-p",
		"-test.run",
		"--add-dir",
		"--agent",
		"--agents",
		"--allowedTools",
		"--append-system-prompt",
		"--cd",
		"--command",
		"--continue",
		"--dangerously-skip-permissions",
		"--dir",
		"--effort",
		"--ephemeral",
		"--fast",
		"--file",
		"--fork",
		"--fork-session",
		"--format",
		"--image",
		"--include-partial-messages",
		"--json",
		"--json-schema",
		"--max-budget-usd",
		"--max-turns",
		"--mcp-config",
		"--model",
		"--output-format",
		"--permission-mode",
		"--resume",
		"--sandbox",
		"--session",
		"--session-id",
		"--skip-git-repo-check",
		"--system-prompt",
		"--thinking",
		"--title",
		"--variant",
		"--verbose":
		return true
	default:
		return false
	}
}

func isSafeProcessConfigKey(key string) bool {
	for i, r := range key {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
			if i == 0 {
				return false
			}
		case r == '_' || r == '-' || r == '.':
			if i == 0 {
				return false
			}
		default:
			return false
		}
	}
	return key != ""
}

func processArgFlagTakesValue(flag string) bool {
	switch flag {
	case "-p",
		"-m",
		"-i",
		"--add-dir",
		"--agent",
		"--agents",
		"--allowedTools",
		"--append-system-prompt",
		"--cd",
		"--command",
		"--dir",
		"--effort",
		"--file",
		"--format",
		"--image",
		"--json-schema",
		"--max-budget-usd",
		"--mcp-config",
		"--model",
		"--output-format",
		"--permission-mode",
		"--resume",
		"--sandbox",
		"--session",
		"--session-id",
		"--thinking",
		"--system-prompt",
		"--title",
		"--variant":
		return true
	default:
		return false
	}
}

func shouldConsumeNextProcessArgValue(flag string, args []string, index int) bool {
	if !processArgFlagTakesValue(flag) || index+1 >= len(args) {
		return false
	}
	next := args[index+1]
	if next == "" || next == "--" || !strings.HasPrefix(next, "-") || next == "-" {
		return true
	}
	nextFlag, _, _ := strings.Cut(next, "=")
	return !isSafeProcessArgFlag(nextFlag)
}

func appendUniqueString(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}
