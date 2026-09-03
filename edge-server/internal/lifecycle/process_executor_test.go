package lifecycle

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
)

func TestProcessExecutorRequiresCommand(t *testing.T) {
	_, err := NewProcessExecutor(events.NewBus(10), store.New(), ProcessExecutorConfig{}, nil, nil)
	if !errors.Is(err, ErrProcessCommandRequired) {
		t.Fatalf("NewProcessExecutor error = %v, want ErrProcessCommandRequired", err)
	}
}

func TestProcessExecutorRequiresDependencies(t *testing.T) {
	_, err := NewProcessExecutor(nil, store.New(), ProcessExecutorConfig{Command: os.Args[0]}, nil, nil)
	if !errors.Is(err, ErrProcessBusRequired) {
		t.Fatalf("NewProcessExecutor nil bus error = %v, want ErrProcessBusRequired", err)
	}
	_, err = NewProcessExecutor(events.NewBus(10), nil, ProcessExecutorConfig{Command: os.Args[0]}, nil, nil)
	if !errors.Is(err, ErrProcessStoreRequired) {
		t.Fatalf("NewProcessExecutor nil store error = %v, want ErrProcessStoreRequired", err)
	}
}

func TestProcessExecutorRejectsInvalidWorkDir(t *testing.T) {
	tempDir := t.TempDir()
	filePath := filepath.Join(tempDir, "not-a-directory")
	if err := os.WriteFile(filePath, []byte("test"), 0o644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}

	tests := []struct {
		name    string
		workDir string
		want    string
	}{
		{
			name:    "missing",
			workDir: filepath.Join(tempDir, "missing"),
			want:    "is not accessible",
		},
		{
			name:    "file",
			workDir: filePath,
			want:    "is not a directory",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewProcessExecutor(events.NewBus(10), store.New(), ProcessExecutorConfig{
				Command: os.Args[0],
				WorkDir: tt.workDir,
			}, nil, nil)
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("NewProcessExecutor error = %v, want containing %q", err, tt.want)
			}
		})
	}
}

func TestProcessExecutorRejectsMissingRun(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := store.Run{
		ID:        "run_missing",
		ProjectID: "proj_missing",
		ThreadID:  "thread_missing",
		Status:    "queued",
	}
	_, ch, _ := bus.Subscribe(0)
	executor := newTestProcessExecutor(t, bus, s, "success")

	if err := executor.Start(run, RunProcessContext{}); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("Start missing run error = %v, want store.ErrNotFound", err)
	}
	select {
	case evt := <-ch:
		t.Fatalf("unexpected event after missing run start: %s", evt.Type)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestProcessExecutorRejectsDuplicateStart(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	executor := newTestProcessExecutor(t, bus, s, "sleep")

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("first Start returned error: %v", err)
	}
	if err := executor.Start(run, RunProcessContext{}); !errors.Is(err, ErrRunAlreadyStarted) {
		t.Fatalf("second Start error = %v, want ErrRunAlreadyStarted", err)
	}
	_ = executor.Cancel(run.ID)
}

func TestSanitizeSubAgentResult_Nil(t *testing.T) {
	result, reason := SanitizeSubAgentResult(nil)
	if result != nil {
		t.Fatalf("SanitizeSubAgentResult(nil) = %v, want nil", result)
	}
	if reason != "" {
		t.Fatalf("reason for nil = %q, want empty", reason)
	}
}

func TestSanitizeSubAgentResult_EmptyString(t *testing.T) {
	result, reason := SanitizeSubAgentResult("")
	if result != "" {
		t.Fatalf("SanitizeSubAgentResult(\"\") = %q, want empty", result)
	}
	if reason != "" {
		t.Fatalf("reason for empty = %q, want empty", reason)
	}
}

func TestSanitizeSubAgentResult_StackTrace(t *testing.T) {
	input := "error: something failed\n\tat com.example.MyClass.doThing(MyClass.java:42)\ngoroutine 7 [running]:\n.../pkg/module.go:123 +0x45\nmore text"
	result, reason := SanitizeSubAgentResult(input)
	s, ok := result.(string)
	if !ok {
		t.Fatalf("result type = %T, want string", result)
	}
	if s == input {
		t.Fatalf("stack trace was not redacted: %q", s)
	}
	if !strings.Contains(s, "[redacted:stack-trace]") {
		t.Fatalf("result does not contain redaction marker: %q", s)
	}
	if !strings.Contains(s, "more text") {
		t.Fatalf("non-trace text was redacted: %q", s)
	}
	if reason != "stack-trace-redacted" {
		t.Fatalf("reason = %q, want stack-trace-redacted", reason)
	}
}

func TestSanitizeSubAgentResult_APIKey(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{"OpenAI key", "config: api_key=sk-proj-abc123def456ghi789jkl012mno345pqr678stu"},
		{"Anthropic key", "Authorization: Bearer sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234"},
		{"Google key", "key: AIzaSyDabc123def456ghi789jkl012mno345pqr"},
		{"GitHub classic", "token: ghp_abc123def456ghi789jkl012mno345pqr678s"},
		{"GitHub fine-grained", "token: github_pat_abc123def456ghi789jkl0_12"},
		{"GitLab token", "token: glpat-abc123def456ghi789jk"},
		{"HuggingFace token", "token: hf_abc123def456ghi789jkl012mno345pqr678"},
		{"JWT token", "auth: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"},
		{"AWS key", "access: AKIA1234567890ABCDEF"},
		{"Bearer header", "Authorization: Bearer abc123def456ghi789jkl012mno345pqr"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, reason := SanitizeSubAgentResult(tt.input)
			s, ok := result.(string)
			if !ok {
				t.Fatalf("result type = %T, want string", result)
			}
			if s == tt.input {
				t.Fatalf("API key was not redacted: %q", s)
			}
			if !strings.Contains(s, "[redacted:api-key]") {
				t.Fatalf("result does not contain redaction marker: %q", s)
			}
			if reason != "api-keys-redacted" {
				t.Fatalf("reason = %q, want api-keys-redacted", reason)
			}
		})
	}
}

func TestSanitizeSubAgentResult_FilePath(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{"Windows Code path", "reading from D:\\Code\\TokenDance\\AgentHub\\src\\main.go"},
		{"Windows Users path", "found at C:\\Users\\Example\\Documents\\file.txt"},
		{"Windows Projects path", "opening D:\\Projects\\myapp\\config.yaml"},
		{"Unix home path", "loading /home/example/config/settings.json"},
		{"Unix Users path", "reading /Users/john/Documents/report.md"},
		{"Unix tmp path", "temp file at /tmp/build/output.log"},
		{"Windows Desktop path", "saved to C:\\Users\\Admin\\Desktop\\export.csv"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, reason := SanitizeSubAgentResult(tt.input)
			s, ok := result.(string)
			if !ok {
				t.Fatalf("result type = %T, want string", result)
			}
			if s == tt.input {
				t.Fatalf("file path was not redacted: %q", s)
			}
			if !strings.Contains(s, "[redacted:file-path]") {
				t.Fatalf("result does not contain redaction marker: %q", s)
			}
			if reason != "file-paths-redacted" {
				t.Fatalf("reason = %q, want file-paths-redacted", reason)
			}
		})
	}
}

func TestSanitizeSubAgentResult_ChineseText(t *testing.T) {
	input := "执行结果：代码审查完成，发现3个问题。建议修复文件 src/utils/helper.go 中的空指针检查。\n分析报告已生成在 D:\\Code\\Projects\\report.md"
	result, reason := SanitizeSubAgentResult(input)
	s, ok := result.(string)
	if !ok {
		t.Fatalf("result type = %T, want string", result)
	}
	// Chinese text itself should be preserved.
	if !strings.Contains(s, "执行结果") || !strings.Contains(s, "代码审查完成") {
		t.Fatalf("Chinese text was corrupted: %q", s)
	}
	if !strings.Contains(s, "发现3个问题") || !strings.Contains(s, "建议修复文件") {
		t.Fatalf("Chinese text content lost: %q", s)
	}
	// File paths within the Chinese text should be redacted.
	if !strings.Contains(s, "[redacted:file-path]") {
		t.Fatalf("file path in Chinese text was not redacted: %q", s)
	}
	if !strings.Contains(reason, "file-paths-redacted") {
		t.Fatalf("reason = %q, want containing file-paths-redacted", reason)
	}
}

func TestSanitizeSubAgentResult_OversizedPayload(t *testing.T) {
	// Build a string larger than 32KB (maxSanitizedResultBytes).
	chunk := "abcdefghijklmnopqrstuvwxyz0123456789\n" // 37 bytes
	// Need > 32KB: 32*1024 = 32768. With 37-byte chunks, need ~886 chunks for ~32.7KB base.
	// Build ~33KB to ensure truncation.
	var builder strings.Builder
	for builder.Len() < 33*1024 {
		builder.WriteString(chunk)
	}
	input := builder.String()
	if len(input) <= maxSanitizedResultBytes {
		t.Fatalf("test setup: input length = %d, must be > %d", len(input), maxSanitizedResultBytes)
	}

	result, reason := SanitizeSubAgentResult(input)
	s, ok := result.(string)
	if !ok {
		t.Fatalf("result type = %T, want string", result)
	}
	if len(s) >= len(input) {
		t.Fatalf("oversized payload was not truncated: len(result)=%d >= len(input)=%d", len(s), len(input))
	}
	if !strings.Contains(s, "[truncated") {
		t.Fatalf("result does not contain truncation marker: %q", s[:200])
	}
	if reason != "truncated-32kb" {
		t.Fatalf("reason = %q, want truncated-32kb", reason)
	}
	// Verify the result is valid UTF-8 after truncation.
	if !utf8.ValidString(s) {
		t.Fatal("truncated result is not valid UTF-8")
	}
}

func TestSanitizeSubAgentResult_MultipleRedactions(t *testing.T) {
	input := "panic: runtime error\ngoroutine 1 [running]:\n\tat main.main(main.go:10)\nConfig loaded from D:\\Code\\Projects\\config.yaml\nusing api key: sk-proj-abc123def456ghi789jkl012mno345pqr678stu"
	result, reason := SanitizeSubAgentResult(input)
	s, ok := result.(string)
	if !ok {
		t.Fatalf("result type = %T, want string", result)
	}
	if !strings.Contains(s, "[redacted:stack-trace]") {
		t.Fatalf("stack trace not redacted: %q", s)
	}
	if !strings.Contains(s, "[redacted:file-path]") {
		t.Fatalf("file path not redacted: %q", s)
	}
	if !strings.Contains(s, "[redacted:api-key]") {
		t.Fatalf("API key not redacted: %q", s)
	}
	// Reason should contain all three redaction types in order.
	if !strings.Contains(reason, "stack-trace-redacted") || !strings.Contains(reason, "file-paths-redacted") || !strings.Contains(reason, "api-keys-redacted") {
		t.Fatalf("reason = %q, want all three redaction reasons", reason)
	}
}

func TestSanitizeSubAgentResult_StructuredMapPayload(t *testing.T) {
	payload := map[string]any{
		"status":  "ok",
		"message": "deployed from D:\\Code\\Projects\\app",
		"token":   "sk-ant-api03-abc123def456ghi789jkl012mno345",
		"count":   float64(42),
		"nested": map[string]any{
			"path": "/home/user/secret/config.yaml",
			"key":  "github_pat_abc123def456ghi789jkl0_12",
		},
	}

	result, reason := SanitizeSubAgentResult(payload)
	m, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("result type = %T, want map[string]any", result)
	}

	// Non-sensitive fields should be preserved.
	if m["status"] != "ok" || m["count"] != float64(42) {
		t.Fatalf("non-sensitive fields corrupted: %#v", m)
	}

	// Sensitive string values in top-level map should be redacted.
	if msg, ok := m["message"].(string); !ok || !strings.Contains(msg, "[redacted:file-path]") {
		t.Fatalf("message not redacted: %v", m["message"])
	}
	if tok, ok := m["token"].(string); !ok || !strings.Contains(tok, "[redacted:api-key]") {
		t.Fatalf("token not redacted: %v", m["token"])
	}

	// Nested map values should also be redacted.
	nested, ok := m["nested"].(map[string]any)
	if !ok {
		t.Fatalf("nested type = %T, want map[string]any", m["nested"])
	}
	if p, ok := nested["path"].(string); !ok || !strings.Contains(p, "[redacted:file-path]") {
		t.Fatalf("nested path not redacted: %v", nested["path"])
	}
	if k, ok := nested["key"].(string); !ok || !strings.Contains(k, "[redacted:api-key]") {
		t.Fatalf("nested key not redacted: %v", nested["key"])
	}

	if reason == "" {
		t.Fatal("reason should not be empty for redacted structured payload")
	}
}

func TestSanitizeSubAgentResult_StructuredSlicePayload(t *testing.T) {
	payload := []any{
		"status ok",
		"path: D:\\Code\\Projects\\main.go",
		"key: sk-proj-abc123def456ghi789jkl012mno345",
		map[string]any{
			"error": "panic at /home/user/app/main.go:42\ngoroutine 1 [running]:",
		},
		float64(99),
	}

	result, reason := SanitizeSubAgentResult(payload)
	sl, ok := result.([]any)
	if !ok {
		t.Fatalf("result type = %T, want []any", result)
	}

	if sl[0] != "status ok" {
		t.Fatalf("non-sensitive element corrupted: %v", sl[0])
	}
	if s, ok := sl[1].(string); !ok || !strings.Contains(s, "[redacted:file-path]") {
		t.Fatalf("element 1 not redacted: %v", sl[1])
	}
	if s, ok := sl[2].(string); !ok || !strings.Contains(s, "[redacted:api-key]") {
		t.Fatalf("element 2 not redacted: %v", sl[2])
	}
	if sl[4] != float64(99) {
		t.Fatalf("numeric element corrupted: %v", sl[4])
	}

	nested, ok := sl[3].(map[string]any)
	if !ok {
		t.Fatalf("nested element type = %T, want map[string]any", sl[3])
	}
	if errStr, ok := nested["error"].(string); !ok || !strings.Contains(errStr, "[redacted:stack-trace]") {
		t.Fatalf("nested error not redacted: %v", nested["error"])
	}
	if errStr, ok := nested["error"].(string); !ok || !strings.Contains(errStr, "[redacted:file-path]") {
		t.Fatalf("nested file path not redacted: %v", nested["error"])
	}

	if reason == "" {
		t.Fatal("reason should not be empty for redacted structured payload")
	}
}

func TestSanitizeSubAgentResult_NonStringTypes(t *testing.T) {
	tests := []struct {
		name    string
		payload any
	}{
		{"int", 42},
		{"float", 3.14},
		{"bool true", true},
		{"bool false", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, reason := SanitizeSubAgentResult(tt.payload)
			if result != tt.payload {
				t.Fatalf("SanitizeSubAgentResult(%v) = %v, want unchanged", tt.payload, result)
			}
			if reason != "" {
				t.Fatalf("reason for %v = %q, want empty", tt.payload, reason)
			}
		})
	}
}

func TestSanitizeSubAgentResult_CleanPayload(t *testing.T) {
	input := "everything looks good, no secrets or paths here"
	result, reason := SanitizeSubAgentResult(input)
	s, ok := result.(string)
	if !ok {
		t.Fatalf("result type = %T, want string", result)
	}
	if s != input {
		t.Fatalf("clean payload modified: %q != %q", s, input)
	}
	if reason != "" {
		t.Fatalf("reason for clean payload = %q, want empty", reason)
	}
}

func TestSanitizeSubAgentResult_OversizedChineseText(t *testing.T) {
	// Build a large CJK string to ensure UTF-8 safe truncation works
	// for multi-byte characters.
	chineseChunk := "这是一段中文测试文字用于验证截断功能。" // 54 bytes (18 CJK chars * 3 bytes)
	var builder strings.Builder
	for builder.Len() < 33*1024 {
		builder.WriteString(chineseChunk)
	}
	input := builder.String()
	if len(input) <= maxSanitizedResultBytes {
		t.Fatalf("test setup: input length = %d, must be > %d", len(input), maxSanitizedResultBytes)
	}

	result, reason := SanitizeSubAgentResult(input)
	s, ok := result.(string)
	if !ok {
		t.Fatalf("result type = %T, want string", result)
	}
	if len(s) >= len(input) {
		t.Fatalf("oversized CJK payload was not truncated")
	}
	if !strings.Contains(s, "[truncated") {
		t.Fatalf("result does not contain truncation marker")
	}
	if reason != "truncated-32kb" {
		t.Fatalf("reason = %q, want truncated-32kb", reason)
	}
	// Verify the result is valid UTF-8 (no broken CJK characters).
	if !utf8.ValidString(s) {
		t.Fatal("truncated CJK result is not valid UTF-8")
	}
}

// TestProcessExecutorTooManyConcurrentRuns verifies that Start returns
// ErrTooManyConcurrentRuns when the concurrency limit is reached.
func TestProcessExecutorTooManyConcurrentRuns(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	executor := newTestProcessExecutor(t, bus, s, "sleep")

	// Cap max concurrent runs at 2 for easy testing.
	executor.mu.Lock()
	executor.maxConcurrentRuns = 2
	executor.mu.Unlock()

	// Create 3 runs with explicit IDs (no nanosecond collision risk).
	var runs []store.Run
	for i := 0; i < 3; i++ {
		suffix := fmt.Sprintf("conc_%d_%d", i, time.Now().UnixNano())
		project, _ := s.CreateProject("proj_"+suffix, "Test", "")
		thread, err := s.CreateThread("thread_"+suffix, project.ID, "Test", "", "", "")
		if err != nil {
			t.Fatalf("CreateThread: %v", err)
		}
		run, err := s.CreateRun("run_"+suffix, project.ID, thread.ID)
		if err != nil {
			t.Fatalf("CreateRun: %v", err)
		}
		runs = append(runs, run)
	}

	// Start the first 2 — should succeed.
	for i := 0; i < 2; i++ {
		if err := executor.Start(runs[i], RunProcessContext{}); err != nil {
			t.Fatalf("Start run %d error = %v, want nil", i, err)
		}
	}

	// The 3rd must fail with concurrency error.
	err := executor.Start(runs[2], RunProcessContext{})
	if !errors.Is(err, ErrTooManyConcurrentRuns) {
		t.Fatalf("Start 3rd run error = %v, want ErrTooManyConcurrentRuns", err)
	}

	for i := 0; i < 2; i++ {
		executor.Cancel(runs[i].ID)
	}
}

// TestProcessExecutorStartRespectsCustomMaxConcurrent verifies that a
// custom maxConcurrentRuns is enforced correctly.
func TestProcessExecutorStartRespectsCustomMaxConcurrent(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	executor := newTestProcessExecutor(t, bus, s, "sleep")

	executor.mu.Lock()
	executor.maxConcurrentRuns = 1
	executor.mu.Unlock()

	run1 := newExecutorTestRun(t, s)
	run2 := newExecutorTestRun(t, s)

	if err := executor.Start(run1, RunProcessContext{}); err != nil {
		t.Fatalf("Start run1 error = %v", err)
	}
	err := executor.Start(run2, RunProcessContext{})
	if !errors.Is(err, ErrTooManyConcurrentRuns) {
		t.Fatalf("Start run2 error = %v, want ErrTooManyConcurrentRuns", err)
	}

	executor.Cancel(run1.ID)
}

// TestProcessExecutorEmptyCommandPathRejection verifies that an empty
// command produces a meaningful error at startup, not a crash.
func TestProcessExecutorEmptyCommandPathRejection(t *testing.T) {
	_, err := NewProcessExecutor(events.NewBus(10), store.New(), ProcessExecutorConfig{
		Command: "",
	}, nil, nil)
	if err == nil {
		t.Fatal("NewProcessExecutor returned nil error for empty command")
	}
}
