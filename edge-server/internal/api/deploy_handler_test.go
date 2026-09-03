package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/agenthub/edge-server/internal/store"
)

// ---------------------------------------------------------------------------
// ssh/scp stub mechanism
//
// PostDeployments drives deployments through the real ssh/scp binaries
// (runSSHCommand / runSCP). These tests exercise the handler's orchestration
// behavior (status codes, response contract, remote argument construction)
// by re-execing a copy of this test binary under the names ssh(.exe) /
// scp(.exe) at the head of PATH. The copy detects itself in init() via
// AGENTHUB_DEPLOY_STUB_DIR, records its arguments into calls.log and exits
// with the injected exit code instead of running the test suite. This keeps
// the exec path real while staying hermetic and deterministic. Talking to a
// real SSH host is deliberately uncovered — see the note at the top of
// deploy_ssh_test.go (the -ssh-integration flag it used to point at was never
// registered by anything, so nothing was actually skipped-pending there).
// ---------------------------------------------------------------------------

const (
	deployStubEnvDir  = "AGENTHUB_DEPLOY_STUB_DIR"
	deployStubEnvFail = "AGENTHUB_DEPLOY_STUB_FAIL"
	deployStubEnvHang = "AGENTHUB_DEPLOY_STUB_HANG"
	deployStubLogName = "calls.log"
)

func init() {
	if dir := os.Getenv(deployStubEnvDir); dir != "" {
		runDeployStubProcess(dir)
	}
}

// runDeployStubProcess implements the fake ssh/scp binary. It never returns.
func runDeployStubProcess(dir string) {
	role := "unknown"
	switch base := filepath.Base(os.Args[0]); {
	case strings.HasPrefix(base, "ssh"):
		role = "ssh"
	case strings.HasPrefix(base, "scp"):
		role = "scp"
	}
	line := role + "\t" + strings.Join(os.Args[1:], "\t") + "\n"
	if f, err := os.OpenFile(filepath.Join(dir, deployStubLogName), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600); err == nil {
		_, _ = f.WriteString(line)
		_ = f.Close()
	}
	if os.Getenv(deployStubEnvHang) != "" {
		// Simulate an unreachable host (no RST): block until the parent
		// context kills the process.
		select {}
	}
	if fail := os.Getenv(deployStubEnvFail); fail != "" {
		for _, arg := range os.Args[1:] {
			if strings.Contains(arg, fail) {
				os.Exit(3)
			}
		}
	}
	os.Exit(0)
}

// installDeploySSHStubs copies the current test binary into a fresh temp dir
// as ssh and scp and prepends that dir to PATH so runSSHCommand / runSCP
// resolve to the stubs. Returns the stub dir (calls.log is written there).
func installDeploySSHStubs(t *testing.T) string {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	dir := t.TempDir()
	suffix := ""
	if runtime.GOOS == "windows" {
		suffix = ".exe"
	}
	for _, name := range []string{"ssh", "scp"} {
		if err := copyFileForDeployStub(exe, filepath.Join(dir, name+suffix)); err != nil {
			t.Fatalf("copy test binary as %s: %v", name, err)
		}
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv(deployStubEnvDir, dir)
	return dir
}

func copyFileForDeployStub(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

// readDeployStubLog returns the recorded stub invocation lines.
func readDeployStubLog(t *testing.T, dir string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, deployStubLogName))
	if err != nil {
		t.Fatalf("read stub call log: %v", err)
	}
	return string(data)
}

// ---------------------------------------------------------------------------
// PostDeployments behavior tests (quad-scan Q8, #2056)
// ---------------------------------------------------------------------------

// seedDeployRun creates the project/thread/run chain used by deploy tests.
// New runs start in status "queued".
func seedDeployRun(t *testing.T, repo store.Repository, runID string) {
	t.Helper()
	if _, err := repo.CreateProject("proj-deploy", "Deploy", ""); err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	if _, err := repo.CreateThread("thread-deploy", "proj-deploy", "Deploy", "", "", ""); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if _, err := repo.CreateRun(runID, "proj-deploy", "thread-deploy"); err != nil {
		t.Fatalf("CreateRun: %v", err)
	}
}

// seedDeployArtifact adds a placeholder artifact (no readable content source)
// so the archive builder succeeds without touching workspace files.
func seedDeployArtifact(t *testing.T, repo store.Repository, runID, id, path string) {
	t.Helper()
	if _, err := repo.UpsertArtifact(store.Artifact{
		ID:    id,
		RunID: runID,
		Kind:  "file",
		Path:  path,
	}); err != nil {
		t.Fatalf("UpsertArtifact: %v", err)
	}
}

func doDeployments(h *Handler, method, body string) *httptest.ResponseRecorder {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, "/v1/deployments", reader)
	rec := httptest.NewRecorder()
	h.PostDeployments(rec, req)
	return rec
}

func TestPostDeploymentsRejectsNonPostMethod(t *testing.T) {
	h := newTestHandler()
	rec := doDeployments(h, http.MethodGet, "")
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), "method_not_allowed")
}

func TestPostDeploymentsRejectsInvalidJSON(t *testing.T) {
	h := newTestHandler()
	for name, body := range map[string]string{
		"malformed":     `{"runId": "run-x",`,
		"unknown field": `{"runId":"run-x","slug":"ok-slug","bogus":true}`,
	} {
		t.Run(name, func(t *testing.T) {
			rec := doDeployments(h, http.MethodPost, body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
			assertErrorCode(t, rec.Body.String(), "invalid_json")
		})
	}
}

func TestPostDeploymentsRequiresRunID(t *testing.T) {
	h := newTestHandler()
	for name, body := range map[string]string{
		"empty body":     "",
		"blank run id":   `{"runId":"   ","slug":"ok-slug"}`,
		"missing run id": `{"slug":"ok-slug"}`,
	} {
		t.Run(name, func(t *testing.T) {
			rec := doDeployments(h, http.MethodPost, body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
			assertErrorCode(t, rec.Body.String(), "run_id_required")
		})
	}
}

func TestPostDeploymentsRejectsInvalidSlug(t *testing.T) {
	h := newTestHandler()
	// Slug validation happens before the run lookup, so no run seeding needed.
	for _, slug := range []string{"", "Bad_Slug", "-leading", "a"} {
		t.Run("slug="+slug, func(t *testing.T) {
			rec := doDeployments(h, http.MethodPost, `{"runId":"run-x","slug":"`+slug+`"}`)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
			assertErrorCode(t, rec.Body.String(), "deploy_invalid_slug")
		})
	}
}

func TestPostDeploymentsRunNotFound(t *testing.T) {
	h := newTestHandler()
	rec := doDeployments(h, http.MethodPost, `{"runId":"run-missing","slug":"ok-slug"}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), "not_found")
}

func TestPostDeploymentsRejectsUnfinishedRun(t *testing.T) {
	h := newTestHandler()
	seedDeployRun(t, h.Store, "run-queued") // stays in status "queued"
	rec := doDeployments(h, http.MethodPost, `{"runId":"run-queued","slug":"ok-slug"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), "deploy_run_not_finished")
}

func TestPostDeploymentsRejectsRunWithoutArtifacts(t *testing.T) {
	h := newTestHandler()
	seedDeployRun(t, h.Store, "run-empty")
	if _, ok := h.Store.SetRunStatus("run-empty", "finished"); !ok {
		t.Fatal("SetRunStatus(finished) failed")
	}
	rec := doDeployments(h, http.MethodPost, `{"runId":"run-empty","slug":"ok-slug"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), "deploy_no_artifacts")
}

func TestPostDeploymentsDeploysArchiveOverStubbedSSH(t *testing.T) {
	stubDir := installDeploySSHStubs(t)
	t.Setenv(envDeployTargetHost, "stub-host")
	t.Setenv(envDeployTargetPath, "/srv/pages")
	t.Setenv(envPagesDomain, "pages.test.example")

	h := newTestHandler()
	seedDeployRun(t, h.Store, "run-ok")
	if _, ok := h.Store.SetRunStatus("run-ok", "finished"); !ok {
		t.Fatal("SetRunStatus(finished) failed")
	}
	seedDeployArtifact(t, h.Store, "run-ok", "art-index", "index.html")

	rec := doDeployments(h, http.MethodPost, `{"runId":"run-ok","slug":"my-slug"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var envelope struct {
		Data struct {
			RunID     string `json:"runId"`
			Slug      string `json:"slug"`
			URL       string `json:"url"`
			Status    string `json:"status"`
			Artifacts int    `json:"artifacts"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode success body: %v", err)
	}
	data := envelope.Data
	if data.RunID != "run-ok" || data.Slug != "my-slug" {
		t.Errorf("echo fields = %#v", data)
	}
	if data.URL != "https://my-slug.pages.test.example" {
		t.Errorf("url = %q, want https://my-slug.pages.test.example", data.URL)
	}
	if data.Status != "deployed" || data.Artifacts != 1 {
		t.Errorf("status/artifacts = %q/%d, want deployed/1", data.Status, data.Artifacts)
	}

	// The stub records the full remote chain: dir prep, upload, extract.
	calls := readDeployStubLog(t, stubDir)
	for _, want := range []string{
		"ssh\t-o\tConnectTimeout=5\t-o\tBatchMode=yes\t-o\tServerAliveInterval=5\t-o\tServerAliveCountMax=3\tstub-host\tsudo\tmkdir\t-p\t/srv/pages/my-slug",
		"scp\t-q\t",
		"stub-host:/srv/pages/my-slug/deploy.tar.gz",
		"ssh\t-o\tConnectTimeout=5\t-o\tBatchMode=yes\t-o\tServerAliveInterval=5\t-o\tServerAliveCountMax=3\tstub-host\tsudo\ttar\t-xzf\t/srv/pages/my-slug/deploy.tar.gz\t-C\t/srv/pages/my-slug",
	} {
		if !strings.Contains(calls, want) {
			t.Errorf("stub call log missing %q; log:\n%s", want, calls)
		}
	}
}

func TestPostDeploymentsReportsRemoteMkdirFailure(t *testing.T) {
	installDeploySSHStubs(t)
	t.Setenv(envDeployTargetHost, "stub-host")
	t.Setenv(deployStubEnvFail, "mkdir")

	h := newTestHandler()
	seedDeployRun(t, h.Store, "run-fail")
	if _, ok := h.Store.SetRunStatus("run-fail", "finished"); !ok {
		t.Fatal("SetRunStatus(finished) failed")
	}
	seedDeployArtifact(t, h.Store, "run-fail", "art-index", "index.html")

	rec := doDeployments(h, http.MethodPost, `{"runId":"run-fail","slug":"my-slug"}`)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
	var decoded struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode error body: %v", err)
	}
	if decoded.Error.Code != "internal_error" {
		t.Errorf("error code = %q, want internal_error", decoded.Error.Code)
	}
	if !strings.Contains(decoded.Error.Message, "failed to create remote directory") {
		t.Errorf("error message = %q, want remote directory failure context", decoded.Error.Message)
	}
}
