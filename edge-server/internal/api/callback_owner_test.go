package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/agenthub/edge-server/internal/deliverydedup"
	"github.com/agenthub/edge-server/internal/hub"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/store"
)

type executionIntentRecorder struct {
	contexts chan lifecycle.RunProcessContext
}

func (e *executionIntentRecorder) Start(_ store.Run, ctx lifecycle.RunProcessContext) error {
	e.contexts <- ctx
	return nil
}
func (e *executionIntentRecorder) Cancel(string) lifecycle.CancelResult {
	return lifecycle.CancelResult{Found: false}
}

func TestCallbackOwnerUnavailableDoesNotAdmit(t *testing.T) {
	executor := &admissionExecutor{}
	server, h := newDeliveryTestServer(t, executor, nil)
	defer server.Close()
	body := admissionRunBody(h.WorkspaceAllowlist[0], "owner-delivery", "owner-task", map[string]any{"callbackOwner": "edge"})
	rejected := postRunsRaw(t, server.URL, body)
	if rejected.status != http.StatusServiceUnavailable || errCode(rejected.body) != "callback_unavailable" || executor.StartCount() != 0 {
		t.Fatalf("unowned direct admission: %d %#v starts=%d", rejected.status, rejected.body, executor.StartCount())
	}
	if len(ensureStore(h).ListRuns("thread_local")) != 0 {
		t.Fatal("callback preflight created a run")
	}
	fallback := postRunsRaw(t, server.URL, admissionRunBody(h.WorkspaceAllowlist[0], "owner-delivery", "owner-task", map[string]any{"callbackOwner": "desktop"}))
	if fallback.status != http.StatusAccepted || unwrapSuccess(fallback.body)["callbackOwner"] != "desktop" || executor.StartCount() != 1 {
		t.Fatalf("Desktop fallback did not admit exactly once: %#v", fallback.body)
	}
}

func TestCallbackOwnerPersistsAcrossWarmAndColdReplay(t *testing.T) {
	executor := &admissionExecutor{}
	server, h := newDeliveryTestServer(t, executor, func(h *Handler) {
		h.CallbackClient = hub.NewCallbackClient("https://hub.example.invalid", "fixture-token", http.DefaultClient, hub.DefaultCallbackConfig())
	})
	defer server.Close()
	body := admissionRunBody(h.WorkspaceAllowlist[0], "owner-replay", "owner-task", map[string]any{"callbackOwner": "edge"})
	accepted := postRunsRaw(t, server.URL, body)
	if accepted.status != http.StatusAccepted {
		t.Fatalf("edge-owned admission: %d %#v", accepted.status, accepted.body)
	}
	runID := unwrapSuccess(accepted.body)["runId"]
	for _, cold := range []bool{false, true} {
		if cold {
			h.DeliveryDedup = deliverydedup.New(deliverydedup.DefaultCapacity, deliverydedup.DefaultTTL)
		}
		replay := postRunsRaw(t, server.URL, admissionRunBody(h.WorkspaceAllowlist[0], "owner-replay", "owner-task", map[string]any{"callbackOwner": "desktop"}))
		data := unwrapSuccess(replay.body)
		if replay.status != http.StatusAccepted || data["runId"] != runID || data["callbackOwner"] != "edge" || executor.StartCount() != 1 {
			t.Fatalf("replay changed owner: cold=%v %#v starts=%d", cold, replay.body, executor.StartCount())
		}
	}
}

func TestCallbackOwnershipHealthIsExplicitAndContainsNoCredential(t *testing.T) {
	for _, configured := range []bool{false, true} {
		t.Run(map[bool]string{false: "sidecar", true: "direct"}[configured], func(t *testing.T) {
			h := newTestHandler()
			defer h.Bus.Close()
			if configured {
				h.CallbackClient = hub.NewCallbackClient("https://hub.example.invalid", "fixture-secret-not-exported", http.DefaultClient, hub.DefaultCallbackConfig())
			}
			recorder := httptest.NewRecorder()
			h.GetHealth(recorder, httptest.NewRequest(http.MethodGet, "/v1/health", nil))
			var data struct {
				Capabilities map[string]bool `json:"capabilities"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &data); err != nil {
				t.Fatal(err)
			}
			if !data.Capabilities["runCallbackOwnership"] || data.Capabilities["directHubCallbacks"] != configured {
				t.Fatalf("wrong ownership capabilities: %s", recorder.Body.String())
			}
		})
	}
}

func TestExecutionIntentFixtureReachesEdgeAdmission(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "tests", "fixtures", "dispatch", "execution-intent.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		Cases []struct {
			Name     string         `json:"name"`
			Expected map[string]any `json:"expectedIntent"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures.Cases {
		if _, hasWorkDir := fixture.Expected["workDir"]; !hasWorkDir {
			continue
		}
		t.Run(fixture.Name, func(t *testing.T) {
			executor := &executionIntentRecorder{contexts: make(chan lifecycle.RunProcessContext, 1)}
			server, h := newDeliveryTestServer(t, executor, func(h *Handler) {
				h.CallbackClient = hub.NewCallbackClient("https://hub.example.invalid", "fixture-token", http.DefaultClient, hub.DefaultCallbackConfig())
			})
			defer server.Close()
			body := fixture.Expected
			body["workDir"] = h.WorkspaceAllowlist[0]
			body["callbackOwner"] = "edge"
			bytes, err := json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
			result := postRunsRaw(t, server.URL, string(bytes))
			if result.status != http.StatusAccepted {
				t.Fatalf("projected direct request rejected: %d %#v", result.status, result.body)
			}
			ctx := <-executor.contexts
			if ctx.WorkDir != h.WorkspaceAllowlist[0] || ctx.Model != body["model"] || ctx.Prompt != body["prompt"] || ctx.Run.CallbackOwner != "edge" {
				t.Fatalf("execution intent lost: %#v", ctx)
			}
			if wanted, ok := body["messages"].([]any); ok && len(ctx.Messages) != len(wanted) {
				t.Fatalf("messages lost: %#v", ctx.Messages)
			}
			if wanted, ok := body["pinnedMessages"].([]any); ok && len(ctx.PinnedMessages) != len(wanted) {
				t.Fatalf("pins lost: %#v", ctx.PinnedMessages)
			}
			if ctx.StructuredOutputSchema != body["structuredOutputSchema"] {
				t.Fatalf("schema lost: %q", ctx.StructuredOutputSchema)
			}
		})
	}
}
