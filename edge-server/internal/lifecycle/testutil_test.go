package lifecycle

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/adapters/sdk"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
)

// newExecutorTestRun creates a project, thread, and run in the given store.
func newExecutorTestRun(t *testing.T, s store.Repository) store.Run {
	t.Helper()
	suffix := testID(t)
	project, _ := s.CreateProject("proj_"+suffix, "Test Project", "")
	thread, err := s.CreateThread("thread_"+suffix, project.ID, "Test Thread", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	run, err := s.CreateRun("run_"+suffix, project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	return run
}

func testID(t *testing.T) string {
	t.Helper()
	replacer := strings.NewReplacer("/", "_", "\\", "_", " ", "_")
	return fmt.Sprintf("%s_%d_%d", replacer.Replace(t.Name()), os.Getpid(), time.Now().UnixNano())
}

// nextEvent reads the next event from a channel with a CI-safe timeout.
func nextEvent(t *testing.T, ch <-chan events.EventEnvelope) events.EventEnvelope {
	t.Helper()
	return nextEventWithin(t, ch, 5*time.Second)
}

// nextEventWithin reads the next event from a channel with a configurable timeout.
func nextEventWithin(t *testing.T, ch <-chan events.EventEnvelope, timeout time.Duration) events.EventEnvelope {
	t.Helper()
	select {
	case evt := <-ch:
		return evt
	case <-time.After(timeout):
		t.Fatalf("timed out after %s waiting for event", timeout)
		return events.EventEnvelope{}
	}
}

// collectStdoutUntilFinished collects all stdout text from run.output.batch events
// until a run.finished event is received.
func collectStdoutUntilFinished(t *testing.T, ch <-chan events.EventEnvelope) string {
	t.Helper()

	var stdoutText string
	for {
		evt := nextEvent(t, ch)
		switch evt.Type {
		case "run.started":
		case "run.output.batch":
			payload, ok := evt.Payload.(map[string]any)
			if !ok {
				t.Fatalf("output payload = %T, want map", evt.Payload)
			}
			if payload["stream"] != "stdout" {
				continue
			}
			chunks, ok := payload["chunks"].([]map[string]any)
			if !ok || len(chunks) == 0 {
				t.Fatalf("output chunks = %#v, want non-empty []map[string]any", payload["chunks"])
			}
			text, _ := chunks[0]["text"].(string)
			stdoutText += text
		case "run.finished":
			return stdoutText
		default:
			t.Fatalf("unexpected event type %q", evt.Type)
		}
	}
}

const processExecutorHelperRunFlag = "-test.run=^TestProcessExecutorHelper$"

type recordingLifecycleEmitter struct {
	events []string
}

func (e *recordingLifecycleEmitter) Emit(eventType string, _ map[string]any, _ any) {
	e.events = append(e.events, eventType)
}

func (a *recordingContextAdapter) Metadata() adapters.AdapterMetadata {
	return adapters.AdapterMetadata{ID: "recording-agent", Name: "Recording Agent"}
}

func (a *recordingContextAdapter) Capabilities() adapters.AgentCapabilities {
	return adapters.AgentCapabilities{Streaming: true, MultiTurn: true}
}

func (a *recordingContextAdapter) BuildCommand(ctx adapters.RunProcessContext) (string, []string, []string, string) {
	a.contexts <- ctx
	return os.Args[0], []string{processExecutorHelperRunFlag, "--", "success"}, append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"), ""
}

func (a *recordingContextAdapter) ParseStream(ctx context.Context, stdout io.Reader, _ io.Writer, emitter adapters.EventEmitter, run store.Run) error {
	_, err := io.Copy(io.Discard, stdout)
	if err != nil {
		return err
	}
	emitter.Emit(adapters.BusEventResult, map[string]any{
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"runId":     run.ID,
	}, map[string]any{"success": true})
	return ctx.Err()
}

func (a *recordingContextAdapter) NeedsStdin() bool { return false }

func (a *recordingContextAdapter) Available() bool { return true }

func (a *fixtureSDKStreamAdapter) Metadata() adapters.AdapterMetadata {
	return adapters.AdapterMetadata{ID: a.id, Name: "Fixture SDK Stream"}
}

func (a *fixtureSDKStreamAdapter) Capabilities() adapters.AgentCapabilities {
	return adapters.AgentCapabilities{
		Streaming:       true,
		ToolCalls:       true,
		PermissionHooks: true,
		MultiTurn:       true,
	}
}

func (a *fixtureSDKStreamAdapter) BuildCommand(ctx adapters.RunProcessContext) (string, []string, []string, string) {
	mode := a.mode
	if mode == "" {
		mode = "sdk-fixture-json"
	}
	return os.Args[0], []string{processExecutorHelperRunFlag, "--", mode}, append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"), ""
}

func (a *fixtureSDKStreamAdapter) ParseStream(ctx context.Context, stdout io.Reader, _ io.Writer, emitter adapters.EventEmitter, run store.Run) error {
	data, err := io.ReadAll(stdout)
	if err != nil {
		return err
	}
	stream, err := sdk.DecodeSDKFixtureStream(data)
	if err != nil {
		return adapters.NewRecoverableParseError(err)
	}
	scope := map[string]any{
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"runId":     run.ID,
	}
	for _, mapped := range sdk.MapSDKFixtureStream(stream, scope) {
		emitter.Emit(mapped.Type, mapped.Scope, mapped.Payload)
	}
	return nil
}

func (a *fixtureSDKStreamAdapter) NeedsStdin() bool { return false }

func (a *fixtureSDKStreamAdapter) Available() bool { return true }

func newTestProcessExecutor(t *testing.T, bus *events.Bus, s store.RunLifecycleStore, mode string) *ProcessExecutor {
	t.Helper()

	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", mode},
		Env:     append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}
	// Disable fault-escalation by default so existing unit tests observe a single
	// terminal attempt. Escalation-specific tests re-enable it explicitly.
	executor.faultEscalationCfg = FaultEscalationConfig{Enabled: false}
	return executor
}

func (a *needsStdinTestAdapter) Metadata() adapters.AdapterMetadata {
	return adapters.AdapterMetadata{ID: "needs-stdin-test", Name: "Needs Stdin Test"}
}

func (a *needsStdinTestAdapter) Capabilities() adapters.AgentCapabilities {
	return adapters.AgentCapabilities{Streaming: true, MultiTurn: true}
}

func (a *needsStdinTestAdapter) BuildCommand(ctx adapters.RunProcessContext) (string, []string, []string, string) {
	return a.cmdPath, a.cmdArgs, append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"), ""
}

func (a *needsStdinTestAdapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter adapters.EventEmitter, run store.Run) error {
	// Drain stdout (test helper prints "stdin-ok" after reading from stdin)
	data, err := io.ReadAll(stdout)
	if err != nil {
		return err
	}
	emitter.Emit(adapters.BusEventResult, map[string]any{
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"runId":     run.ID,
	}, map[string]any{"output": string(data)})
	return nil
}

func (a *needsStdinTestAdapter) NeedsStdin() bool { return true }

func (a *needsStdinTestAdapter) Available() bool { return true }
