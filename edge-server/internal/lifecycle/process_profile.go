package lifecycle

import (
	"fmt"
	"strings"

	"github.com/agenthub/edge-server/internal/store"
)

type RunnerProfile struct {
	Command          string
	Template         CommandTemplate
	ExtraEnvTemplate CommandTemplate
	WorkDir          string
}

type CommandTemplate struct {
	Args []string
	Env  []string
}

type RunProcessContext struct {
	Run     store.Run
	Prompt  string // User message content ({{run.prompt}})
	AgentID string // Agent adapter ID ({{agent.id}})
	Model   string // Model override ({{agent.model}})
	WorkDir string // Working directory ({{run.workdir}})
}

func NewGenericRunnerProfile(command string, args, env, extraEnv []string, workDir string) (RunnerProfile, error) {
	command = strings.TrimSpace(command)
	if command == "" {
		return RunnerProfile{}, ErrProcessCommandRequired
	}
	template, err := NewCommandTemplate(args, env)
	if err != nil {
		return RunnerProfile{}, err
	}
	extraEnvTemplate, err := NewCommandTemplate(nil, extraEnv)
	if err != nil {
		return RunnerProfile{}, err
	}
	return RunnerProfile{
		Command:          command,
		Template:         template,
		ExtraEnvTemplate: extraEnvTemplate,
		WorkDir:          workDir,
	}, nil
}

func NewCommandTemplate(args, env []string) (CommandTemplate, error) {
	template := CommandTemplate{
		Args: append([]string(nil), args...),
		Env:  append([]string(nil), env...),
	}
	for _, arg := range template.Args {
		if err := validatePlaceholders(arg); err != nil {
			return CommandTemplate{}, fmt.Errorf("process arg template %q: %w", arg, err)
		}
	}
	for _, entry := range template.Env {
		key, value, err := parseEnvTemplate(entry)
		if err != nil {
			return CommandTemplate{}, err
		}
		if err := validatePlaceholders(value); err != nil {
			return CommandTemplate{}, fmt.Errorf("process env %q template: %w", key, err)
		}
	}
	return template, nil
}

func (t CommandTemplate) Expand(ctx RunProcessContext) ([]string, []string, error) {
	args := make([]string, 0, len(t.Args))
	for _, arg := range t.Args {
		expanded, err := expandPlaceholders(arg, ctx)
		if err != nil {
			return nil, nil, fmt.Errorf("expand process arg template %q: %w", arg, err)
		}
		args = append(args, expanded)
	}

	var env []string
	if t.Env != nil {
		env = make([]string, 0, len(t.Env))
	}
	for _, entry := range t.Env {
		key, value, err := parseEnvTemplate(entry)
		if err != nil {
			return nil, nil, err
		}
		expanded, err := expandPlaceholders(value, ctx)
		if err != nil {
			return nil, nil, fmt.Errorf("expand process env %q template: %w", key, err)
		}
		env = append(env, key+"="+expanded)
	}
	return args, env, nil
}

func parseEnvTemplate(entry string) (string, string, error) {
	key, value, ok := strings.Cut(entry, "=")
	if !ok {
		return "", "", fmt.Errorf("process env entry must use KEY=VALUE")
	}
	if err := validateEnvKey(key); err != nil {
		return "", "", err
	}
	return key, value, nil
}

func validateEnvKey(key string) error {
	if key == "" {
		return fmt.Errorf("process env key is required")
	}
	if strings.TrimSpace(key) != key {
		return fmt.Errorf("process env key %q must not contain surrounding whitespace", key)
	}
	for _, r := range key {
		if r == '=' || r == 0 || r == ' ' || r == '\t' || r == '\n' || r == '\r' {
			return fmt.Errorf("process env key %q contains invalid whitespace or separator", key)
		}
	}
	return nil
}

func validatePlaceholders(value string) error {
	_, err := expandPlaceholders(value, RunProcessContext{})
	return err
}

func expandPlaceholders(value string, ctx RunProcessContext) (string, error) {
	var out strings.Builder
	for {
		start := strings.Index(value, "{{")
		if start == -1 {
			out.WriteString(value)
			return out.String(), nil
		}
		out.WriteString(value[:start])
		value = value[start+2:]

		end := strings.Index(value, "}}")
		if end == -1 {
			return "", fmt.Errorf("unterminated placeholder")
		}
		name := strings.TrimSpace(value[:end])
		replacement, ok := runPlaceholderValue(name, ctx)
		if !ok {
			return "", fmt.Errorf("unknown placeholder %q", name)
		}
		out.WriteString(replacement)
		value = value[end+2:]
	}
}

func runPlaceholderValue(name string, ctx RunProcessContext) (string, bool) {
	switch name {
	case "run.id":
		return ctx.Run.ID, true
	case "run.projectId":
		return ctx.Run.ProjectID, true
	case "run.threadId":
		return ctx.Run.ThreadID, true
	case "run.prompt":
		return ctx.Prompt, true
	case "agent.id":
		return ctx.AgentID, true
	case "agent.model":
		return ctx.Model, true
	case "run.workdir":
		return ctx.WorkDir, true
	default:
		return "", false
	}
}
