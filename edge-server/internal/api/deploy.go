package api

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/security"
	"github.com/agenthub/edge-server/internal/store"
)

// slugPattern enforces DNS-safe subdomain names for *.example.agenthub.dev.
var slugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$`)

// Deployment configuration. These can be overridden via environment variables.
const (
	defaultDeployTargetHost = "remote-edge"
	defaultDeployTargetPath = "/opt/agenthub-pages"
	defaultPagesDomain      = "example.agenthub.dev"
	envDeployTargetHost     = "AGENTHUB_DEPLOY_HOST"
	envDeployTargetPath     = "AGENTHUB_DEPLOY_PATH"
	envPagesDomain          = "AGENTHUB_PAGES_DOMAIN"
)

// DeployTargetHost returns the SSH target host for deployments.
func DeployTargetHost() string {
	if v := os.Getenv(envDeployTargetHost); v != "" {
		return v
	}
	return defaultDeployTargetHost
}

// DeployTargetPath returns the remote base directory for deployments.
func DeployTargetPath() string {
	if v := os.Getenv(envDeployTargetPath); v != "" {
		return v
	}
	return defaultDeployTargetPath
}

// PagesDomain returns the domain used for generated deployment URLs.
func PagesDomain() string {
	if v := os.Getenv(envPagesDomain); v != "" {
		return v
	}
	return defaultPagesDomain
}

// validateSlug checks that a slug is DNS-safe for use as a subdomain.
func validateSlug(slug string) error {
	slug = strings.TrimSpace(slug)
	if slug == "" {
		return fmt.Errorf("slug is required")
	}
	if !slugPattern.MatchString(slug) {
		return fmt.Errorf("slug must be lowercase alphanumeric with hyphens, 2-63 chars")
	}
	return nil
}

// PostDeployments handles POST /v1/deployments.
// It takes a runId and slug, collects the run's artifacts, tars them,
// and SCPs the result to the configured deployment target.
func (h *Handler) PostDeployments(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errcode.ErrorBody(errcode.ErrMethodNotAllowed))
		return
	}

	var req struct {
		RunID string `json:"runId"`
		Slug  string `json:"slug"`
	}
	if err := decodeOptionalJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrInvalidJSON))
		return
	}
	req.RunID = strings.TrimSpace(req.RunID)
	req.Slug = strings.TrimSpace(req.Slug)

	if req.RunID == "" {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrRunIDRequired))
		return
	}
	if err := validateSlug(req.Slug); err != nil {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrDeployInvalidSlug.WithMessage(err.Error())))
		return
	}

	repository := ensureStore(h)

	// Verify run exists and is in a terminal state.
	run, ok := repository.GetRun(req.RunID)
	if !ok {
		writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound.WithMessage("run not found")))
		return
	}
	if !isTerminalRunStatus(run.Status) {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrDeployRunNotFinished))
		return
	}

	// Ownership gate (multi-user Hub JWT mode): publishing packages files
	// from the run workspace onto a public URL, so a foreign run must fail
	// closed. 404 (not 403) to avoid leaking run existence; local
	// single-tenant mode passes via the documented ownership bypass.
	if !isRunOwnedBy(repository, req.RunID, h.ownerUserID(r)) {
		writeJSON(w, http.StatusNotFound, errcode.ErrorBody(errcode.ErrNotFound.WithMessage("run not found")))
		return
	}

	// Collect artifacts for this run.
	artifacts := repository.ListArtifacts(req.RunID)
	if len(artifacts) == 0 {
		writeJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrDeployNoArtifacts))
		return
	}

	// Build a tar archive from the artifact content sources.
	// We collect files from the workspace that match artifact paths.
	tmpFile, err := os.CreateTemp("", "agenthub-deploy-*.tar.gz")
	if err != nil {
		slog.Error("deploy: failed to create temp file", "error", err)
		writeJSON(w, http.StatusInternalServerError, errcode.ErrorBody(errcode.ErrInternal.WithMessage("failed to create temp archive")))
		return
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)

	if err := buildArtifactArchive(run.WorkDir, artifacts, tmpFile); err != nil {
		slog.Error("deploy: failed to build archive", "error", err)
		writeJSON(w, http.StatusInternalServerError, errcode.ErrorBody(errcode.ErrInternal.WithMessage("failed to build archive: "+err.Error())))
		return
	}
	_ = tmpFile.Close()

	// SCP the archive to the remote host.
	remotePath := DeployTargetPath() + "/" + req.Slug
	targetHost := DeployTargetHost()

	// Ensure remote directory exists and is clean.
	if err := runSSHCommand(targetHost, "sudo", "mkdir", "-p", remotePath); err != nil {
		slog.Error("deploy: failed to create remote dir", "error", err, "host", targetHost, "path", remotePath)
		writeJSON(w, http.StatusInternalServerError, errcode.ErrorBody(errcode.ErrInternal.WithMessage("failed to create remote directory")))
		return
	}

	// Clear previous deployment content.
	if err := runSSHCommand(targetHost, "sudo", "rm", "-rf", remotePath+"/*"); err != nil {
		slog.Warn("deploy: failed to clear previous deployment", "error", err)
	}

	// SCP the tar.gz to a temp location on the remote.
	remoteTmp := remotePath + "/deploy.tar.gz"
	if err := runSCP(tmpPath, targetHost+":"+remoteTmp); err != nil {
		slog.Error("deploy: scp failed", "error", err, "host", targetHost)
		writeJSON(w, http.StatusInternalServerError, errcode.ErrorBody(errcode.ErrInternal.WithMessage("failed to transfer archive")))
		return
	}

	// Extract on remote and clean up tar.
	// Use separate SSH invocations instead of bash -c to avoid shell injection risk.
	if err := runSSHCommand(targetHost, "sudo", "tar", "-xzf", remoteTmp, "-C", remotePath); err != nil {
		slog.Error("deploy: remote extract failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, errcode.ErrorBody(errcode.ErrInternal.WithMessage("failed to extract on remote")))
		return
	}
	if err := runSSHCommand(targetHost, "sudo", "rm", "-f", remoteTmp); err != nil {
		slog.Warn("deploy: failed to remove remote temp archive", "error", err, "path", remoteTmp)
	}
	if err := runSSHCommand(targetHost, "sudo", "chown", "-R", "www-data:www-data", remotePath); err != nil {
		slog.Warn("deploy: failed to chown deployed files", "error", err, "path", remotePath)
	}

	url := fmt.Sprintf("https://%s.%s", req.Slug, PagesDomain())
	slog.Info("deploy: success", "runId", req.RunID, "slug", req.Slug, "url", url)

	writeSuccess(w, http.StatusOK, map[string]any{
		"runId":     req.RunID,
		"slug":      req.Slug,
		"url":       url,
		"status":    "deployed",
		"artifacts": len(artifacts),
	})
}

// buildArtifactArchive creates a tar.gz archive from the artifacts' content source paths.
// For artifacts with workspace_relative content sources, it reads the actual files from
// the run workspace (confined to workDir). For others, it creates placeholder entries.
func buildArtifactArchive(workDir string, artifacts []store.Artifact, w io.Writer) error {
	gw := gzip.NewWriter(w)
	defer gw.Close()
	tw := tar.NewWriter(gw)
	defer tw.Close()

	for _, artifact := range artifacts {
		if artifact.ContentSource == nil || !artifact.ContentSource.Readable {
			// Create a placeholder file entry.
			name := artifact.Path
			if name == "" {
				name = artifact.ID
			}
			hdr := &tar.Header{
				Name: filepath.Base(name),
				Mode: 0644,
				Size: 0,
			}
			if err := tw.WriteHeader(hdr); err != nil {
				return fmt.Errorf("write header for %s: %w", name, err)
			}
			continue
		}

		// Read the file from the content source path, confined to the run
		// workspace: content sources are workspace-relative paths recorded from
		// agent events; resolving them against the process CWD would let a
		// hostile path (".codex/auth.json") package arbitrary host files into
		// the public deployment.
		sourcePath := artifact.ContentSource.Path
		if sourcePath == "" {
			continue
		}
		resolved, ok := deployWorkspacePath(workDir, sourcePath)
		if !ok {
			slog.Warn("deploy: skipping artifact outside run workspace", "path", sourcePath)
			continue
		}
		info, err := os.Lstat(resolved)
		if err != nil {
			slog.Warn("deploy: skipping artifact (missing)", "path", sourcePath, "error", err)
			continue
		}
		if info.IsDir() {
			// Walk and add all regular files; the walk skips symlinks.
			if err := addDirToArchive(tw, resolved); err != nil {
				slog.Warn("deploy: failed to add directory", "path", sourcePath, "error", err)
			}
			continue
		}
		if !info.Mode().IsRegular() {
			// Regular files only: a symlink would pull its target's content
			// (potentially outside the workspace) into the public archive.
			slog.Warn("deploy: skipping artifact file (not a regular file)", "path", sourcePath)
			continue
		}

		// #nosec G304 -- resolved is confined to the run workspace by
		// deployWorkspacePath before the open.
		f, err := os.Open(resolved)
		if err != nil {
			slog.Warn("deploy: skipping artifact file (not readable)", "path", sourcePath, "error", err)
			continue
		}

		hdr := &tar.Header{
			Name: filepath.Base(resolved),
			Mode: 0644,
			Size: info.Size(),
		}
		if err := tw.WriteHeader(hdr); err != nil {
			_ = f.Close()
			return fmt.Errorf("write header: %w", err)
		}
		if _, err := io.Copy(tw, f); err != nil {
			_ = f.Close()
			return fmt.Errorf("copy file content: %w", err)
		}
		_ = f.Close()
	}
	return nil
}

// deployWorkspacePath resolves an artifact content-source path against the
// run workspace and fails closed unless the result stays inside it. Absolute
// paths, dot-prefixed top-level entries (hidden config is never legitimate
// pages content) and anything escaping workDir are rejected.
func deployWorkspacePath(workDir, sourcePath string) (string, bool) {
	// Reject absolute paths on every platform: filepath.IsAbs is false for
	// Unix-style "/etc/passwd" on Windows, so the separator prefix is
	// checked explicitly.
	if workDir == "" || filepath.IsAbs(sourcePath) || strings.HasPrefix(sourcePath, "/") || strings.HasPrefix(sourcePath, "\\") {
		return "", false
	}
	if first, _, _ := strings.Cut(sourcePath, string(filepath.Separator)); strings.HasPrefix(first, ".") {
		return "", false
	}
	resolved := filepath.Join(workDir, sourcePath)
	if !security.IsPathWithin(workDir, resolved) {
		return "", false
	}
	return resolved, true
}

// addDirToArchive recursively adds all files in a directory to the tar archive.
func addDirToArchive(tw *tar.Writer, dirPath string) error {
	// #nosec G122,G304 -- walk reads the user's own workspace artifact dir for
	// deploy packaging; path originates from edge-recorded run content sources.
	return filepath.Walk(dirPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // skip errors
		}
		// Regular files only: Walk uses Lstat, so a symlink entry would
		// otherwise package its target's content (possibly outside the
		// workspace) into the public archive.
		if !info.Mode().IsRegular() {
			return nil
		}
		rel, err := filepath.Rel(dirPath, path)
		if err != nil {
			return nil
		}
		// Normalize to forward slashes.
		rel = strings.ReplaceAll(rel, "\\", "/")

		f, err := os.Open(path)
		if err != nil {
			return nil
		}
		defer f.Close()

		hdr := &tar.Header{
			Name: rel,
			Mode: 0644,
			Size: info.Size(),
		}
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		_, err = io.Copy(tw, f)
		return err
	})
}

// Deploy subprocess timeouts: the REST timeout middleware answers the client
// (503) but cannot kill child processes, so unbounded ssh/scp against an
// unreachable host (no RST) would leak the subprocess and handler goroutine
// until the kernel TCP retransmission cap. Vars so tests can shrink them.
var (
	deploySSHTimeout = 30 * time.Second
	deploySCPTimeout = 120 * time.Second
)

// sshHardeningFlags make ssh/scp fail promptly instead of hanging: no
// interactive prompts, bounded connect, and liveness probes that kill a
// half-dead connection (peer vanished without RST).
var sshHardeningFlags = []string{
	"-o", "ConnectTimeout=5",
	"-o", "BatchMode=yes",
	"-o", "ServerAliveInterval=5",
	"-o", "ServerAliveCountMax=3",
}

// runSSHCommand executes a command on a remote host via SSH under
// deploySSHTimeout.
// #nosec G204 -- deploy feature launches ssh to an operator-configured host
func runSSHCommand(host string, args ...string) error {
	sshArgs := make([]string, 0, len(sshHardeningFlags)+1+len(args))
	sshArgs = append(sshArgs, sshHardeningFlags...)
	sshArgs = append(sshArgs, host)
	sshArgs = append(sshArgs, args...)
	return runDeployCmd(deploySSHTimeout, "ssh", sshArgs...)
}

// runSCP copies a local file to a remote host via SCP under
// deploySCPTimeout (transfers dominate, so the cap is wider).
// #nosec G204 -- deploy feature launches scp to an operator-configured host
func runSCP(localPath, remoteDest string) error {
	scpArgs := make([]string, 0, len(sshHardeningFlags)+3)
	scpArgs = append(scpArgs, "-q")
	scpArgs = append(scpArgs, sshHardeningFlags...)
	scpArgs = append(scpArgs, localPath, remoteDest)
	return runDeployCmd(deploySCPTimeout, "scp", scpArgs...)
}

// runDeployCmd runs a deploy subprocess with a hard context timeout so a
// stalled target cannot hang the handler past the cap.
func runDeployCmd(timeout time.Duration, name string, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	// #nosec G204 -- only invoked with the fixed binaries "ssh"/"scp" from
	// runSSHCommand/runSCP; argv is constructed separately from data.
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Run(); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return fmt.Errorf("%s timed out after %s: %w", name, timeout, err)
		}
		return err
	}
	return nil
}
