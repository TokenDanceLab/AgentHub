package api

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/agenthub/edge-server/internal/store"
)

// readTarGz decodes a tar.gz byte stream into a map of entry name -> content.
// This also proves the gzip + tar layering (gzip.NewReader must succeed,
// tar.NewReader must walk real headers).
func readTarGz(t *testing.T, data []byte) map[string]string {
	t.Helper()
	gz, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("gzip.NewReader: %v", err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	entries := map[string]string{}
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("tar read: %v", err)
		}
		content, err := io.ReadAll(tr)
		if err != nil {
			t.Fatalf("tar entry %q read: %v", hdr.Name, err)
		}
		entries[hdr.Name] = string(content)
	}
	return entries
}

// ---------------------------------------------------------------------------
// buildArtifactArchive
// ---------------------------------------------------------------------------

func TestBuildArtifactArchive_PlaceholderNilContentSource(t *testing.T) {
	artifacts := []store.Artifact{
		{ID: "art-1", Path: "/workspace/out/index.html"},
	}
	var buf bytes.Buffer
	if err := buildArtifactArchive("", artifacts, &buf); err != nil {
		t.Fatalf("buildArtifactArchive: %v", err)
	}
	entries := readTarGz(t, buf.Bytes())
	if len(entries) != 1 {
		t.Fatalf("got %d entries, want 1: %v", len(entries), entries)
	}
	if entries["index.html"] != "" {
		t.Errorf("placeholder entry content = %q, want empty", entries["index.html"])
	}
	// entry name is the basename of artifact.Path, not the full path.
	if _, ok := entries["/workspace/out/index.html"]; ok {
		t.Error("entry uses full artifact path, want basename")
	}
}

func TestBuildArtifactArchive_PlaceholderNotReadable(t *testing.T) {
	artifacts := []store.Artifact{{
		ID:   "art-2",
		Path: "/workspace/out/app.js",
		ContentSource: &store.ArtifactContentSource{
			Kind: "workspace_relative", Path: "/workspace/out/app.js", Readable: false,
		},
	}}
	var buf bytes.Buffer
	if err := buildArtifactArchive("", artifacts, &buf); err != nil {
		t.Fatalf("buildArtifactArchive: %v", err)
	}
	entries := readTarGz(t, buf.Bytes())
	if _, ok := entries["app.js"]; !ok {
		t.Errorf("missing placeholder entry app.js, got %v", entries)
	}
	if entries["app.js"] != "" {
		t.Errorf("placeholder entry content = %q, want empty", entries["app.js"])
	}
}

func TestBuildArtifactArchive_PlaceholderEmptyPathUsesID(t *testing.T) {
	artifacts := []store.Artifact{{ID: "art-empty"}}
	var buf bytes.Buffer
	if err := buildArtifactArchive("", artifacts, &buf); err != nil {
		t.Fatalf("buildArtifactArchive: %v", err)
	}
	entries := readTarGz(t, buf.Bytes())
	if _, ok := entries["art-empty"]; !ok {
		t.Errorf("missing placeholder entry art-empty, got %v", entries)
	}
}

func TestBuildArtifactArchive_RealFile(t *testing.T) {
	dir := t.TempDir()
	content := "hello deploy\nline2\n"
	path := filepath.Join(dir, "page.html")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	artifacts := []store.Artifact{{
		ID:   "art-3",
		Path: "page.html",
		ContentSource: &store.ArtifactContentSource{
			Kind: "workspace_relative", Path: "page.html", Readable: true,
		},
	}}
	var buf bytes.Buffer
	if err := buildArtifactArchive(dir, artifacts, &buf); err != nil {
		t.Fatalf("buildArtifactArchive: %v", err)
	}
	entries := readTarGz(t, buf.Bytes())
	if entries["page.html"] != content {
		t.Errorf("entry page.html content = %q, want %q", entries["page.html"], content)
	}
}

func TestBuildArtifactArchive_DirectoryWalk(t *testing.T) {
	dir := t.TempDir()
	mustMkdirAll := func(p string) {
		t.Helper()
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", p, err)
		}
	}
	mustMkdirAll(filepath.Join(dir, "dist", "sub", "nested"))
	for rel, content := range map[string]string{
		"index.html":          "<h1>hi</h1>",
		"sub/app.js":          "console.log(1)",
		"sub/nested/deep.txt": "deep",
	} {
		p := filepath.Join(dir, "dist", filepath.FromSlash(rel))
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatalf("write %s: %v", rel, err)
		}
	}
	artifacts := []store.Artifact{{
		ID:   "art-4",
		Path: "dist",
		ContentSource: &store.ArtifactContentSource{
			Kind: "workspace_relative", Path: "dist", Readable: true,
		},
	}}
	var buf bytes.Buffer
	if err := buildArtifactArchive(dir, artifacts, &buf); err != nil {
		t.Fatalf("buildArtifactArchive: %v", err)
	}
	entries := readTarGz(t, buf.Bytes())
	for name, want := range map[string]string{
		"index.html":          "<h1>hi</h1>",
		"sub/app.js":          "console.log(1)",
		"sub/nested/deep.txt": "deep",
	} {
		if entries[name] != want {
			t.Errorf("entry %q content = %q, want %q", name, entries[name], want)
		}
	}
	// All entry names must use forward slashes (Windows-safe tar names).
	for name := range entries {
		if strings.ContainsRune(name, '\\') {
			t.Errorf("entry name %q contains backslash, want forward slashes", name)
		}
	}
}

func TestBuildArtifactArchive_MissingSourceFileSkipped(t *testing.T) {
	dir := t.TempDir()
	artifacts := []store.Artifact{{
		ID:   "art-5",
		Path: "nope.txt",
		ContentSource: &store.ArtifactContentSource{
			Kind: "workspace_relative", Path: "nope.txt", Readable: true,
		},
	}}
	var buf bytes.Buffer
	if err := buildArtifactArchive(dir, artifacts, &buf); err != nil {
		t.Fatalf("buildArtifactArchive: %v", err)
	}
	entries := readTarGz(t, buf.Bytes())
	if len(entries) != 0 {
		t.Errorf("got %d entries, want 0 (missing source file skipped): %v", len(entries), entries)
	}
}

func TestBuildArtifactArchive_EmptySourcePathSkipped(t *testing.T) {
	artifacts := []store.Artifact{{
		ID:   "art-6",
		Path: "x.txt",
		ContentSource: &store.ArtifactContentSource{
			Kind: "workspace_relative", Readable: true, // Path empty
		},
	}}
	var buf bytes.Buffer
	if err := buildArtifactArchive("", artifacts, &buf); err != nil {
		t.Fatalf("buildArtifactArchive: %v", err)
	}
	entries := readTarGz(t, buf.Bytes())
	if len(entries) != 0 {
		t.Errorf("got %d entries, want 0 (empty source path skipped): %v", len(entries), entries)
	}
}

func TestBuildArtifactArchive_OutputIsGzip(t *testing.T) {
	artifacts := []store.Artifact{{ID: "art-7", Path: "/out/a.txt"}}
	var buf bytes.Buffer
	if err := buildArtifactArchive("", artifacts, &buf); err != nil {
		t.Fatalf("buildArtifactArchive: %v", err)
	}
	data := buf.Bytes()
	if len(data) < 2 || data[0] != 0x1f || data[1] != 0x8b {
		t.Errorf("archive does not start with gzip magic bytes (got % x)", data[:2])
	}
}

// ---------------------------------------------------------------------------
// addDirToArchive
// ---------------------------------------------------------------------------

func TestAddDirToArchive_NestedFiles(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "assets", "css"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	for rel, content := range map[string]string{
		"assets/css/style.css": "body{}",
		"assets/logo.svg":      "<svg/>",
		"readme.md":            "# docs",
	} {
		p := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatalf("write %s: %v", rel, err)
		}
	}
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gw)
	if err := addDirToArchive(tw, dir); err != nil {
		t.Fatalf("addDirToArchive: %v", err)
	}
	if err := tw.Close(); err != nil {
		t.Fatalf("tar close: %v", err)
	}
	if err := gw.Close(); err != nil {
		t.Fatalf("gzip close: %v", err)
	}
	entries := readTarGz(t, buf.Bytes())
	for name, want := range map[string]string{
		"assets/css/style.css": "body{}",
		"assets/logo.svg":      "<svg/>",
		"readme.md":            "# docs",
	} {
		if entries[name] != want {
			t.Errorf("entry %q content = %q, want %q", name, entries[name], want)
		}
	}
	for name := range entries {
		if strings.ContainsRune(name, '\\') {
			t.Errorf("entry name %q contains backslash, want forward slashes", name)
		}
	}
}

func TestAddDirToArchive_MissingDirReturnsNil(t *testing.T) {
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gw)
	err := addDirToArchive(tw, filepath.Join(t.TempDir(), "does-not-exist"))
	if err != nil {
		t.Errorf("addDirToArchive on missing dir = %v, want nil (walk errors swallowed)", err)
	}
	// Closing should succeed even though nothing was written.
	if cerr := tw.Close(); cerr != nil {
		t.Errorf("tar close: %v", cerr)
	}
	gw.Close()
}

// ---------------------------------------------------------------------------
// createBackup
// ---------------------------------------------------------------------------

func TestCreateBackup_CreatesBakWithContent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "file.go")
	content := []byte("package main\n")
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	if err := createBackup(dir, path, content); err != nil {
		t.Fatalf("createBackup: %v", err)
	}
	got, err := os.ReadFile(path + ".bak")
	if err != nil {
		t.Fatalf("read backup: %v", err)
	}
	if string(got) != string(content) {
		t.Errorf("backup content = %q, want %q", got, content)
	}
}

func TestCreateBackup_DoesNotOverwriteExisting(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "file.go")
	original := []byte("package main\n")
	if err := os.WriteFile(path, original, 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	backupContent := []byte("old backup content")
	if err := os.WriteFile(path+".bak", backupContent, 0o644); err != nil {
		t.Fatalf("write backup fixture: %v", err)
	}
	if err := createBackup(dir, path, original); err != nil {
		t.Fatalf("createBackup: %v", err)
	}
	got, err := os.ReadFile(path + ".bak")
	if err != nil {
		t.Fatalf("read backup: %v", err)
	}
	if string(got) != string(backupContent) {
		t.Errorf("existing backup was overwritten: got %q, want %q", got, backupContent)
	}
}
