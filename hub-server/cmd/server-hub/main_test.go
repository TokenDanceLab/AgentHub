package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeWorkingDirectoryFromRepoRoot(t *testing.T) {
	root := t.TempDir()
	hubDir := filepath.Join(root, "hub-server")
	mustCreateFile(t, filepath.Join(hubDir, "configs", "config.yaml"))
	mustMkdir(t, filepath.Join(hubDir, "migrations"))

	t.Chdir(root)

	if err := normalizeWorkingDirectory(); err != nil {
		t.Fatalf("normalizeWorkingDirectory() error = %v", err)
	}

	cwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("os.Getwd() error = %v", err)
	}
	if cwd != hubDir {
		t.Fatalf("cwd = %q, want %q", cwd, hubDir)
	}
}

func TestNormalizeWorkingDirectoryFromHubServer(t *testing.T) {
	hubDir := t.TempDir()
	mustCreateFile(t, filepath.Join(hubDir, "configs", "config.yaml"))
	mustMkdir(t, filepath.Join(hubDir, "migrations"))

	t.Chdir(hubDir)

	if err := normalizeWorkingDirectory(); err != nil {
		t.Fatalf("normalizeWorkingDirectory() error = %v", err)
	}

	cwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("os.Getwd() error = %v", err)
	}
	if cwd != hubDir {
		t.Fatalf("cwd = %q, want %q", cwd, hubDir)
	}
}

func mustCreateFile(t *testing.T, path string) {
	t.Helper()
	mustMkdir(t, filepath.Dir(path))
	if err := os.WriteFile(path, []byte("test: true\n"), 0o600); err != nil {
		t.Fatalf("os.WriteFile(%q) error = %v", path, err)
	}
}

func mustMkdir(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o700); err != nil {
		t.Fatalf("os.MkdirAll(%q) error = %v", path, err)
	}
}
