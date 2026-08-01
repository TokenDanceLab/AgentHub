package adapters

import (
	"path/filepath"
	"strings"
)

// Residual pure-helper peel #1112: file classification for auto-surfacing.

// Directories to skip when walking the workdir.
var skipDirs = map[string]bool{
	".git": true, "node_modules": true, "__pycache__": true,
	".venv": true, "venv": true, ".next": true, "dist": true,
	"build": true, "target": true, ".idea": true, ".vscode": true,
	".cache": true, ".tox": true, "vendor": true,
	".fingerprint": true, ".cargo": true,
}

// ── File type classification ─────────────────────────────────────────────

type surfacingKind string

const (
	surfacingKindPreview  surfacingKind = "preview"
	surfacingKindArtifact surfacingKind = "artifact"
	surfacingKindImage    surfacingKind = "image"
	surfacingKindDeploy   surfacingKind = "deploy"
)

func classifySurfacedFile(relPath string) surfacingKind {
	ext := strings.ToLower(filepath.Ext(relPath))
	switch ext {
	case ".html", ".htm":
		return surfacingKindPreview
	case ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico", ".avif":
		return surfacingKindImage
	case ".dockerfile":
		return surfacingKindDeploy
	}

	// Detect deployable patterns by filename.
	base := strings.ToLower(filepath.Base(relPath))
	switch base {
	case "dockerfile", "docker-compose.yml", "docker-compose.yaml",
		"vercel.json", "netlify.toml", "fly.toml", "railway.json",
		"render.yaml", "heroku.yml", "docker-compose.override.yml":
		return surfacingKindDeploy
	}

	// Everything else is an artifact.
	return surfacingKindArtifact
}

func isTextFilePath(relPath string) bool {
	ext := strings.ToLower(filepath.Ext(relPath))
	switch ext {
	case ".md", ".txt", ".py", ".go", ".ts", ".js", ".tsx", ".jsx",
		".json", ".yaml", ".yml", ".toml", ".css", ".scss", ".less",
		".rs", ".java", ".c", ".cpp", ".h", ".hpp", ".rb", ".php",
		".swift", ".kt", ".vue", ".svelte", ".astro", ".sql",
		".xml", ".html", ".htm", ".svg", ".r", ".sh", ".bash",
		".zsh", ".fish", ".ps1", ".bat", ".ini", ".cfg", ".conf",
		".env", ".properties", ".gradle", ".mod", ".sum",
		".dockerfile", ".gitignore", ".editorconfig", ".lock",
		".proto", ".graphql", ".tf", ".hcl", ".dart", ".lua",
		".zig", ".nim", ".ex", ".exs", ".erl", ".hs", ".ml",
		".clj", ".lisp", ".el", ".vim", ".tmux", ".makefile":
		return true
	}
	base := strings.ToLower(filepath.Base(relPath))
	switch base {
	case "makefile", "dockerfile", "vagrantfile", "gemfile",
		"rakefile", "procfile", "jenkinsfile", "brewfile",
		".gitignore", ".env", ".editorconfig":
		return true
	}
	return false
}

// isBinaryArtifact returns true for file types that should NOT be surfaced
// as agent output artifacts. These are typically compiled binaries, object
// files, database files, and other non-human-readable artifacts that the
// agent did not intentionally produce as deliverables.
func isBinaryArtifact(relPath string) bool {
	ext := strings.ToLower(filepath.Ext(relPath))
	switch ext {
	// Compiled executables and object code
	case ".exe", ".dll", ".so", ".dylib", ".o", ".obj", ".a", ".lib",
		".bin", ".out",
		// Rust build artifacts
		".pdb", ".rlib", ".rmeta", ".d", ".pdb.gz",
		// Go build artifacts
		".test":
		return true
	// Database files
	case ".db", ".sqlite", ".sqlite3", ".mdb":
		return true
	// Archive and compressed files (usually build artifacts)
	case ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar", ".zst":
		return true
	// Disk images and firmware
	case ".img", ".iso", ".dmg":
		return true
	}

	// Backup files (e.g. agenthub-edge.exe~, file.bak)
	base := filepath.Base(relPath)
	if strings.HasSuffix(base, "~") || strings.HasSuffix(base, ".bak") {
		return true
	}

	// WAL/SHM companion database files
	if strings.HasSuffix(base, "-wal") || strings.HasSuffix(base, "-shm") ||
		strings.HasSuffix(base, "-journal") {
		return true
	}

	return false
}

func classifyDeployType(path string) string {
	base := strings.ToLower(filepath.Base(path))
	ext := strings.ToLower(filepath.Ext(path))
	switch {
	case base == "dockerfile" || ext == ".dockerfile":
		return "container"
	case strings.Contains(base, "docker-compose"):
		return "compose"
	case base == "vercel.json":
		return "vercel"
	case base == "netlify.toml":
		return "netlify"
	case base == "fly.toml":
		return "fly"
	default:
		return "static"
	}
}

func mimeTypeFromExt(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".svg":
		return "image/svg+xml"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	case ".ico":
		return "image/x-icon"
	case ".avif":
		return "image/avif"
	default:
		return "application/octet-stream"
	}
}

// extLanguageMap maps file extensions to display languages for surfaced
// artifacts. Keys are lower-case; lookups are normalized in languageFromExt.
var extLanguageMap = map[string]string{
	".py":         "python",
	".go":         "go",
	".ts":         "typescript",
	".tsx":        "typescript",
	".js":         "javascript",
	".jsx":        "javascript",
	".rs":         "rust",
	".java":       "java",
	".c":          "c",
	".cpp":        "cpp",
	".rb":         "ruby",
	".php":        "php",
	".swift":      "swift",
	".kt":         "kotlin",
	".css":        "css",
	".scss":       "scss",
	".html":       "html",
	".htm":        "html",
	".xml":        "xml",
	".json":       "json",
	".yaml":       "yaml",
	".yml":        "yaml",
	".toml":       "toml",
	".md":         "markdown",
	".sql":        "sql",
	".sh":         "bash",
	".bash":       "bash",
	".dockerfile": "dockerfile",
}

func languageFromExt(path string) string {
	return extLanguageMap[strings.ToLower(filepath.Ext(path))]
}
