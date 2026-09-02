package api

import (
	"bytes"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/agenthub/edge-server/internal/store"
)

// TestDeployWorkspacePathConfinement pins the deploy path-confinement gate
// (#2154 security scan P2): content-source paths recorded from agent events
// must resolve inside the run workspace; absolute, dot-prefixed and
// escaping paths fail closed.
func TestDeployWorkspacePathConfinement(t *testing.T) {
	workDir := "/srv/runs/run-1"
	tests := []struct {
		name   string
		source string
		wantOK bool
	}{
		{"normal file", "dist/index.html", true},
		{"nested", "dist/assets/app.js", true},
		{"absolute rejected", "/etc/passwd", false},
		{"traversal rejected", "../secrets/key.pem", false},
		{"deep traversal rejected", "dist/../../.ssh/id_rsa", false},
		{"dotfile rejected", ".codex/auth.json", false},
		{"dot dir rejected", ".ssh/id_rsa", false},
		{"dot workspace rejected", ".", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := deployWorkspacePath(workDir, tc.source)
			if ok != tc.wantOK {
				t.Fatalf("deployWorkspacePath(%q) ok = %v, want %v", tc.source, ok, tc.wantOK)
			}
			if ok && got != filepath.Join(workDir, tc.source) {
				t.Fatalf("resolved = %q, want %q", got, filepath.Join(workDir, tc.source))
			}
		})
	}
	if _, ok := deployWorkspacePath("", "dist/index.html"); ok {
		t.Fatal("empty workDir must fail closed")
	}
}

// TestBuildArtifactArchiveConfinesToWorkspace proves the archive packages
// only regular files inside the run workspace: dotfiles, workspace-escaping
// traversal paths and symlinks (pointing at host files outside the
// workspace) must all be skipped.
func TestBuildArtifactArchiveConfinesToWorkspace(t *testing.T) {
	workDir := t.TempDir()
	outsideDir := t.TempDir()
	secretPath := filepath.Join(outsideDir, "secret.txt")
	if err := os.WriteFile(secretPath, []byte("host-secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workDir, "index.html"), []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workDir, ".env"), []byte("SECRET=1"), 0o600); err != nil {
		t.Fatal(err)
	}
	// Symlink creation needs privileges some CI platforms lack (Windows):
	// degrade to the non-symlink subset instead of failing.
	haveSymlink := true
	if err := os.Symlink(secretPath, filepath.Join(workDir, "link.txt")); err != nil {
		haveSymlink = false
	}

	mk := func(id, path string) store.Artifact {
		return store.Artifact{
			ID:            id,
			RunID:         "run-x",
			Kind:          "file",
			Path:          path,
			ContentSource: store.NewArtifactContentSource("", path),
		}
	}
	// Hostile content sources are constructed raw (bypassing the
	// persistence-time path validation) to prove the deploy-time gate holds
	// even if a malformed record slips through.
	mkRaw := func(id, path string) store.Artifact {
		return store.Artifact{
			ID:    id,
			RunID: "run-x",
			Kind:  "file",
			Path:  path,
			ContentSource: &store.ArtifactContentSource{
				Kind: "workspace_relative", Path: path, Readable: true,
			},
		}
	}
	artifacts := []store.Artifact{
		mk("a-legit", "index.html"),
		mkRaw("a-dot", ".env"),
		mkRaw("a-traversal", "../secret.txt"),
	}
	if haveSymlink {
		artifacts = append(artifacts, mkRaw("a-symlink", "link.txt"))
	}

	var buf bytes.Buffer
	if err := buildArtifactArchive(workDir, artifacts, &buf); err != nil {
		t.Fatalf("buildArtifactArchive: %v", err)
	}

	entries := readTarGz(t, buf.Bytes())
	if len(entries) != 1 {
		t.Fatalf("archive entries = %v, want exactly one [index.html]", entries)
	}
	if got, ok := entries["index.html"]; !ok {
		t.Fatalf("archive entries = %v, want exactly [index.html]", entries)
	} else if got != "ok" {
		t.Fatalf("index.html content = %q, want ok", got)
	}
}

// TestBuildArtifactArchiveIncludesWorkspaceDirs keeps the legitimate
// directory path working under confinement: a directory artifact packages
// its regular files (and skips symlinked entries inside).
func TestBuildArtifactArchiveIncludesWorkspaceDirs(t *testing.T) {
	workDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(workDir, "dist"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workDir, "dist", "app.js"), []byte("1"), 0o644); err != nil {
		t.Fatal(err)
	}
	outsideDir := t.TempDir()
	secretPath := filepath.Join(outsideDir, "secret.txt")
	if err := os.WriteFile(secretPath, []byte("host-secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(secretPath, filepath.Join(workDir, "dist", "evil.txt")); err != nil {
		// No symlink privilege on this platform (Windows CI): the walk then
		// only sees regular files, which is the same expected outcome.
		t.Logf("symlink creation not permitted, skipping symlink case: %v", err)
	}

	artifacts := []store.Artifact{{
		ID:            "a-dir",
		RunID:         "run-x",
		Kind:          "directory",
		Path:          "dist",
		ContentSource: store.NewArtifactContentSource("", "dist"),
	}}

	var buf bytes.Buffer
	if err := buildArtifactArchive(workDir, artifacts, &buf); err != nil {
		t.Fatalf("buildArtifactArchive: %v", err)
	}
	entries := readTarGz(t, buf.Bytes())
	if len(entries) != 1 {
		t.Fatalf("archive entries = %v, want exactly one [app.js]", entries)
	}
	if _, ok := entries["app.js"]; !ok {
		t.Fatalf("archive entries = %v, want exactly [app.js]", entries)
	}
}

// TestPostDeploymentsFailsClosedWithoutHubIdentity pins the ownership gate:
// under multi-user mode (Hub JWT secret configured), a request without an
// Hub identity must not be able to publish a run's artifacts.
func TestPostDeploymentsFailsClosedWithoutHubIdentity(t *testing.T) {
	installDeploySSHStubs(t)
	t.Setenv(envDeployTargetHost, "stub-host")

	h := newTestHandler()
	h.HubJWTSecret = "test-secret" // multi-user mode
	seedDeployRun(t, h.Store, "run-deploy")
	if _, ok := h.Store.SetRunStatus("run-deploy", "finished"); !ok {
		t.Fatal("SetRunStatus(finished) failed")
	}
	seedDeployArtifact(t, h.Store, "run-deploy", "art-index", "index.html")

	rec := doDeployments(h, http.MethodPost, `{"runId":"run-deploy","slug":"my-slug"}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (no Hub identity must not publish); body=%s", rec.Code, rec.Body.String())
	}
}
