package handler_test

import (
	"os"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestOpenAPIEdgeDeviceRegisterMatchesHubRouteAndEnvelope(t *testing.T) {
	spec := loadOpenAPISpec(t)
	paths := yamlMapField(t, spec, "paths", "paths")

	if yamlOptionalMapField(paths, "/edge/devices:register") != nil {
		t.Fatal("OpenAPI must document the Hub route /edge/devices/register, not /edge/devices:register")
	}

	path := yamlMapField(t, paths, "/edge/devices/register", "paths./edge/devices/register")
	post := yamlMapField(t, path, "post", "paths./edge/devices/register.post")

	requestBody := yamlMapField(t, post, "requestBody", "register requestBody")
	content := yamlMapField(t, requestBody, "content", "register requestBody.content")
	jsonBody := yamlMapField(t, content, "application/json", "register requestBody.application/json")
	requestSchema := yamlMapField(t, jsonBody, "schema", "register requestBody.schema")
	required := yamlStringSlice(t, yamlField(t, requestSchema, "required", "register requestBody.required"), "register requestBody.required")
	if !containsString(required, "device_id") {
		t.Fatalf("register requestBody.required = %v, want device_id", required)
	}
	properties := yamlMapField(t, requestSchema, "properties", "register requestBody.properties")
	deviceID := yamlMapField(t, properties, "device_id", "register requestBody.properties.device_id")
	if got := yamlScalarField(t, deviceID, "format", "register requestBody.properties.device_id.format"); got != "uuid" {
		t.Fatalf("device_id format = %v, want uuid", got)
	}
	capabilities := yamlMapField(t, properties, "capabilities", "register requestBody.properties.capabilities")
	if got := yamlScalarField(t, capabilities, "type", "register requestBody.properties.capabilities.type"); got != "array" {
		t.Fatalf("capabilities type = %v, want array", got)
	}

	responses := yamlMapField(t, post, "responses", "register responses")
	okResp := yamlMapField(t, responses, "200", "register responses.200")
	okContent := yamlMapField(t, okResp, "content", "register responses.200.content")
	okJSON := yamlMapField(t, okContent, "application/json", "register responses.200.application/json")
	responseSchema := yamlMapField(t, okJSON, "schema", "register responses.200.schema")
	if got := yamlScalarField(t, responseSchema, "type", "register responses.200.schema.type"); got != "object" {
		t.Fatalf("register response schema type = %v, want object envelope", got)
	}
	responseProperties := yamlMapField(t, responseSchema, "properties", "register responses.200.schema.properties")
	code := yamlMapField(t, responseProperties, "code", "register responses.200.schema.properties.code")
	if got := yamlScalarField(t, code, "type", "register responses.200.schema.properties.code.type"); got != "string" {
		t.Fatalf("register response code type = %v, want string", got)
	}
	data := yamlMapField(t, responseProperties, "data", "register responses.200.schema.properties.data")
	if got := yamlScalarField(t, data, "$ref", "register responses.200.schema.properties.data.$ref"); got != "#/components/schemas/Device" {
		t.Fatalf("register response data ref = %v, want #/components/schemas/Device", got)
	}
}

func loadOpenAPISpec(t *testing.T) *yaml.Node {
	t.Helper()
	raw, err := os.ReadFile("../../../api/openapi.yaml")
	if err != nil {
		t.Fatalf("read openapi spec: %v", err)
	}
	var spec yaml.Node
	if err := yaml.Unmarshal(raw, &spec); err != nil {
		t.Fatalf("parse openapi spec: %v", err)
	}
	if spec.Kind == yaml.DocumentNode && len(spec.Content) == 1 {
		return spec.Content[0]
	}
	return &spec
}

func yamlMapField(t *testing.T, node *yaml.Node, key string, path string) *yaml.Node {
	t.Helper()
	value := yamlField(t, node, key, path)
	if value.Kind != yaml.MappingNode {
		t.Fatalf("%s has kind %v, want mapping", path, value.Kind)
	}
	return value
}

func yamlField(t *testing.T, node *yaml.Node, key string, path string) *yaml.Node {
	t.Helper()
	value := yamlOptionalMapField(node, key)
	if value == nil {
		t.Fatalf("%s is missing", path)
	}
	return value
}

func yamlOptionalMapField(node *yaml.Node, key string) *yaml.Node {
	if node == nil || node.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		if node.Content[i].Value == key {
			return node.Content[i+1]
		}
	}
	return nil
}

func yamlScalarField(t *testing.T, node *yaml.Node, key string, path string) string {
	t.Helper()
	value := yamlOptionalMapField(node, key)
	if value == nil {
		t.Fatalf("%s is missing", path)
	}
	if value.Kind != yaml.ScalarNode {
		t.Fatalf("%s has kind %v, want scalar", path, value.Kind)
	}
	return value.Value
}

func yamlStringSlice(t *testing.T, node *yaml.Node, path string) []string {
	t.Helper()
	if node.Kind != yaml.SequenceNode {
		t.Fatalf("%s has kind %v, want sequence", path, node.Kind)
	}
	items := make([]string, 0, len(node.Content))
	for _, item := range node.Content {
		if item.Kind != yaml.ScalarNode {
			t.Fatalf("%s contains kind %v, want scalar", path, item.Kind)
		}
		items = append(items, item.Value)
	}
	return items
}

func containsString(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}
