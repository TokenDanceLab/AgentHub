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

func TestOpenAPIHubImplementedRoutesMatchRouterPaths(t *testing.T) {
	spec := loadOpenAPISpec(t)
	paths := yamlMapField(t, spec, "paths", "paths")

	expected := map[string][]string{
		"/client/ws":                                                          {"get"},
		"/client/auth/refresh":                                                {"post"},
		"/client/auth/oidc/authorize":                                         {"post"},
		"/client/auth/oidc/callback":                                          {"post"},
		"/client/auth/me":                                                     {"get"},
		"/client/auth/logout":                                                 {"post"},
		"/client/auth/profile":                                                {"put"},
		"/client/contacts/search":                                             {"get"},
		"/client/contacts/friend-requests":                                    {"get", "post"},
		"/client/contacts/friend-requests/{id}/accept":                        {"post"},
		"/client/contacts/friend-requests/{id}/reject":                        {"post"},
		"/client/contacts":                                                    {"get"},
		"/client/contacts/{userId}":                                           {"delete"},
		"/client/contacts/{userId}/block":                                     {"post"},
		"/client/contacts/{userId}/unblock":                                   {"post"},
		"/client/contacts/{userId}/remark":                                    {"put"},
		"/client/sessions":                                                    {"get"},
		"/client/sessions/private":                                            {"post"},
		"/client/sessions/group":                                              {"post"},
		"/client/sessions/{id}/members":                                       {"post"},
		"/client/sessions/{id}/members/{user_id}":                             {"delete"},
		"/client/sessions/{id}/leave":                                         {"post"},
		"/client/sessions/{id}/transfer-owner":                                {"post"},
		"/client/sessions/{id}/dissolve":                                      {"post"},
		"/client/sessions/{id}/info":                                          {"put"},
		"/client/sessions/{id}/settings":                                      {"put"},
		"/client/sessions/{id}":                                               {"delete"},
		"/client/sessions/{id}/messages":                                      {"get", "post"},
		"/client/sessions/{id}/messages/sync":                                 {"get"},
		"/client/sessions/{id}/pins":                                          {"get"},
		"/client/sessions/{id}/read":                                          {"post"},
		"/client/sessions/{id}/agents":                                        {"post"},
		"/client/sessions/{id}/messages/search":                               {"get"},
		"/client/sessions/search":                                             {"get"},
		"/client/messages/{id}/recall":                                        {"post"},
		"/client/messages/{id}/pin":                                           {"post", "delete"},
		"/client/messages/{id}/forward":                                       {"post"},
		"/client/messages/search":                                             {"get"},
		"/client/attachments/probe":                                           {"post"},
		"/client/attachments":                                                 {"post"},
		"/client/attachments/{id}":                                            {"get"},
		"/client/notifications":                                               {"get"},
		"/client/notifications/{id}/read":                                     {"post"},
		"/client/notifications/read-all":                                      {"post"},
		"/edge/devices/register":                                              {"post"},
		"/edge/agent-tasks/{id}/ack":                                          {"post"},
		"/edge/agent-tasks/{id}/stream":                                       {"post"},
		"/edge/agent-tasks/{id}/done":                                         {"post"},
		"/edge/agent-tasks/{id}/fail":                                         {"post"},
		"/web/agent-tasks":                                                    {"post"},
		"/web/agent-tasks/{id}/cancel":                                        {"post"},
		"/web/agent-tasks/{id}/events/summary":                                {"get"},
		"/web/agent-tasks/{id}/events":                                        {"get"},
		"/web/custom-agents":                                                  {"get", "post"},
		"/web/custom-agents/{id}":                                             {"put", "delete"},
		"/web/agent-profiles":                                                 {"get", "post"},
		"/web/agent-profiles/{id}":                                            {"get", "patch", "delete"},
		"/web/agent-profiles/{id}/publish":                                    {"post"},
		"/web/agent-profiles/{id}/install":                                    {"post"},
		"/web/skills":                                                         {"get", "post"},
		"/web/skills/{id}":                                                    {"get", "put", "delete"},
		"/web/skills/{id}/publish":                                            {"post"},
		"/web/skills/{id}/unpublish":                                          {"post"},
		"/web/mcp-servers":                                                    {"get", "post"},
		"/web/mcp-servers/{id}":                                               {"get", "put", "delete"},
		"/web/mcp-servers/{id}/publish":                                       {"post"},
		"/web/mcp-servers/{id}/unpublish":                                     {"post"},
		"/web/market/profiles":                                                {"get"},
		"/web/market/profiles/{id}":                                           {"get"},
		"/web/market/profiles/{id}/install":                                   {"post"},
		"/web/market/profiles/{id}/rate":                                      {"post"},
		"/web/provider-bindings":                                              {"get", "post"},
		"/web/provider-bindings/{id}":                                         {"put", "delete"},
		"/web/execution-targets":                                              {"get", "post"},
		"/web/execution-targets/{id}":                                         {"get", "patch", "delete"},
		"/web/execution-targets/{id}/ping":                                    {"post"},
		"/web/audit-events":                                                   {"get"},
		"/web/relay/commands":                                                 {"post"},
		"/web/relay/commands/{id}":                                            {"get"},
		"/web/relay/commands/{id}/ack":                                        {"post"},
		"/web/devices":                                                        {"get"},
		"/web/agent-teams":                                                    {"get", "post"},
		"/web/agent-teams/{id}":                                               {"get", "put", "delete"},
		"/web/agent-teams/{id}/members":                                       {"post"},
		"/web/agent-teams/{id}/members/{member_id}":                           {"delete"},
		"/web/agent-teams/{id}/runs":                                          {"get", "post"},
		"/web/agent-teams/{id}/runs/{run_id}":                                 {"get"},
		"/web/agent-teams/{id}/runs/{run_id}/state":                           {"get"},
		"/web/agent-teams/{id}/runs/{run_id}/tasks":                           {"get"},
		"/web/agent-teams/{id}/runs/{run_id}/events":                          {"get"},
		"/web/agent-teams/{id}/runs/{run_id}/route-decisions":                 {"post"},
		"/web/agent-teams/{id}/runs/{run_id}/approvals/{approval_id}/decide":  {"post"},
		"/web/agent-teams/{id}/runs/{run_id}/conflicts/{conflict_id}/resolve": {"post"},
		"/web/agent-teams/{id}/runs/{run_id}/assignments":                     {"get", "post"},
		"/web/agent-teams/{id}/runs/{run_id}/assignments/{assignment_id}/dispatch": {"post"},
		"/web/agent-teams/{id}/runs/{run_id}/assignments/{assignment_id}/complete": {"post"},
		"/web/agent-teams/{id}/runs/{run_id}/assignments/{assignment_id}/fail":     {"post"},
	}

	for path, methods := range expected {
		pathNode := yamlMapField(t, paths, path, "paths."+path)
		for _, method := range methods {
			op := yamlMapField(t, pathNode, method, "paths."+path+"."+method)
			if got := yamlScalarField(t, op, "x-agenthub-status", "paths."+path+"."+method+".x-agenthub-status"); got != "implemented" {
				t.Fatalf("%s %s status = %q, want implemented", method, path, got)
			}
		}
	}

	legacyImplementedPaths := []string{
		"/client/contacts/{userId}:block",
		"/client/contacts/{userId}:unblock",
		"/client/friend-requests",
		"/client/friend-requests/sent",
		"/client/sessions/{id}/members/{memberId}",
		"/client/sessions/{id}:leave",
		"/client/sessions/{id}:dissolve",
		"/client/sessions/{id}:transfer-owner",
		"/client/sessions/{id}/member-settings",
		"/client/sessions/{id}:read",
		"/client/messages:forward",
		"/client/attachments:probe",
		"/client/attachments:upload",
		"/client/notifications/{id}:read",
		"/client/notifications:read-all",
		"/web/agent-tasks/{id}:cancel",
		"/web/agent-profiles/{profileId}",
		"/web/agent-profiles/{profileId}:publish",
		"/web/agent-profiles/{profileId}:install",
		"/web/skills/{skillId}",
		"/web/skills/{skillId}:publish",
		"/web/skills/{skillId}:unpublish",
		"/web/mcp-servers/{serverId}",
		"/web/mcp-servers/{serverId}:publish",
		"/web/mcp-servers/{serverId}:unpublish",
		"/web/provider-bindings/{bindingId}",
		"/web/market/profiles/{profileId}",
		"/web/market/profiles/{profileId}:install",
		"/web/market/profiles/{profileId}:rate",
	}
	for _, path := range legacyImplementedPaths {
		assertPathHasNoImplementedOperations(t, paths, path)
	}

	legacyImplementedOperations := map[string][]string{
		"/client/sessions/{id}/members": {"get"},
		"/web/custom-agents/{id}":       {"get"},
	}
	for path, methods := range legacyImplementedOperations {
		for _, method := range methods {
			assertOperationIsNotImplemented(t, paths, path, method)
		}
	}
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

func assertPathHasNoImplementedOperations(t *testing.T, paths *yaml.Node, path string) {
	t.Helper()
	pathNode := yamlOptionalMapField(paths, path)
	if pathNode == nil {
		return
	}
	if pathNode.Kind != yaml.MappingNode {
		t.Fatalf("paths.%s has kind %v, want mapping", path, pathNode.Kind)
	}
	for i := 0; i+1 < len(pathNode.Content); i += 2 {
		method := pathNode.Content[i].Value
		op := pathNode.Content[i+1]
		if op.Kind != yaml.MappingNode {
			continue
		}
		status := yamlOptionalMapField(op, "x-agenthub-status")
		if status != nil && status.Kind == yaml.ScalarNode && status.Value == "implemented" {
			t.Fatalf("legacy path %s %s must not be marked implemented", method, path)
		}
	}
}

func assertOperationIsNotImplemented(t *testing.T, paths *yaml.Node, path string, method string) {
	t.Helper()
	pathNode := yamlOptionalMapField(paths, path)
	if pathNode == nil {
		return
	}
	op := yamlOptionalMapField(pathNode, method)
	if op == nil || op.Kind != yaml.MappingNode {
		return
	}
	status := yamlOptionalMapField(op, "x-agenthub-status")
	if status != nil && status.Kind == yaml.ScalarNode && status.Value == "implemented" {
		t.Fatalf("legacy operation %s %s must not be marked implemented", method, path)
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
