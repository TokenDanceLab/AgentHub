package api

import (
	"os"
	"path/filepath"
	"testing"

	"go.yaml.in/yaml/v2"
)

type openAPISpec struct {
	Paths      map[string]openAPIPathItem `yaml:"paths"`
	Components openAPIComponents          `yaml:"components"`
}

type openAPIComponents struct {
	Schemas map[string]openAPISchema `yaml:"schemas"`
}

type openAPISchema struct {
	Ref        string                   `yaml:"$ref"`
	Type       string                   `yaml:"type"`
	Properties map[string]openAPISchema `yaml:"properties"`
	Items      *openAPISchema           `yaml:"items"`
	Required   []string                 `yaml:"required"`
}

type openAPIResponse struct {
	Content map[string]openAPIMediaType `yaml:"content"`
}

type openAPIMediaType struct {
	Schema openAPISchema `yaml:"schema"`
}

type openAPIPathItem struct {
	Get    openAPIOperation `yaml:"get"`
	Post   openAPIOperation `yaml:"post"`
	Patch  openAPIOperation `yaml:"patch"`
	Delete openAPIOperation `yaml:"delete"`
}

type openAPIOperation struct {
	OperationID string                     `yaml:"operationId"`
	Status      string                     `yaml:"x-agenthub-status"`
	Responses   map[string]openAPIResponse `yaml:"responses"`
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
		{"/v1/runs/{runId}/diff", "get", "implemented"},
		{"/v1/approvals", "get", "planned"},
		{"/v1/approvals/{approvalId}:decide", "post", "planned"},
		{"/v1/artifacts", "get", "implemented"},
		{"/v1/artifacts/{artifactId}", "get", "implemented"},
		{"/v1/artifacts/{artifactId}/content", "get", "planned"},
		{"/v1/artifacts/{artifactId}:apply", "post", "planned"},
		{"/v1/artifacts/{artifactId}:discard", "post", "planned"},
		{"/v1/previews", "get", "implemented"},
		{"/v1/previews", "post", "planned"},
		{"/v1/previews/{previewId}", "get", "implemented"},
		{"/v1/previews/{previewId}:stop", "post", "planned"},
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

func TestOpenAPIModelCatalogDocumentsItemsAndSourcesContract(t *testing.T) {
	spec := loadEdgeOpenAPISpec(t)
	operation := openAPIOperationFor(t, spec, "/v1/model-catalog", "get")
	if operation.Status != "implemented" {
		t.Fatalf("get /v1/model-catalog status = %q, want implemented", operation.Status)
	}

	okResponse, ok := operation.Responses["200"]
	if !ok {
		t.Fatal("get /v1/model-catalog missing 200 response")
	}
	jsonBody, ok := okResponse.Content["application/json"]
	if !ok {
		t.Fatal("get /v1/model-catalog 200 response missing application/json content")
	}
	if jsonBody.Schema.Ref != "#/components/schemas/ModelCatalogResponse" {
		t.Fatalf("get /v1/model-catalog 200 schema ref = %q, want ModelCatalogResponse", jsonBody.Schema.Ref)
	}

	response := schemaNamed(t, spec, "ModelCatalogResponse")
	data := requireProperty(t, response, "ModelCatalogResponse", "data")
	if data.Ref != "#/components/schemas/ModelCatalog" {
		t.Fatalf("ModelCatalogResponse.data ref = %q, want ModelCatalog", data.Ref)
	}
	catalog := schemaNamed(t, spec, "ModelCatalog")
	requireArrayRef(t, catalog, "items", "#/components/schemas/ModelCatalogItem")
	requireArrayRef(t, catalog, "sources", "#/components/schemas/ModelCatalogSource")

	item := schemaNamed(t, spec, "ModelCatalogItem")
	for _, field := range []string{
		"id",
		"value",
		"label",
		"provider",
		"runtimeId",
		"resolvedModel",
		"sourceId",
		"sourceLabel",
		"status",
		"description",
		"tags",
		"reasoningEfforts",
		"default",
	} {
		requireProperty(t, item, "ModelCatalogItem", field)
	}

	source := schemaNamed(t, spec, "ModelCatalogSource")
	for _, field := range []string{"id", "label", "status", "detail"} {
		requireProperty(t, source, "ModelCatalogSource", field)
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

func schemaNamed(t *testing.T, spec openAPISpec, name string) openAPISchema {
	t.Helper()
	schema, ok := spec.Components.Schemas[name]
	if !ok {
		t.Fatalf("OpenAPI schema %s not found", name)
	}
	return schema
}

func requireArrayRef(t *testing.T, schema openAPISchema, field string, wantRef string) {
	t.Helper()
	property := requireProperty(t, schema, "ModelCatalog", field)
	if property.Type != "array" {
		t.Fatalf("ModelCatalog.%s type = %q, want array", field, property.Type)
	}
	if property.Items == nil {
		t.Fatalf("ModelCatalog.%s missing items", field)
	}
	if property.Items.Ref != wantRef {
		t.Fatalf("ModelCatalog.%s items ref = %q, want %q", field, property.Items.Ref, wantRef)
	}
}

func requireProperty(t *testing.T, schema openAPISchema, schemaName string, field string) openAPISchema {
	t.Helper()
	property, ok := schema.Properties[field]
	if !ok {
		t.Fatalf("%s missing property %s", schemaName, field)
	}
	return property
}
