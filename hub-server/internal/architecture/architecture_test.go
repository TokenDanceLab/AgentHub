package architecture

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

var purePackageDirs = []string{
	"internal/service/dispatch",
	"internal/service/deliveryoutbox",
	"internal/service/im",
	"internal/service/agentevent",
}

var purePackageFiles = []string{
	"internal/service/agentteam/route_helpers.go",
}

var purePackageImportAllowlist = []string{
	"github.com/agenthub/hub-server/internal/service/dispatch",
	"github.com/agenthub/hub-server/internal/service/deliveryoutbox",
	"github.com/agenthub/hub-server/internal/service/im",
	"github.com/agenthub/hub-server/internal/service/agentevent",
}

var forbiddenPurePackageImports = []string{
	"gorm.io/",
	"database/sql",
	"github.com/agenthub/hub-server/internal/cache",
	"github.com/agenthub/hub-server/internal/ws",
	"github.com/agenthub/hub-server/internal/service",
}

func hubRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate architecture test source")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", ".."))
}

func goFiles(t *testing.T, directory string) []string {
	t.Helper()
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatalf("read %s: %v", directory, err)
	}
	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".go") {
			files = append(files, filepath.Join(directory, entry.Name()))
		}
	}
	return files
}

func imports(t *testing.T, file string) []string {
	t.Helper()
	parsed, err := parser.ParseFile(token.NewFileSet(), file, nil, parser.ImportsOnly)
	if err != nil {
		t.Fatalf("parse imports in %s: %v", file, err)
	}
	paths := make([]string, 0, len(parsed.Imports))
	for _, spec := range parsed.Imports {
		path, err := strconv.Unquote(spec.Path.Value)
		if err != nil {
			t.Fatalf("unquote import in %s: %v", file, err)
		}
		paths = append(paths, path)
	}
	return paths
}

func TestPurePackagesStayImportClean(t *testing.T) {
	root := hubRoot(t)
	files := make([]string, 0, len(purePackageDirs)+len(purePackageFiles))
	for _, directory := range purePackageDirs {
		files = append(files, goFiles(t, filepath.Join(root, filepath.FromSlash(directory)))...)
	}
	for _, file := range purePackageFiles {
		files = append(files, filepath.Join(root, filepath.FromSlash(file)))
	}
	if len(files) == 0 {
		t.Fatal("no pure package source files found")
	}

	for _, file := range files {
		for _, imported := range imports(t, file) {
			if allowedPureImport(imported) {
				continue
			}
			for _, forbidden := range forbiddenPurePackageImports {
				if importMatches(imported, forbidden) {
					t.Errorf("%s imports %s", file, imported)
				}
			}
		}
	}
}

func allowedPureImport(imported string) bool {
	for _, prefix := range purePackageImportAllowlist {
		if imported == prefix || strings.HasPrefix(imported, prefix+"/") {
			return true
		}
	}
	return false
}

func importMatches(imported, forbidden string) bool {
	if strings.HasSuffix(forbidden, "/") {
		return strings.HasPrefix(imported, forbidden)
	}
	return imported == forbidden || strings.HasPrefix(imported, forbidden+"/")
}

func TestHandlersDoNotImportRepositories(t *testing.T) {
	dir := filepath.Join(hubRoot(t), "internal", "handler")
	files := goFiles(t, dir)
	if len(files) == 0 {
		t.Fatal("no handler source files found")
	}

	for _, file := range files {
		for _, imported := range imports(t, file) {
			if imported != "github.com/agenthub/hub-server/internal/repository" &&
				!strings.HasPrefix(imported, "github.com/agenthub/hub-server/internal/repository/") {
				continue
			}
			if filepath.Base(file) == "health.go" {
				continue
			}
			t.Errorf("%s imports repository layer; handlers must go through services", file)
		}
	}
}
