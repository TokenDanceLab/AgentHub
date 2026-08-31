package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newTestServer creates a Handler with defaults, registers routes on a mux,
// and returns a running httptest.NewServer plus the Handler for inspection.
func newTestServer(t *testing.T) (*httptest.Server, *Handler) {
	t.Helper()
	h := newTestHandler()
	// Adapter runs require a non-empty workDir inside the allowlist (#854).
	h.WorkspaceAllowlist = []string{t.TempDir()}
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	return httptest.NewServer(mux), h
}

func testRunWorkDir(t *testing.T, h *Handler) string {
	t.Helper()
	if len(h.WorkspaceAllowlist) == 0 {
		return allowTestWorkspace(t, h)
	}
	return h.WorkspaceAllowlist[0]
}

// getJSON performs GET and decodes the JSON body into dst.
func getJSON(t *testing.T, url string, dst any) int {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if dst != nil {
		if err := json.Unmarshal(body, dst); err != nil {
			t.Fatalf("decode body: %v\nbody=%s", err, string(body))
		}
	}
	return resp.StatusCode
}

// postJSON performs POST with the given body string and decodes the JSON response into dst.
func postJSON(t *testing.T, url string, body string, dst any) int {
	t.Helper()
	resp, err := http.Post(url, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if dst != nil {
		if err := json.Unmarshal(respBody, dst); err != nil {
			t.Fatalf("decode body: %v\nbody=%s", err, string(respBody))
		}
	}
	return resp.StatusCode
}

// ── Health endpoint behavioral tests ──

func TestHealthEndpoint(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()

	var body map[string]any
	code := getJSON(t, server.URL+"/v1/health", &body)
	if code != http.StatusOK {
		t.Fatalf("expected 200, got %d", code)
	}
	// The /v1/health endpoint does NOT use the writeSuccess envelope,
	// it writes directly via writeJSON. So unwrap is not needed.
	if body["status"] != "ok" {
		t.Errorf("expected status=ok, got %v", body["status"])
	}
	if body["version"] != "v1" {
		t.Errorf("expected version=v1, got %v", body["version"])
	}
	if body["edgeId"] != "local" {
		t.Errorf("expected edgeId=local, got %v", body["edgeId"])
	}
	checks, ok := body["checks"].(map[string]any)
	if !ok {
		t.Fatalf("checks is %T, want object", body["checks"])
	}
	if checks["store"] == nil {
		t.Error("expected store check")
	}
	if checks["runners"] == nil {
		t.Error("expected runners check")
	}
	if checks["executor"] == nil {
		t.Error("expected executor check")
	}
	// Content-Type is a response header, not in the JSON body.
	// The writeJSON function sets "application/json; charset=utf-8".
	// The TestContentTypeIsJSON test verifies the header separately.
}

// ── PostRuns endpoint behavioral tests ──

func TestPostRunsInvalidBody(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()

	// Send malformed JSON body.
	var body map[string]any
	code := postJSON(t, server.URL+"/v1/runs", `{bad json}`, &body)
	if code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid JSON, got %d: %v", code, body)
	}
	errObj, ok := body["error"].(map[string]any)
	if !ok {
		t.Fatalf("expected error object, got %T", body["error"])
	}
	if errObj["code"] == nil {
		t.Error("expected error code in response")
	}
}

func TestPostRunsSuccess(t *testing.T) {
	server, h := newTestServer(t)
	defer server.Close()

	var body map[string]any
	code := postJSON(t, server.URL+"/v1/runs", fmt.Sprintf(`{"prompt":"hello","workDir":%q}`, testRunWorkDir(t, h)), &body)
	if code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %v", code, body)
	}
	body = unwrapSuccess(body)
	if body["runId"] == nil {
		t.Error("expected runId in response")
	}
	if body["status"] != "queued" {
		t.Errorf("expected status=queued, got %v", body["status"])
	}
}

func TestPostRunsInvalidPermissionMode(t *testing.T) {
	server, h := newTestServer(t)
	defer server.Close()

	var body map[string]any
	// Invalid permission mode is checked after workDir; provide a valid workDir.
	code := postJSON(t, server.URL+"/v1/runs", fmt.Sprintf(`{"permissionMode":"nonsense","workDir":%q}`, testRunWorkDir(t, h)), &body)
	if code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid permission mode, got %d: %v", code, body)
	}
}

// ── Nonexistent endpoint tests ──

func TestNonexistentEndpoint(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()

	code := getJSON(t, server.URL+"/v1/nonexistent", nil)
	if code != http.StatusNotFound {
		t.Fatalf("expected 404 for nonexistent endpoint, got %d", code)
	}
}

func TestNonexistentEndpointPost(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()

	// POST to an unregistered path. The default ServeMux returns a plain-text
	// 404 (not JSON), so don't try to decode the body as JSON.
	resp, err := http.Post(server.URL+"/v1/no-such-path", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatalf("POST /v1/no-such-path: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for nonexistent POST endpoint, got %d", resp.StatusCode)
	}
}

// ── Route method validation tests ──

func TestHealthEndpointWrongMethod(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()

	resp, err := http.Post(server.URL+"/v1/health", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatalf("POST /v1/health: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 for POST /v1/health, got %d", resp.StatusCode)
	}
}

func TestRunsEndpointWrongMethod(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()

	// GET is valid for /v1/runs (list runs), so test something that IS truly wrong.
	// DELETE /v1/runs is not registered — should 405.
	req, err := http.NewRequest(http.MethodDelete, server.URL+"/v1/runs", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("DELETE /v1/runs: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 for DELETE /v1/runs, got %d", resp.StatusCode)
	}
}

// ── decodeApplyJSON pure function tests ──

func TestDecodeApplyJSON_Valid(t *testing.T) {
	body := `{"file_path":"main.go","hunk_index":2,"accepted":true,"workDir":"/tmp"}`
	r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	var req applyRequest
	err := decodeApplyJSON(r, &req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if req.FilePath != "main.go" {
		t.Errorf("FilePath = %q, want main.go", req.FilePath)
	}
	if req.HunkIndex != 2 {
		t.Errorf("HunkIndex = %d, want 2", req.HunkIndex)
	}
	if !req.Accepted {
		t.Error("expected Accepted=true")
	}
	if req.WorkDir != "/tmp" {
		t.Errorf("WorkDir = %q, want /tmp", req.WorkDir)
	}
}

func TestDecodeApplyJSON_InvalidJSON(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{bad`))
	var req applyRequest
	err := decodeApplyJSON(r, &req)
	if err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
}

func TestDecodeApplyJSON_EmptyBody(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(``))
	var req applyRequest
	err := decodeApplyJSON(r, &req)
	if err == nil {
		t.Fatal("expected error for empty body, got nil")
	}
}

func TestDecodeApplyJSON_UnknownFields(t *testing.T) {
	// decodeApplyJSON differs from decodeOptionalJSON: it allows unknown fields.
	body := `{"file_path":"x.go","hunk_index":0,"accepted":true,"future_field":"extra"}`
	r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	var req applyRequest
	err := decodeApplyJSON(r, &req)
	if err != nil {
		t.Fatalf("unexpected error for unknown fields: %v", err)
	}
	if req.FilePath != "x.go" {
		t.Errorf("FilePath = %q, want x.go", req.FilePath)
	}
}

// ── parseHunks pure function tests ──

func TestParseHunks_EmptyPatch(t *testing.T) {
	hunks := parseHunks("")
	if hunks != nil {
		t.Fatalf("expected nil for empty patch, got %d hunks", len(hunks))
	}
}

func TestParseHunks_OnlyHeaderLines(t *testing.T) {
	// Diff header lines without any hunk markers.
	patch := "diff --git a/x.go b/x.go\nindex abc..def\n--- a/x.go\n+++ b/x.go\n"
	hunks := parseHunks(patch)
	if len(hunks) != 0 {
		t.Fatalf("expected 0 hunks for header-only diff, got %d", len(hunks))
	}
}

func TestParseHunks_MultipleHunks(t *testing.T) {
	patch := "@@ -1,3 +1,4 @@\n line1\n-line2\n+line2new\n+line3new\n line4\n@@ -10,2 +11,1 @@\n-line10\n+line10new"
	hunks := parseHunks(patch)
	if len(hunks) != 2 {
		t.Fatalf("got %d hunks, want 2", len(hunks))
	}
	// First hunk
	if hunks[0].oldStart != 1 || hunks[0].oldLines != 3 {
		t.Errorf("hunk 0 header: oldStart=%d oldLines=%d, want 1/3", hunks[0].oldStart, hunks[0].oldLines)
	}
	if hunks[0].newStart != 1 || hunks[0].newLines != 4 {
		t.Errorf("hunk 0 header: newStart=%d newLines=%d, want 1/4", hunks[0].newStart, hunks[0].newLines)
	}
	// Second hunk
	if hunks[1].oldStart != 10 || hunks[1].oldLines != 2 {
		t.Errorf("hunk 1 header: oldStart=%d oldLines=%d, want 10/2", hunks[1].oldStart, hunks[1].oldLines)
	}
}

func TestParseHunks_EmptyLinesSkipped(t *testing.T) {
	patch := "@@ -1,1 +1,2 @@\n\n+added\n"
	hunks := parseHunks(patch)
	if len(hunks) != 1 {
		t.Fatalf("got %d hunks, want 1", len(hunks))
	}
	// Empty line should be skipped; only the +added line should be in the hunk.
	if len(hunks[0].lines) != 1 {
		t.Fatalf("got %d lines, want 1 (empty line skipped)", len(hunks[0].lines))
	}
	if hunks[0].lines[0].lineType != '+' || hunks[0].lines[0].content != "added" {
		t.Errorf("line = %c:%q, want +:added", hunks[0].lines[0].lineType, hunks[0].lines[0].content)
	}
}

// ── parseHunkHeader pure function tests ──

func TestParseHunkHeader_Various(t *testing.T) {
	tests := []struct {
		name                                   string
		line                                   string
		oldStart, oldLines, newStart, newLines int
	}{
		{"standard", "@@ -5,10 +3,8 @@", 5, 10, 3, 8},
		{"single line", "@@ -1 +1 @@", 1, 1, 1, 1},
		{"no context", "@@ -0,0 +1,3 @@", 0, 0, 1, 3},
		{"large", "@@ -100,50 +200,60 @@", 100, 50, 200, 60},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			oldStart, oldLines, newStart, newLines := parseHunkHeader(tt.line)
			if oldStart != tt.oldStart || oldLines != tt.oldLines || newStart != tt.newStart || newLines != tt.newLines {
				t.Errorf("parseHunkHeader(%q) = (%d,%d,%d,%d), want (%d,%d,%d,%d)",
					tt.line, oldStart, oldLines, newStart, newLines,
					tt.oldStart, tt.oldLines, tt.newStart, tt.newLines)
			}
		})
	}
}

func TestParseHunkHeader_Malformed(t *testing.T) {
	tests := []string{
		"not a hunk header",
		"@@",
		"@@ -1",
		"",
	}
	for _, line := range tests {
		oldStart, oldLines, newStart, newLines := parseHunkHeader(line)
		if oldStart != 0 || oldLines != 0 || newStart != 0 || newLines != 0 {
			t.Errorf("parseHunkHeader(%q) = (%d,%d,%d,%d), want all zeros for malformed input",
				line, oldStart, oldLines, newStart, newLines)
		}
	}
}

// ── applyHunkToContent edge case tests ──

func TestApplyHunkToContent_EmptyOriginal(t *testing.T) {
	hunk := unifiedHunk{
		oldStart: 0, oldLines: 0,
		newStart: 1, newLines: 2,
		lines: []diffLine{
			{lineType: '+', content: "line1"},
			{lineType: '+', content: "line2"},
		},
	}
	result := applyHunkToContent("", hunk)
	if result != "line1\nline2\n" {
		t.Errorf("got %q, want line1\\nline2\\n", result)
	}
}

func TestApplyHunkToContent_AddAtEnd(t *testing.T) {
	original := "line1\n"
	hunk := unifiedHunk{
		oldStart: 1, oldLines: 1,
		newStart: 1, newLines: 2,
		lines: []diffLine{
			{lineType: ' ', content: "line1"},
			{lineType: '+', content: "line2"},
		},
	}
	result := applyHunkToContent(original, hunk)
	if !strings.HasSuffix(result, "line2\n") {
		t.Errorf("got %q, want line2 at end", result)
	}
}

func TestApplyHunkToContent_ContextOnly(t *testing.T) {
	// A hunk with only context lines (no changes) should preserve content.
	original := "line1\nline2\nline3\n"
	hunk := unifiedHunk{
		oldStart: 2, oldLines: 1,
		newStart: 2, newLines: 1,
		lines: []diffLine{
			{lineType: ' ', content: "line2"},
		},
	}
	result := applyHunkToContent(original, hunk)
	if result != original {
		t.Errorf("context-only hunk should preserve original, got %q want %q", result, original)
	}
}

func TestApplyHunkToContent_MultiLineReplace(t *testing.T) {
	original := "line1\nline2\nline3\n"
	hunk := unifiedHunk{
		oldStart: 2, oldLines: 2,
		newStart: 2, newLines: 3,
		lines: []diffLine{
			{lineType: '-', content: "line2"},
			{lineType: '-', content: "line3"},
			{lineType: '+', content: "new2"},
			{lineType: '+', content: "new3"},
			{lineType: '+', content: "new4"},
		},
	}
	result := applyHunkToContent(original, hunk)
	if !strings.Contains(result, "new2") || !strings.Contains(result, "new3") || !strings.Contains(result, "new4") {
		t.Errorf("got %q, want new2/new3/new4 present", result)
	}
	if strings.Contains(result, "line2\nline3") {
		t.Errorf("old lines should be removed, got %q", result)
	}
}

// ── parseRangeSpec pure function tests ──

func TestParseRangeSpec_EdgeCases(t *testing.T) {
	tests := []struct {
		name  string
		spec  string
		start int
		count int
	}{
		{"empty", "", 0, 0},
		{"only dash", "-", 0, 1}, // spec[1:] is "", Sscanf leaves start=0, count defaults to 1
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			start, count := parseRangeSpec(tt.spec)
			if start != tt.start || count != tt.count {
				t.Errorf("parseRangeSpec(%q) = (%d,%d), want (%d,%d)",
					tt.spec, start, count, tt.start, tt.count)
			}
		})
	}
}

// ── Response envelope tests via httptest server ──

func TestResponseEnvelope(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()

	// Most endpoints (proxied through RegisterRoutes) use writeSuccess.
	// Test GET /v1/runners which uses the envelope.
	var body map[string]any
	code := getJSON(t, server.URL+"/v1/runners", &body)
	if code != http.StatusOK {
		t.Fatalf("expected 200, got %d", code)
	}
	if body["code"] != "ok" {
		t.Errorf("expected code=ok in envelope, got %v", body["code"])
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected data object in envelope, got %T", body["data"])
	}
	items, ok := data["items"].([]any)
	if !ok {
		t.Fatalf("expected items array, got %T", data["items"])
	}
	if len(items) < 1 {
		t.Error("expected at least 1 runner in items")
	}
}

func TestErrorResponseHasCodeField(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()

	// GET a nonexistent project to trigger a 404 error response.
	var body map[string]any
	code := getJSON(t, server.URL+"/v1/projects/proj_nonexistent_12345", &body)
	if code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", code)
	}
	errObj, ok := body["error"].(map[string]any)
	if !ok {
		t.Fatalf("expected error object, got %T", body["error"])
	}
	if errObj["code"] == nil {
		t.Error("expected code field in error response")
	}
	if errObj["code"] == "" {
		t.Error("expected non-empty code in error response")
	}
}

func TestContentTypeIsJSON(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()

	resp, err := http.Get(server.URL + "/v1/health")
	if err != nil {
		t.Fatalf("GET /v1/health: %v", err)
	}
	defer resp.Body.Close()

	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "application/json") {
		t.Errorf("expected application/json content-type, got %q", ct)
	}
}

// ── applyRequest/applyAllRequest struct validation tests ──

func TestDecodeApplyJSON_ApplyAllRequest(t *testing.T) {
	body := `{"decisions":[{"file_path":"a.go","hunk_index":0,"accepted":true},{"file_path":"b.go","hunk_index":1,"accepted":false}],"workDir":"/ws"}`
	r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	var req applyAllRequest
	err := decodeApplyJSON(r, &req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(req.Decisions) != 2 {
		t.Fatalf("got %d decisions, want 2", len(req.Decisions))
	}
	if req.Decisions[0].FilePath != "a.go" {
		t.Errorf("decisions[0].FilePath = %q, want a.go", req.Decisions[0].FilePath)
	}
	if req.Decisions[1].Accepted {
		t.Error("decisions[1].Accepted = true, want false")
	}
	if req.WorkDir != "/ws" {
		t.Errorf("WorkDir = %q, want /ws", req.WorkDir)
	}
}

// ── idempotent behaviors ──

func TestHealthIsIdempotent(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()

	var body1, body2 map[string]any
	code1 := getJSON(t, server.URL+"/v1/health", &body1)
	code2 := getJSON(t, server.URL+"/v1/health", &body2)
	if code1 != code2 || code1 != http.StatusOK {
		t.Fatalf("health endpoint not idempotent: %d vs %d", code1, code2)
	}
	if body1["status"] != body2["status"] {
		t.Errorf("health status changed between calls: %v vs %v", body1["status"], body2["status"])
	}
}

func TestPostRunsCreatesDistinctRunIDs(t *testing.T) {
	server, h := newTestServer(t)
	defer server.Close()
	wd := testRunWorkDir(t, h)

	var body1, body2 map[string]any
	code1 := postJSON(t, server.URL+"/v1/runs", fmt.Sprintf(`{"prompt":"first","workDir":%q}`, wd), &body1)
	code2 := postJSON(t, server.URL+"/v1/runs", fmt.Sprintf(`{"prompt":"second","workDir":%q}`, wd), &body2)
	// First call: 202
	if code1 != http.StatusAccepted {
		t.Fatalf("first POST /v1/runs: expected 202, got %d: %v", code1, body1)
	}
	// Second call with same thread but first run is still queued: 409 conflict
	if code2 != http.StatusConflict {
		t.Fatalf("second POST /v1/runs: expected 409 (active run exists), got %d: %v", code2, body2)
	}
}

// ── POST /v1/runs with structured body tests ──

func TestPostRunsWithStructuredBody(t *testing.T) {
	server, h := newTestServer(t)
	defer server.Close()

	body := fmt.Sprintf(`{
		"projectId": "proj_local",
		"threadId": "thread_local",
		"prompt": "test prompt",
		"agentId": "",
		"model": "test-model",
		"reasoningEffort": "medium",
		"permissionMode": "acceptEdits",
		"includePartial": true,
		"workDir": %q
	}`, testRunWorkDir(t, h))
	var resp map[string]any
	code := postJSON(t, server.URL+"/v1/runs", body, &resp)
	if code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %v", code, resp)
	}
	resp = unwrapSuccess(resp)
	if resp["runId"] == nil {
		t.Error("expected runId")
	}
	if resp["projectId"] != "proj_local" {
		t.Errorf("projectId = %v", resp["projectId"])
	}
}

// ── POST /v1/runs delivery_id dedup (#2101 G2) ────────────────────────────────

func TestPostRuns_DeliveryIDDedup_SkipsDuplicate(t *testing.T) {
	server, h := newTestServer(t)
	defer server.Close()
	if h.DeliveryDedup == nil {
		t.Fatal("expected DeliveryDedup to be non-nil for dedup tests")
	}
	wd := testRunWorkDir(t, h)

	var first map[string]any
	code := postJSON(t, server.URL+"/v1/runs",
		fmt.Sprintf(`{"prompt":"once","workDir":%q,"deliveryId":"del-1"}`, wd), &first)
	if code != http.StatusAccepted {
		t.Fatalf("first POST: expected 202, got %d: %v", code, first)
	}

	// Second POST with same delivery_id must be deduplicated.
	var dup map[string]any
	code = postJSON(t, server.URL+"/v1/runs",
		fmt.Sprintf(`{"prompt":"twice","workDir":%q,"deliveryId":"del-1"}`, wd), &dup)
	if code != http.StatusAccepted {
		t.Fatalf("duplicate POST: expected 202, got %d: %v", code, dup)
	}
	data, _ := dup["data"].(map[string]any)
	if data == nil {
		t.Fatalf("expected data wrapper in response, got %#v", dup)
	}
	if v, _ := data["deduplicated"].(bool); !v {
		t.Fatalf("expected deduplicated=true, got %#v", data)
	}
}

func TestPostRuns_DeliveryIDDedup_DistinctIDsBothProcessed(t *testing.T) {
	server, h := newTestServer(t)
	defer server.Close()
	if h.DeliveryDedup == nil {
		t.Fatal("expected DeliveryDedup to be non-nil")
	}
	wd := testRunWorkDir(t, h)
	// Create a second thread so the active-run guard does not block the
	// second delivery on the same thread fixture.
	if _, err := h.Store.CreateThread("thread-B", "proj_local", "Thread B", "direct", "", ""); err != nil {
		t.Fatalf("create thread-B: %v", err)
	}

	var r1, r2 map[string]any
	code1 := postJSON(t, server.URL+"/v1/runs",
		fmt.Sprintf(`{"prompt":"a","workDir":%q,"deliveryId":"del-A"}`, wd), &r1)
	if code1 != http.StatusAccepted {
		t.Fatalf("first: expected 202, got %d: %v", code1, r1)
	}
	code2 := postJSON(t, server.URL+"/v1/runs",
		fmt.Sprintf(`{"prompt":"b","workDir":%q,"threadId":"thread-B","deliveryId":"del-B"}`, wd), &r2)
	if code2 != http.StatusAccepted {
		t.Fatalf("second: expected 202, got %d: %v", code2, r2)
	}
	data, _ := r2["data"].(map[string]any)
	if v, _ := data["deduplicated"].(bool); v {
		t.Fatalf("distinct deliveryId must NOT be deduplicated, got %#v", r2)
	}
}

func TestPostRuns_EmptyDeliveryID_BypassesDedup(t *testing.T) {
	server, h := newTestServer(t)
	defer server.Close()
	if h.DeliveryDedup == nil {
		t.Fatal("expected DeliveryDedup to be non-nil")
	}
	wd := testRunWorkDir(t, h)

	var body map[string]any
	code := postJSON(t, server.URL+"/v1/runs",
		fmt.Sprintf(`{"prompt":"legacy","workDir":%q}`, wd), &body)
	if code != http.StatusAccepted {
		t.Fatalf("expected 202 for legacy (no deliveryId), got %d: %v", code, body)
	}
	if _, ok := body["deduplicated"]; ok {
		t.Fatalf("legacy payload should not carry deduplicated flag, got %#v", body)
	}
}
