package api

import "github.com/agenthub/edge-server/internal/security"

// Package-local wrappers over the shared security path helpers so REST handlers
// keep a stable internal call surface while MCP and REST share one SSOT (#998).

func normalizedRealPath(path string) (string, error) {
	return security.NormalizedRealPath(path)
}

func isPathWithin(root, path string) bool {
	return security.IsPathWithin(root, path)
}
