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

func TestOpenAPIDoesNotContainDuplicateMappingKeys(t *testing.T) {
	spec := loadOpenAPISpec(t)
	duplicatePath, ok := firstDuplicateMappingKey(spec, "$")
	if ok {
		t.Fatalf("OpenAPI contains duplicate mapping key at %s", duplicatePath)
	}
}

func TestOpenAPIHubAuthDeviceIDsUseUUIDContract(t *testing.T) {
	spec := loadOpenAPISpec(t)
	schemas := yamlMapField(t, yamlMapField(t, spec, "components", "components"), "schemas", "components.schemas")

	assertSchemaRequiresUUIDDeviceID(t, schemas, "HubOIDCAuthorizeRequest")
	assertSchemaRequiresUUIDDeviceID(t, schemas, "HubOIDCCallbackRequest")
}

func TestOpenAPIEdgeTaskCallbacksDocumentStreamAndDoneBodies(t *testing.T) {
	spec := loadOpenAPISpec(t)
	paths := yamlMapField(t, spec, "paths", "paths")
	schemas := yamlMapField(t, yamlMapField(t, spec, "components", "components"), "schemas", "components.schemas")

	streamPost := yamlMapField(t, yamlMapField(t, paths, "/edge/agent-tasks/{id}/stream", "paths.stream"), "post", "paths.stream.post")
	streamSchema := requestBodySchema(t, streamPost, "stream")
	if got := yamlScalarField(t, streamSchema, "$ref", "stream requestBody schema.$ref"); got != "#/components/schemas/HubTaskStreamRequest" {
		t.Fatalf("stream request body ref = %v, want HubTaskStreamRequest", got)
	}
	streamRequest := yamlMapField(t, schemas, "HubTaskStreamRequest", "components.schemas.HubTaskStreamRequest")
	streamAnyOf := yamlSequenceField(t, streamRequest, "anyOf", "HubTaskStreamRequest.anyOf")
	if !sequenceRequires(streamAnyOf, "content") || !sequenceRequires(streamAnyOf, "chunk") || !sequenceRequires(streamAnyOf, "payload") {
		t.Fatalf("HubTaskStreamRequest.anyOf must require content, chunk, or payload")
	}
	streamProps := yamlMapField(t, streamRequest, "properties", "HubTaskStreamRequest.properties")
	requireMaxLength(t, yamlMapField(t, streamProps, "content", "HubTaskStreamRequest.properties.content"), "1048576", "stream content")
	requireMaxLength(t, yamlMapField(t, streamProps, "chunk", "HubTaskStreamRequest.properties.chunk"), "1048576", "stream chunk")
	requireMaxLength(t, yamlMapField(t, streamProps, "run_id", "HubTaskStreamRequest.properties.run_id"), "128", "stream run_id")
	requireMaxLength(t, yamlMapField(t, streamProps, "edge_run_id", "HubTaskStreamRequest.properties.edge_run_id"), "128", "stream edge_run_id")
	clientMsgID := yamlMapField(t, streamProps, "client_msg_id", "HubTaskStreamRequest.properties.client_msg_id")
	if got := yamlScalarField(t, clientMsgID, "format", "stream client_msg_id format"); got != "uuid" {
		t.Fatalf("stream client_msg_id format = %v, want uuid", got)
	}

	donePost := yamlMapField(t, yamlMapField(t, paths, "/edge/agent-tasks/{id}/done", "paths.done"), "post", "paths.done.post")
	doneSchema := requestBodySchema(t, donePost, "done")
	if got := yamlScalarField(t, doneSchema, "$ref", "done requestBody schema.$ref"); got != "#/components/schemas/HubTaskDoneRequest" {
		t.Fatalf("done request body ref = %v, want HubTaskDoneRequest", got)
	}
	doneProps := yamlMapField(t, yamlMapField(t, schemas, "HubTaskDoneRequest", "components.schemas.HubTaskDoneRequest"), "properties", "HubTaskDoneRequest.properties")
	requireMaxLength(t, yamlMapField(t, doneProps, "run_id", "HubTaskDoneRequest.properties.run_id"), "128", "done run_id")
	requireMaxLength(t, yamlMapField(t, doneProps, "edge_run_id", "HubTaskDoneRequest.properties.edge_run_id"), "128", "done edge_run_id")
	requireMaxLength(t, yamlMapField(t, doneProps, "final_content", "HubTaskDoneRequest.properties.final_content"), "1048576", "done final_content")
}

func assertSchemaRequiresUUIDDeviceID(t *testing.T, schemas *yaml.Node, schemaName string) {
	t.Helper()
	schema := yamlMapField(t, schemas, schemaName, "components.schemas."+schemaName)
	required := yamlStringSlice(t, yamlField(t, schema, "required", schemaName+".required"), schemaName+".required")
	if !containsString(required, "device_type") || !containsString(required, "device_id") {
		t.Fatalf("%s.required = %v, want device_type and device_id", schemaName, required)
	}
	properties := yamlMapField(t, schema, "properties", schemaName+".properties")
	deviceID := yamlMapField(t, properties, "device_id", schemaName+".properties.device_id")
	if got := yamlScalarField(t, deviceID, "format", schemaName+".properties.device_id.format"); got != "uuid" {
		t.Fatalf("%s device_id format = %v, want uuid", schemaName, got)
	}
}

func requestBodySchema(t *testing.T, post *yaml.Node, name string) *yaml.Node {
	t.Helper()
	body := yamlMapField(t, post, "requestBody", name+" requestBody")
	content := yamlMapField(t, body, "content", name+" requestBody.content")
	jsonBody := yamlMapField(t, content, "application/json", name+" requestBody.application/json")
	return yamlMapField(t, jsonBody, "schema", name+" requestBody.schema")
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

func firstDuplicateMappingKey(node *yaml.Node, path string) (string, bool) {
	if node == nil {
		return "", false
	}
	if node.Kind == yaml.DocumentNode {
		for _, child := range node.Content {
			if duplicatePath, ok := firstDuplicateMappingKey(child, path); ok {
				return duplicatePath, true
			}
		}
		return "", false
	}
	if node.Kind == yaml.MappingNode {
		seen := map[string]struct{}{}
		for i := 0; i+1 < len(node.Content); i += 2 {
			key := node.Content[i].Value
			childPath := path + "." + key
			if _, exists := seen[key]; exists {
				return childPath, true
			}
			seen[key] = struct{}{}
			if duplicatePath, ok := firstDuplicateMappingKey(node.Content[i+1], childPath); ok {
				return duplicatePath, true
			}
		}
		return "", false
	}
	if node.Kind == yaml.SequenceNode {
		for _, child := range node.Content {
			if duplicatePath, ok := firstDuplicateMappingKey(child, path+"[]"); ok {
				return duplicatePath, true
			}
		}
	}
	return "", false
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

func yamlSequenceField(t *testing.T, node *yaml.Node, key string, path string) []*yaml.Node {
	t.Helper()
	value := yamlField(t, node, key, path)
	if value.Kind != yaml.SequenceNode {
		t.Fatalf("%s has kind %v, want sequence", path, value.Kind)
	}
	return value.Content
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

func sequenceRequires(items []*yaml.Node, requiredField string) bool {
	for _, item := range items {
		required := yamlOptionalMapField(item, "required")
		if required == nil || required.Kind != yaml.SequenceNode {
			continue
		}
		for _, field := range required.Content {
			if field.Kind == yaml.ScalarNode && field.Value == requiredField {
				return true
			}
		}
	}
	return false
}

func requireMaxLength(t *testing.T, node *yaml.Node, want string, field string) {
	t.Helper()
	if got := yamlScalarField(t, node, "maxLength", field+" maxLength"); got != want {
		t.Fatalf("%s maxLength = %v, want %s", field, got, want)
	}
}

func containsString(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}
