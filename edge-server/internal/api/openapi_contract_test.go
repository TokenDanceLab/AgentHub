package api

import (
	"os"
	"path/filepath"
	"testing"

	"go.yaml.in/yaml/v2"
)

type openAPISpec struct {
	Paths map[string]openAPIPathItem `yaml:"paths"`
}

type openAPIPathItem struct {
	Get    openAPIOperation `yaml:"get"`
	Post   openAPIOperation `yaml:"post"`
	Patch  openAPIOperation `yaml:"patch"`
	Delete openAPIOperation `yaml:"delete"`
}

type openAPIOperation struct {
	OperationID string `yaml:"operationId"`
	Status      string `yaml:"x-agenthub-status"`
}

func TestOpenAPIEdgeRouteStatuses(t *testing.T) {
	spec := loadEdgeOpenAPISpec(t)

	cases := []struct {
		path   string
		method string
		status string
	}{
		{"/v1/health", "get", "implemented"},
		{"/v1/model-catalog", "get", "implemented"},
		{"/v1/runners", "get", "implemented"},
		{"/v1/threads/{threadId}", "delete", "implemented"},
		{"/v1/threads/{threadId}:archive", "post", "implemented"},
		{"/v1/runs", "post", "implemented"},
		{"/v1/runs/{runId}", "get", "implemented"},
		{"/v1/runs/{runId}:cancel", "post", "implemented"},
		{"/v1/agent-instances", "get", "implemented"},
		{"/v1/agent-instances", "post", "planned"},
		{"/v1/agent-instances/{id}", "get", "implemented"},
		{"/v1/permissions/decide", "post", "implemented"},
		{"/v1/projects/{projectId}", "patch", "planned"},
		{"/v1/projects/{projectId}", "delete", "planned"},
		{"/v1/projects/{projectId}/memory", "get", "planned"},
		{"/v1/runners/{runnerId}", "get", "planned"},
		{"/v1/runners/{runnerId}:ping", "post", "planned"},
		{"/v1/runs/{runId}/items", "get", "planned"},
		{"/v1/runs/{runId}/logs", "get", "planned"},
		{"/v1/runs/{runId}/diff", "get", "planned"},
		{"/v1/approvals", "get", "planned"},
		{"/v1/approvals/{approvalId}:decide", "post", "planned"},
		{"/v1/artifacts", "get", "planned"},
		{"/v1/artifacts/{artifactId}:apply", "post", "planned"},
		{"/v1/previews", "post", "planned"},
		{"/v1/workspaces/{workspaceId}/files:read", "post", "planned"},
	}

	for _, tc := range cases {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			operation := openAPIOperationFor(t, spec, tc.path, tc.method)
			if operation.Status != tc.status {
				t.Fatalf("%s %s status = %q, want %q", tc.method, tc.path, operation.Status, tc.status)
			}
		})
	}
}

func loadEdgeOpenAPISpec(t *testing.T) openAPISpec {
	t.Helper()
	raw, err := os.ReadFile(filepath.FromSlash("../../../api/openapi.yaml"))
	if err != nil {
		t.Fatalf("read openapi.yaml: %v", err)
	}
	var spec openAPISpec
	if err := yaml.Unmarshal(raw, &spec); err != nil {
		t.Fatalf("parse openapi.yaml: %v", err)
	}
	return spec
}

func openAPIOperationFor(t *testing.T, spec openAPISpec, path string, method string) openAPIOperation {
	t.Helper()
	pathItem, ok := spec.Paths[path]
	if !ok {
		t.Fatalf("OpenAPI path %s not found", path)
	}
	var operation openAPIOperation
	switch method {
	case "get":
		operation = pathItem.Get
	case "post":
		operation = pathItem.Post
	case "patch":
		operation = pathItem.Patch
	case "delete":
		operation = pathItem.Delete
	default:
		t.Fatalf("unsupported method %q", method)
	}
	if operation.OperationID == "" {
		t.Fatalf("OpenAPI operation %s %s not found", method, path)
	}
	return operation
}
