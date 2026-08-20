package adapters

import (
	"context"
	"fmt"
	"testing"

	"github.com/agenthub/edge-server/internal/runnerctx"
)

// abortOnErrorHook returns ErrAbort for OnError.
type abortOnErrorHook struct{}

func (h *abortOnErrorHook) PreToolUse(ctx context.Context, toolName string, input map[string]any) (map[string]any, bool, string) {
	return input, false, ""
}
func (h *abortOnErrorHook) PostToolUse(ctx context.Context, toolName string, output string) string {
	return output
}
func (h *abortOnErrorHook) PermissionRequest(ctx context.Context, toolName string, risk RiskLevel) PermDecision {
	return PermAllow
}
func (h *abortOnErrorHook) OnError(ctx context.Context, err error) ErrorAction       { return ErrAbort }
func (h *abortOnErrorHook) PrePrompt(ctx context.Context, prompt string) string      { return prompt }
func (h *abortOnErrorHook) PostResponse(ctx context.Context, response string) string { return response }

// denyHook always denies permission requests.
type denyHook struct{}

func (h *denyHook) PreToolUse(ctx context.Context, toolName string, input map[string]any) (map[string]any, bool, string) {
	return input, false, ""
}
func (h *denyHook) PostToolUse(ctx context.Context, toolName string, output string) string {
	return output
}
func (h *denyHook) PermissionRequest(ctx context.Context, toolName string, risk RiskLevel) PermDecision {
	return PermDeny
}
func (h *denyHook) OnError(ctx context.Context, err error) ErrorAction       { return ErrRetry }
func (h *denyHook) PrePrompt(ctx context.Context, prompt string) string      { return prompt }
func (h *denyHook) PostResponse(ctx context.Context, response string) string { return response }

// prefixPromptHook adds a prefix to every prompt.
type prefixPromptHook struct {
	prefix string
}

func (h *prefixPromptHook) PreToolUse(ctx context.Context, toolName string, input map[string]any) (map[string]any, bool, string) {
	return input, false, ""
}
func (h *prefixPromptHook) PostToolUse(ctx context.Context, toolName string, output string) string {
	return output
}
func (h *prefixPromptHook) PermissionRequest(ctx context.Context, toolName string, risk RiskLevel) PermDecision {
	return PermAllow
}
func (h *prefixPromptHook) OnError(ctx context.Context, err error) ErrorAction { return ErrRetry }
func (h *prefixPromptHook) PrePrompt(ctx context.Context, prompt string) string {
	return h.prefix + prompt
}
func (h *prefixPromptHook) PostResponse(ctx context.Context, response string) string {
	return response
}

// suffixResponseHook appends a suffix to every response.
type suffixResponseHook struct {
	suffix string
}

func (h *suffixResponseHook) PreToolUse(ctx context.Context, toolName string, input map[string]any) (map[string]any, bool, string) {
	return input, false, ""
}
func (h *suffixResponseHook) PostToolUse(ctx context.Context, toolName string, output string) string {
	return output
}
func (h *suffixResponseHook) PermissionRequest(ctx context.Context, toolName string, risk RiskLevel) PermDecision {
	return PermAllow
}
func (h *suffixResponseHook) OnError(ctx context.Context, err error) ErrorAction  { return ErrRetry }
func (h *suffixResponseHook) PrePrompt(ctx context.Context, prompt string) string { return prompt }
func (h *suffixResponseHook) PostResponse(ctx context.Context, response string) string {
	return response + h.suffix
}

// --- adapter.go: SDKAdapterContext and RunProcessContextFromContext ---

func TestSDKAdapterContextAndExtraction(t *testing.T) {
	runCtx := runnerctx.RunProcessContext{
		Model:   "claude-sonnet-4-6",
		Prompt:  "test prompt",
		AgentID: "claude-code",
		WorkDir: "/tmp/test",
	}

	ctx := SDKAdapterContext(context.Background(), runCtx)
	extracted, ok := RunProcessContextFromContext(ctx)
	if !ok {
		t.Fatal("RunProcessContextFromContext should find the attached context")
	}
	if extracted.Model != "claude-sonnet-4-6" {
		t.Errorf("Model = %q, want claude-sonnet-4-6", extracted.Model)
	}
	if extracted.Prompt != "test prompt" {
		t.Errorf("Prompt = %q, want test prompt", extracted.Prompt)
	}
	if extracted.AgentID != "claude-code" {
		t.Errorf("AgentID = %q, want claude-code", extracted.AgentID)
	}
	if extracted.WorkDir != "/tmp/test" {
		t.Errorf("WorkDir = %q, want /tmp/test", extracted.WorkDir)
	}
}

func TestRunProcessContextFromContextEmpty(t *testing.T) {
	_, ok := RunProcessContextFromContext(context.Background())
	if ok {
		t.Error("empty context should return ok=false")
	}
}

func TestRunProcessContextFromContextWrongType(t *testing.T) {
	ctx := context.WithValue(context.Background(), CtxRunContext, "not a RunProcessContext")
	_, ok := RunProcessContextFromContext(ctx)
	if ok {
		t.Error("wrong-type value should return ok=false")
	}
}

func TestRunProcessContextFromContextNilValue(t *testing.T) {
	ctx := context.WithValue(context.Background(), CtxRunContext, nil)
	_, ok := RunProcessContextFromContext(ctx)
	if ok {
		t.Error("nil value should return ok=false")
	}
}

func TestSDKAdapterContextPreservesParent(t *testing.T) {
	type myKey string
	parent := context.WithValue(context.Background(), myKey("parent_key"), "parent_value")
	runCtx := runnerctx.RunProcessContext{Model: "sonnet"}
	child := SDKAdapterContext(parent, runCtx)

	if v := child.Value(myKey("parent_key")); v != "parent_value" {
		t.Error("SDKAdapterContext should preserve parent context values")
	}
	extracted, ok := RunProcessContextFromContext(child)
	if !ok || extracted.Model != "sonnet" {
		t.Error("SDKAdapterContext should add RunProcessContext")
	}
}

// --- adapter.go: ParseStreamError ---

func TestParseStreamErrorUnwrap(t *testing.T) {
	inner := fmt.Errorf("inner error")
	e := NewNonRecoverableParseError(inner)
	if e.Unwrap() != inner {
		t.Errorf("Unwrap should return the inner error")
	}

	e2 := NewRecoverableParseError(inner)
	if e2.Unwrap() != inner {
		t.Errorf("Unwrap should return the inner error")
	}

	e3 := &ParseStreamError{recoverable: true}
	if e3.Unwrap() != nil {
		t.Errorf("Unwrap of nil inner error should return nil")
	}
}

func TestParseStreamErrorRecoverable(t *testing.T) {
	e1 := NewRecoverableParseError(fmt.Errorf("x"))
	if !e1.Recoverable() {
		t.Error("recoverable error should report recoverable=true")
	}

	e2 := NewNonRecoverableParseError(fmt.Errorf("x"))
	if e2.Recoverable() {
		t.Error("non-recoverable error should report recoverable=false")
	}
}

// --- hooks.go: ClassifyToolRisk unknown tool ---

// --- control_protocol.go: NormalizePermissionDecision ---

func TestNormalizePermissionDecision(t *testing.T) {
	cases := []struct {
		name         string
		input        PermissionDecision
		wantBehavior string
		wantMsg      string
	}{
		{
			name:         "allow",
			input:        PermissionDecision{Behavior: "allow"},
			wantBehavior: "allow",
			wantMsg:      "",
		},
		{
			name:         "deny",
			input:        PermissionDecision{Behavior: "deny", Message: "blocked"},
			wantBehavior: "deny",
			wantMsg:      "blocked",
		},
		{
			name:         "invalid defaults to deny",
			input:        PermissionDecision{Behavior: "maybe"},
			wantBehavior: "deny",
			wantMsg:      "invalid or missing permission decision",
		},
		{
			name:         "invalid with custom message",
			input:        PermissionDecision{Behavior: "unsure", Message: "custom reason"},
			wantBehavior: "deny",
			wantMsg:      "custom reason",
		},
		{
			name:         "allow with whitespace",
			input:        PermissionDecision{Behavior: "  allow  "},
			wantBehavior: "allow",
			wantMsg:      "",
		},
		{
			name:         "deny with whitespace",
			input:        PermissionDecision{Behavior: "  deny  "},
			wantBehavior: "deny",
			wantMsg:      "",
		},
		{
			name:         "empty behavior",
			input:        PermissionDecision{Behavior: ""},
			wantBehavior: "deny",
			wantMsg:      "invalid or missing permission decision",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result := NormalizePermissionDecision(tc.input)
			if result.Behavior != tc.wantBehavior {
				t.Errorf("Behavior = %q, want %q", result.Behavior, tc.wantBehavior)
			}
			if result.Message != tc.wantMsg {
				t.Errorf("Message = %q, want %q", result.Message, tc.wantMsg)
			}
		})
	}
}

// --- invocation_plan.go: helper functions ---

func TestCommandNameOnly(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{"/usr/bin/claude", "claude"},
		{"codex", "codex"},
		{"/usr/local/bin/opencode", "opencode"},
		{"", ""},
		{"   ", ""},
		{"/path/to/npx", "npx"},
		{`C:\Program Files\nodejs\npx.exe`, "npx.exe"},
		{"npx.exe", "npx.exe"},
	}
	for _, tc := range cases {
		t.Run(tc.input, func(t *testing.T) {
			got := CommandNameOnly(tc.input)
			if got != tc.want {
				t.Errorf("CommandNameOnly(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestInvocationPathNameOnly(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{"/home/user/project", "project"},
		{"./relative/path", "relative/path"},
		{"simple", "simple"},
		{"", ""},
		{"   ", ""},
		{".", ""},
		{"..", ".."},
		{"../parent", "parent"},
		{"./././/nested/./path", "nested/path"},
		{"/abs/path", "path"},
		{`C:\Users\test`, "test"},
		{"project/sub", "project/sub"},
	}
	for _, tc := range cases {
		t.Run(tc.input, func(t *testing.T) {
			got := InvocationPathNameOnly(tc.input)
			if got != tc.want {
				t.Errorf("InvocationPathNameOnly(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestAppendUniqueString(t *testing.T) {
	cases := []struct {
		name  string
		slice []string
		value string
		want  []string
	}{
		{"add to empty", nil, "a", []string{"a"}},
		{"add new", []string{"a", "b"}, "c", []string{"a", "b", "c"}},
		{"skip duplicate", []string{"a", "b"}, "a", []string{"a", "b"}},
		{"add to empty slice", []string{}, "x", []string{"x"}},
		{"skip duplicate only", []string{"z"}, "z", []string{"z"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := appendUniqueString(tc.slice, tc.value)
			if len(got) != len(tc.want) {
				t.Fatalf("len = %d, want %d: %v vs %v", len(got), len(tc.want), got, tc.want)
			}
			for i := range tc.want {
				if got[i] != tc.want[i] {
					t.Errorf("index %d: %q vs %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}

func TestEnvNamesOnly(t *testing.T) {
	cases := []struct {
		name string
		env  []string
		want []string
	}{
		{"empty", nil, nil},
		{"single", []string{"HOME=/home/user"}, []string{"HOME"}},
		{"multiple", []string{"PATH=/usr/bin", "HOME=/home"}, []string{"PATH", "HOME"}},
		{"with empty", []string{"=value"}, nil},
		{"whitespace", []string{"  NODE_ENV  =production"}, []string{"NODE_ENV"}},
		{"duplicates", []string{"A=1", "B=2", "A=3"}, []string{"A", "B"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := EnvNamesOnly(tc.env)
			if len(got) != len(tc.want) {
				t.Fatalf("len = %d, want %d: %v", len(got), len(tc.want), got)
			}
			for i := range tc.want {
				if got[i] != tc.want[i] {
					t.Errorf("index %d: %q vs %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}

func TestSummarizeCLIInvocationArgs(t *testing.T) {
	t.Run("basic flags", func(t *testing.T) {
		flags, configKeys, positional := summarizeCLIInvocationArgs([]string{
			"--verbose", "-p", "test prompt", "--model", "sonnet",
		})
		if len(flags) < 2 {
			t.Errorf("expected at least 2 flags, got %d: %v", len(flags), flags)
		}
		_ = configKeys
		_ = positional
	})

	t.Run("separator args", func(t *testing.T) {
		flags, _, positional := summarizeCLIInvocationArgs([]string{
			"--flag", "--", "positional1", "positional2",
		})
		if positional != 2 {
			t.Errorf("expected 2 positional after --, got %d", positional)
		}
		_ = flags
	})

	t.Run("config keys", func(t *testing.T) {
		_, configKeys, _ := summarizeCLIInvocationArgs([]string{
			"--config", "key=value",
		})
		if len(configKeys) != 1 || configKeys[0] != "key" {
			t.Errorf("expected configKeys=[key], got %v", configKeys)
		}
	})

	t.Run("empty args", func(t *testing.T) {
		flags, configKeys, positional := summarizeCLIInvocationArgs(nil)
		if len(flags) != 0 || len(configKeys) != 0 || positional != 0 {
			t.Error("empty args should return zeros")
		}
	})

	t.Run("equals flags", func(t *testing.T) {
		flags, _, _ := summarizeCLIInvocationArgs([]string{"--model=sonnet", "--verbose=1"})
		if len(flags) != 2 {
			t.Errorf("expected 2 flags, got %d: %v", len(flags), flags)
		}
	})
}

// --- security_hooks.go: error types ---

func TestDangerousPatternsValidationErrorUnwrap(t *testing.T) {
	e := &dangerousPatternsValidationError{errs: []string{"err1", "err2"}}
	errs := e.Unwrap()
	if len(errs) != 2 {
		t.Fatalf("expected 2 errors, got %d", len(errs))
	}
	if errs[0].Error() != "err1" {
		t.Errorf("errs[0] = %q, want err1", errs[0].Error())
	}
	if errs[1].Error() != "err2" {
		t.Errorf("errs[1] = %q, want err2", errs[1].Error())
	}
}

func TestDangerousPatternsValidationErrorEmpty(t *testing.T) {
	e := &dangerousPatternsValidationError{errs: nil}
	msg := e.Error()
	if msg != "dangerousPatternsRE validation failures: " {
		t.Errorf("empty Error() = %q", msg)
	}

	e2 := &dangerousPatternsValidationError{errs: []string{}}
	if len(e2.Unwrap()) != 0 {
		t.Error("Unwrap of empty errs should return empty slice")
	}
}

// --- hooks.go: HookChain edge cases ---

func TestHookChainRunOnErrorDefault(t *testing.T) {
	chain := HookChain{} // empty chain should default to Retry
	action := chain.RunOnError(context.Background(), fmt.Errorf("test"))
	if action != ErrRetry {
		t.Errorf("empty chain should return ErrRetry, got %q", action)
	}
}

func TestHookChainRunOnErrorFirstNonRetryWins(t *testing.T) {
	chain := HookChain{
		&blockAllHook{},     // returns ErrRetry
		&abortOnErrorHook{}, // returns ErrAbort
		&blockAllHook{},     // should not be reached
	}
	action := chain.RunOnError(context.Background(), fmt.Errorf("test"))
	if action != ErrAbort {
		t.Errorf("expected ErrAbort from second hook, got %q", action)
	}
}

// --- hooks.go: HookChain comprehensive tests ---

func TestHookChainRunPreToolUseAllPassChained(t *testing.T) {
	chain := HookChain{
		&modifyInputHook{},
		&modifyInputHook{},
	}
	input := map[string]any{"key": "val"}
	modified, blocked, reason := chain.RunPreToolUse(context.Background(), "Write", input)
	if blocked {
		t.Error("should not be blocked")
	}
	if reason != "" {
		t.Errorf("reason should be empty, got %q", reason)
	}
	if modified["modified"] != true {
		t.Error("input should be modified")
	}
}

func TestHookChainRunPostToolUseAllPass(t *testing.T) {
	chain := HookChain{
		&appendToOutputHook{suffix: " [A]"},
		&appendToOutputHook{suffix: " [B]"},
		&appendToOutputHook{suffix: " [C]"},
	}
	result := chain.RunPostToolUse(context.Background(), "Read", "hello")
	if result != "hello [A] [B] [C]" {
		t.Errorf("RunPostToolUse = %q, want 'hello [A] [B] [C]'", result)
	}
}

func TestHookChainRunPermissionRequestFirstDenyWins(t *testing.T) {
	chain := HookChain{
		&denyHook{},
		&blockAllHook{}, // should not be consulted
	}
	decision := chain.RunPermissionRequest(context.Background(), "Bash", RiskHigh)
	if decision != PermDeny {
		t.Errorf("expected PermDeny, got %q", decision)
	}
}

func TestHookChainRunPermissionRequestAllAllow(t *testing.T) {
	chain := HookChain{
		&modifyInputHook{},    // returns PermAllow
		&appendToOutputHook{}, // returns PermAllow
	}
	decision := chain.RunPermissionRequest(context.Background(), "Read", RiskLow)
	if decision != PermAllow {
		t.Errorf("expected PermAllow, got %q", decision)
	}
}

func TestHookChainRunPrePromptChain(t *testing.T) {
	chain := HookChain{
		&prefixPromptHook{prefix: "A: "},
		&prefixPromptHook{prefix: "B: "},
	}
	result := chain.RunPrePrompt(context.Background(), "hello")
	if result != "B: A: hello" {
		t.Errorf("RunPrePrompt = %q, want 'B: A: hello'", result)
	}
}

func TestHookChainRunPostResponseChain(t *testing.T) {
	chain := HookChain{
		&suffixResponseHook{suffix: " [X]"},
		&suffixResponseHook{suffix: " [Y]"},
	}
	result := chain.RunPostResponse(context.Background(), "response")
	if result != "response [X] [Y]" {
		t.Errorf("RunPostResponse = %q, want 'response [X] [Y]'", result)
	}
}
