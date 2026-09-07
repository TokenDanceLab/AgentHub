package dispatchsvc

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/outboundhttp"
)

func TestDirectCallbackRouteFailsClosedBeforeExecution(t *testing.T) {
	cases := []struct {
		name, health, receipt, params string
		wantPosts                     int
		wantRun                       string
	}{
		{"team-routing-needs-desktop", `{"edgeId":"fixture-edge-device","capabilities":{"runCallbackOwnership":true,"directHubCallbacks":true}}`, "", `{"work_dir":"/workspace/project","agenthub_team_context":{"team_id":"team-1","team_run_id":"team-run-1"}}`, 0, ""},
		{"old-edge", `{"status":"ok"}`, "", `{"work_dir":"/workspace/project"}`, 0, ""},
		{"sidecar-no-callback", `{"edgeId":"fixture-edge-device","capabilities":{"runCallbackOwnership":true,"directHubCallbacks":false}}`, "", `{"work_dir":"/workspace/project"}`, 0, ""},
		{"missing-owner-enforcement", `{"edgeId":"fixture-edge-device","capabilities":{"directHubCallbacks":true}}`, "", `{"work_dir":"/workspace/project"}`, 0, ""},
		{"missing-workspace", `{"edgeId":"fixture-edge-device","capabilities":{"runCallbackOwnership":true,"directHubCallbacks":true}}`, "", "{}", 0, ""},
		{"edge-owned", `{"edgeId":"fixture-edge-device","capabilities":{"runCallbackOwnership":true,"directHubCallbacks":true}}`, `{"code":"ok","data":{"runId":"run-owned","callbackOwner":"edge"}}`, `{"work_dir":"/workspace/project","model":"chosen-model"}`, 1, "run-owned"},
		{"desktop-owned-replay", `{"edgeId":"fixture-edge-device","capabilities":{"runCallbackOwnership":true,"directHubCallbacks":true}}`, `{"code":"ok","data":{"runId":"run-owned","callbackOwner":"desktop"}}`, `{"work_dir":"/workspace/project"}`, 1, "run-owned"},
		{"unknown-receipt-owner", `{"edgeId":"fixture-edge-device","capabilities":{"runCallbackOwnership":true,"directHubCallbacks":true}}`, `{"code":"ok","data":{"runId":"run-owned"}}`, `{"work_dir":"/workspace/project"}`, 1, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var posts atomic.Int32
			bodies := make(chan map[string]any, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/v1/health" && r.Method == http.MethodGet {
					_, _ = w.Write([]byte(tc.health))
					return
				}
				if r.URL.Path != "/v1/runs" || r.Method != http.MethodPost {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				posts.Add(1)
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				bodies <- body
				w.WriteHeader(http.StatusAccepted)
				_, _ = w.Write([]byte(tc.receipt))
			}))
			defer server.Close()
			service := NewDispatchService(nil, nil, nil, nil, nil, nil, config.EdgeDispatchConfig{DeviceID: "fixture-edge-device", URL: server.URL, Timeout: time.Second}, outboundhttp.NewClient(time.Second), "")
			task := &model.PendingAgentTask{ID: "task-owner"}
			service.db = newDirectDispatchDB(t, task)
			payload := dispatchPayload{TaskID: task.ID, AgentType: "codex", Prompt: "fixture task", ModelParams: tc.params}
			got := service.dispatchToEdgeHTTP(context.Background(), task, &payload)
			if got.RunID != tc.wantRun || int(posts.Load()) != tc.wantPosts {
				t.Fatalf("run=%q posts=%d; want %q/%d", got.RunID, posts.Load(), tc.wantRun, tc.wantPosts)
			}
			if got.SafeToFallback != (tc.wantPosts == 0) {
				t.Fatalf("fallback=%v after %d POSTs", got.SafeToFallback, posts.Load())
			}
			if tc.wantPosts > 0 {
				body := <-bodies
				if body["workDir"] != "/workspace/project" || body["callbackOwner"] != "edge" {
					t.Fatalf("direct request lost intent or ownership: %#v", body)
				}
			}
		})
	}
}
