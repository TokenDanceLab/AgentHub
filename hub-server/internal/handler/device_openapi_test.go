package handler_test

import (
	"os"
	"strings"
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

func TestOpenAPICloudEdgeRegisterDocumentsEdgeScopedJWTAndNoCallerDeviceMatch(t *testing.T) {
	spec := loadOpenAPISpec(t)
	paths := yamlMapField(t, spec, "paths", "paths")
	path := yamlMapField(t, paths, "/cloud/edge/register", "paths./cloud/edge/register")
	post := yamlMapField(t, path, "post", "paths./cloud/edge/register.post")

	description := yamlScalarField(t, post, "description", "cloud edge register description")
	for _, want := range []string{"aud=agenthub-edge", "purpose=edge-api", "device_type=edge"} {
		if !strings.Contains(description, want) {
			t.Fatalf("cloud edge register description missing %q: %s", want, description)
		}
	}
	for _, stale := range []string{"desktop device type", "WebSocket auth"} {
		if strings.Contains(description, stale) {
			t.Fatalf("cloud edge register description contains stale wording %q: %s", stale, description)
		}
	}
	if strings.Contains(description, "must match") || strings.Contains(description, "JWT device_id claim") {
		t.Fatalf("cloud edge register description must not require caller JWT device match: %s", description)
	}

	requestSchema := requestBodySchema(t, post, "cloud edge register")
	properties := yamlMapField(t, requestSchema, "properties", "cloud edge register request properties")
	deviceID := yamlMapField(t, properties, "device_id", "cloud edge register device_id")
	deviceDescription := yamlScalarField(t, deviceID, "description", "cloud edge register device_id description")
	if strings.Contains(deviceDescription, "must match") || strings.Contains(deviceDescription, "JWT device_id") {
		t.Fatalf("cloud edge device_id description must not require caller JWT device match: %s", deviceDescription)
	}

	responses := yamlMapField(t, post, "responses", "cloud edge register responses")
	okResp := yamlMapField(t, responses, "200", "cloud edge register responses.200")
	okContent := yamlMapField(t, okResp, "content", "cloud edge register responses.200.content")
	okJSON := yamlMapField(t, okContent, "application/json", "cloud edge register responses.200.application/json")
	responseSchema := yamlMapField(t, okJSON, "schema", "cloud edge register responses.200.schema")
	data := yamlMapField(t, yamlMapField(t, responseSchema, "properties", "cloud edge register response properties"), "data", "cloud edge register response data")
	jwtField := yamlMapField(t, yamlMapField(t, data, "properties", "cloud edge register data properties"), "jwt", "cloud edge register jwt")
	if got := yamlScalarField(t, jwtField, "description", "cloud edge register jwt description"); got != "Edge-scoped JWT for Edge API auth." {
		t.Fatalf("jwt description = %q, want Edge-scoped JWT for Edge API auth.", got)
	}
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

func TestOpenAPIClientMessageReactionsMatchesHubContract(t *testing.T) {
	spec := loadOpenAPISpec(t)
	paths := yamlMapField(t, spec, "paths", "paths")
	schemas := yamlMapField(t, yamlMapField(t, spec, "components", "components"), "schemas", "components.schemas")

	path := yamlMapField(t, paths, "/client/messages/{id}/reactions", "paths./client/messages/{id}/reactions")
	for _, method := range []string{"post", "delete"} {
		op := yamlMapField(t, path, method, "paths./client/messages/{id}/reactions."+method)
		schema := requestBodySchema(t, op, "message reaction "+method)
		if got := yamlScalarField(t, schema, "$ref", "message reaction "+method+" requestBody schema.$ref"); got != "#/components/schemas/MessageReactionRequest" {
			t.Fatalf("%s reaction request body ref = %v, want MessageReactionRequest", method, got)
		}
		data := responseEnvelopeData(t, op, "message reaction "+method)
		if got := yamlScalarField(t, data, "$ref", "message reaction "+method+" response data.$ref"); got != "#/components/schemas/MessageReactionResponse" {
			t.Fatalf("%s reaction response data ref = %v, want MessageReactionResponse", method, got)
		}
	}

	request := yamlMapField(t, schemas, "MessageReactionRequest", "components.schemas.MessageReactionRequest")
	required := yamlStringSlice(t, yamlField(t, request, "required", "MessageReactionRequest.required"), "MessageReactionRequest.required")
	if !containsString(required, "session_id") || !containsString(required, "reaction") {
		t.Fatalf("MessageReactionRequest.required = %v, want session_id and reaction", required)
	}
	requestProps := yamlMapField(t, request, "properties", "MessageReactionRequest.properties")
	requireMaxLength(t, yamlMapField(t, requestProps, "reaction", "MessageReactionRequest.properties.reaction"), "64", "message reaction")

	response := yamlMapField(t, schemas, "MessageReactionResponse", "components.schemas.MessageReactionResponse")
	responseRequired := yamlStringSlice(t, yamlField(t, response, "required", "MessageReactionResponse.required"), "MessageReactionResponse.required")
	for _, field := range []string{"message_id", "session_id", "reaction", "count", "reacted_by_me"} {
		if !containsString(responseRequired, field) {
			t.Fatalf("MessageReactionResponse.required = %v, want %s", responseRequired, field)
		}
	}
	responseProps := yamlMapField(t, response, "properties", "MessageReactionResponse.properties")
	if got := yamlScalarField(t, yamlMapField(t, responseProps, "message_id", "MessageReactionResponse.properties.message_id"), "type", "message_id type"); got != "string" {
		t.Fatalf("message_id type = %v, want string", got)
	}
	if got := yamlScalarField(t, yamlMapField(t, responseProps, "session_id", "MessageReactionResponse.properties.session_id"), "type", "session_id type"); got != "string" {
		t.Fatalf("session_id type = %v, want string", got)
	}
	if got := yamlScalarField(t, yamlMapField(t, responseProps, "reaction", "MessageReactionResponse.properties.reaction"), "type", "reaction type"); got != "string" {
		t.Fatalf("reaction type = %v, want string", got)
	}
	if got := yamlScalarField(t, yamlMapField(t, responseProps, "count", "MessageReactionResponse.properties.count"), "type", "count type"); got != "integer" {
		t.Fatalf("count type = %v, want integer", got)
	}
	if got := yamlScalarField(t, yamlMapField(t, responseProps, "reacted_by_me", "MessageReactionResponse.properties.reacted_by_me"), "type", "reacted_by_me type"); got != "boolean" {
		t.Fatalf("reacted_by_me type = %v, want boolean", got)
	}
}

func TestOpenAPIProviderBindingSchemasMatchHubModelAndDoNotExposeCredentials(t *testing.T) {
	spec := loadOpenAPISpec(t)
	schemas := yamlMapField(t, yamlMapField(t, spec, "components", "components"), "schemas", "components.schemas")

	assertSchemaHasOnlyProperties(t, schemas, "ProviderBinding", []string{
		"id",
		"provider",
		"binding_name",
		"base_url",
		"is_available",
		"quota_used",
		"quota_limit",
		"last_checked",
		"metadata",
		"created_at",
		"updated_at",
	})
	assertSchemaRequiredFields(t, schemas, "ProviderBinding", []string{
		"id",
		"provider",
		"is_available",
		"quota_used",
		"quota_limit",
		"created_at",
		"updated_at",
	})

	assertSchemaHasOnlyProperties(t, schemas, "CreateProviderBindingRequest", []string{
		"provider",
		"binding_name",
		"base_url",
		"is_available",
		"quota_limit",
		"metadata",
	})
	assertSchemaRequiredFields(t, schemas, "CreateProviderBindingRequest", []string{"provider"})

	assertSchemaHasOnlyProperties(t, schemas, "UpdateProviderBindingRequest", []string{
		"provider",
		"binding_name",
		"base_url",
		"is_available",
		"quota_used",
		"quota_limit",
		"last_checked",
		"metadata",
	})
}

func TestOpenAPIHubImplementedRoutesMatchRouterPaths(t *testing.T) {
	spec := loadOpenAPISpec(t)
	paths := yamlMapField(t, spec, "paths", "paths")

	expected := map[string][]string{
		"/client/ws":                                                         {"get"},
		"/client/auth/refresh":                                               {"post"},
		"/client/auth/oidc/authorize":                                        {"post"},
		"/client/auth/oidc/callback":                                         {"get", "post"},
		"/client/auth/me":                                                    {"get"},
		"/client/auth/logout":                                                {"post"},
		"/client/auth/profile":                                               {"put"},
		"/client/contacts/search":                                            {"get"},
		"/client/contacts/friend-requests":                                   {"get", "post"},
		"/client/contacts/friend-requests/{id}/accept":                       {"post"},
		"/client/contacts/friend-requests/{id}/reject":                       {"post"},
		"/client/contacts":                                                   {"get"},
		"/client/contacts/{userId}":                                          {"delete"},
		"/client/contacts/{userId}/block":                                    {"post"},
		"/client/contacts/{userId}/unblock":                                  {"post"},
		"/client/contacts/{userId}/remark":                                   {"put"},
		"/client/sessions":                                                   {"get"},
		"/client/sessions/private":                                           {"post"},
		"/client/sessions/group":                                             {"post"},
		"/client/sessions/{id}/members":                                      {"post"},
		"/client/sessions/{id}/members/{user_id}":                            {"delete"},
		"/client/sessions/{id}/leave":                                        {"post"},
		"/client/sessions/{id}/transfer-owner":                               {"post"},
		"/client/sessions/{id}/dissolve":                                     {"post"},
		"/client/sessions/{id}/info":                                         {"put"},
		"/client/sessions/{id}/settings":                                     {"put"},
		"/client/sessions/{id}":                                              {"delete"},
		"/client/sessions/{id}/messages":                                     {"get", "post"},
		"/client/sessions/{id}/messages/sync":                                {"get"},
		"/client/sessions/{id}/pins":                                         {"get"},
		"/client/sessions/{id}/read":                                         {"post"},
		"/client/sessions/{id}/agents":                                       {"post"},
		"/client/sessions/{id}/messages/search":                              {"get"},
		"/client/sessions/search":                                            {"get"},
		"/client/messages/{id}":                                              {"put"},
		"/client/messages/{id}/recall":                                       {"post"},
		"/client/messages/{id}/pin":                                          {"post", "delete"},
		"/client/messages/{id}/reactions":                                    {"post", "delete"},
		"/client/messages/{id}/forward":                                      {"post"},
		"/client/messages/search":                                            {"get"},
		"/client/attachments/probe":                                          {"post"},
		"/client/attachments":                                                {"post"},
		"/client/attachments/{id}":                                           {"get"},
		"/client/notifications":                                              {"get"},
		"/client/notifications/{id}/read":                                    {"post"},
		"/client/notifications/read-all":                                     {"post"},
		"/edge/devices/register":                                             {"post"},
		"/edge/agent-tasks/{id}/ack":                                         {"post"},
		"/edge/agent-tasks/{id}/stream":                                      {"post"},
		"/edge/agent-tasks/{id}/done":                                        {"post"},
		"/edge/agent-tasks/{id}/fail":                                        {"post"},
		"/cloud/edge/register":                                               {"post"},
		"/web/agent-tasks":                                                   {"post"},
		"/web/agent-tasks/{id}/cancel":                                       {"post"},
		"/web/agent-tasks/{id}/summary":                                      {"get"},
		"/web/agent-tasks/{id}/events/summary":                               {"get"},
		"/web/agent-tasks/{id}/events":                                       {"get"},
		"/web/custom-agents":                                                 {"get", "post"},
		"/web/custom-agents/{id}":                                            {"put", "delete"},
		"/web/agent-profiles":                                                {"get", "post"},
		"/web/agent-profiles/{id}":                                           {"get", "patch", "delete"},
		"/web/agent-profiles/{id}/publish":                                   {"post"},
		"/web/agent-profiles/{id}/install":                                   {"post"},
		"/web/skills":                                                        {"get", "post"},
		"/web/skills/{id}":                                                   {"get", "put", "delete"},
		"/web/skills/{id}/publish":                                           {"post"},
		"/web/skills/{id}/unpublish":                                         {"post"},
		"/web/mcp-servers":                                                   {"get", "post"},
		"/web/mcp-servers/{id}":                                              {"get", "put", "delete"},
		"/web/mcp-servers/{id}/publish":                                      {"post"},
		"/web/mcp-servers/{id}/unpublish":                                    {"post"},
		"/web/market/profiles":                                               {"get"},
		"/web/market/profiles/{id}":                                          {"get"},
		"/web/market/profiles/{id}/install":                                  {"post"},
		"/web/market/profiles/{id}/rate":                                     {"post"},
		"/web/provider-bindings":                                             {"get", "post"},
		"/web/provider-bindings/{id}":                                        {"put", "delete"},
		"/web/execution-targets":                                             {"get", "post"},
		"/web/execution-targets/{id}":                                        {"get", "patch", "delete"},
		"/web/execution-targets/{id}/ping":                                   {"post"},
		"/web/projects":                                                      {"get", "post"},
		"/web/projects/{id}":                                                 {"get", "patch"},
		"/web/audit-events":                                                  {"get"},
		"/web/relay/commands":                                                {"post"},
		"/web/relay/commands/{id}":                                           {"get"},
		"/web/relay/commands/{id}/ack":                                       {"post"},
		"/web/devices":                                                       {"get"},
		"/web/agent-teams":                                                   {"get", "post"},
		"/web/agent-teams/{id}":                                              {"get", "put", "delete"},
		"/web/agent-teams/{id}/members":                                      {"post"},
		"/web/agent-teams/{id}/members/{member_id}":                          {"delete"},
		"/web/agent-teams/{id}/runs":                                         {"get", "post"},
		"/web/agent-teams/{id}/runs/{run_id}":                                {"get"},
		"/web/agent-teams/{id}/runs/{run_id}/state":                          {"get"},
		"/web/agent-teams/{id}/runs/{run_id}/tasks":                          {"get"},
		"/web/agent-teams/{id}/runs/{run_id}/events":                         {"get"},
		"/web/agent-teams/{id}/runs/{run_id}/route-decisions":                {"post"},
		"/web/agent-teams/{id}/runs/{run_id}/approvals/{approval_id}/decide": {"post"},
		"/web/agent-teams/{id}/runs/{run_id}/conflicts/{conflict_id}/resolve":      {"post"},
		"/web/agent-teams/{id}/runs/{run_id}/assignments":                          {"get", "post"},
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

func TestOpenAPIRouteMiddlewareMetadataMatchesRouter(t *testing.T) {
	spec := loadOpenAPISpec(t)
	paths := yamlMapField(t, spec, "paths", "paths")

	adminRoutes := []struct {
		path   string
		method string
	}{
		{"/web/agent-profiles/{id}/publish", "post"},
		{"/web/skills/{id}/publish", "post"},
		{"/web/skills/{id}/unpublish", "post"},
		{"/web/mcp-servers/{id}/publish", "post"},
		{"/web/mcp-servers/{id}/unpublish", "post"},
		{"/web/audit-events", "get"},
		{"/web/relay/commands", "post"},
		{"/web/relay/commands/{id}", "get"},
		{"/web/relay/commands/{id}/ack", "post"},
	}
	for _, route := range adminRoutes {
		assertOperationRole(t, paths, route.path, route.method, "admin")
	}

	deviceRoutes := map[string]string{
		"/edge/devices/register":                              "desktop",
		"/edge/agent-tasks/{id}/ack":                          "desktop",
		"/edge/agent-tasks/{id}/stream":                       "desktop",
		"/edge/agent-tasks/{id}/done":                         "desktop",
		"/edge/agent-tasks/{id}/fail":                         "desktop",
		"/web/agent-tasks":                                    "web",
		"/web/agent-tasks/{id}/cancel":                        "web",
		"/web/agent-tasks/{id}/summary":                       "web",
		"/web/agent-tasks/{id}/events/summary":                "web",
		"/web/agent-tasks/{id}/events":                        "web",
		"/web/custom-agents":                                  "web",
		"/web/custom-agents/{id}":                             "web",
		"/web/agent-profiles":                                 "web",
		"/web/agent-profiles/{id}":                            "web",
		"/web/agent-profiles/{id}/publish":                    "web",
		"/web/agent-profiles/{id}/install":                    "web",
		"/web/skills":                                         "web",
		"/web/skills/{id}":                                    "web",
		"/web/skills/{id}/publish":                            "web",
		"/web/skills/{id}/unpublish":                          "web",
		"/web/mcp-servers":                                    "web",
		"/web/mcp-servers/{id}":                               "web",
		"/web/mcp-servers/{id}/publish":                       "web",
		"/web/mcp-servers/{id}/unpublish":                     "web",
		"/web/market/profiles":                                "web",
		"/web/market/profiles/{id}":                           "web",
		"/web/market/profiles/{id}/install":                   "web",
		"/web/market/profiles/{id}/rate":                      "web",
		"/web/provider-bindings":                              "web",
		"/web/provider-bindings/{id}":                         "web",
		"/web/execution-targets":                              "web",
		"/web/execution-targets/{id}":                         "web",
		"/web/execution-targets/{id}/ping":                    "web",
		"/web/projects":                                       "web",
		"/web/projects/{id}":                                  "web",
		"/web/audit-events":                                   "web",
		"/web/relay/commands":                                 "web",
		"/web/relay/commands/{id}":                            "web",
		"/web/relay/commands/{id}/ack":                        "web",
		"/web/devices":                                        "web",
		"/web/agent-teams":                                    "web",
		"/web/agent-teams/{id}":                               "web",
		"/web/agent-teams/{id}/members":                       "web",
		"/web/agent-teams/{id}/members/{member_id}":           "web",
		"/web/agent-teams/{id}/runs":                          "web",
		"/web/agent-teams/{id}/runs/{run_id}":                 "web",
		"/web/agent-teams/{id}/runs/{run_id}/state":           "web",
		"/web/agent-teams/{id}/runs/{run_id}/tasks":           "web",
		"/web/agent-teams/{id}/runs/{run_id}/events":          "web",
		"/web/agent-teams/{id}/runs/{run_id}/route-decisions": "web",
		"/web/agent-teams/{id}/runs/{run_id}/approvals/{approval_id}/decide":       "web",
		"/web/agent-teams/{id}/runs/{run_id}/conflicts/{conflict_id}/resolve":      "web",
		"/web/agent-teams/{id}/runs/{run_id}/assignments":                          "web",
		"/web/agent-teams/{id}/runs/{run_id}/assignments/{assignment_id}/dispatch": "web",
		"/web/agent-teams/{id}/runs/{run_id}/assignments/{assignment_id}/complete": "web",
		"/web/agent-teams/{id}/runs/{run_id}/assignments/{assignment_id}/fail":     "web",
	}
	for path, want := range deviceRoutes {
		assertPathDeviceType(t, paths, path, want)
	}
	assertPathHasNoDeviceType(t, paths, "/cloud/edge/register")
}

func TestOpenAPIBackendMigrationAuditCoverage(t *testing.T) {
	spec := loadOpenAPISpec(t)
	paths := yamlMapField(t, spec, "paths", "paths")

	assertOperationStatus(t, paths, "/client/auth/oidc/callback", "get", "implemented")
	assertOperationStatus(t, paths, "/client/auth/oidc/callback", "post", "implemented")
	oidcCallback := yamlMapField(t, paths, "/client/auth/oidc/callback", "paths./client/auth/oidc/callback")
	oidcGet := yamlMapField(t, oidcCallback, "get", "paths./client/auth/oidc/callback.get")
	oidcGetResponses := yamlMapField(t, oidcGet, "responses", "paths./client/auth/oidc/callback.get.responses")
	_ = yamlMapField(t, oidcGetResponses, "200", "paths./client/auth/oidc/callback.get.responses.200")
	_ = yamlMapField(t, oidcGetResponses, "400", "paths./client/auth/oidc/callback.get.responses.400")

	assertOperationStatus(t, paths, "/cloud/edge/register", "post", "implemented")
	assertPathHasNoDeviceType(t, paths, "/cloud/edge/register")

	adminRoutes := []struct {
		path   string
		method string
	}{
		{"/web/agent-profiles/{id}/publish", "post"},
		{"/web/skills/{id}/publish", "post"},
		{"/web/skills/{id}/unpublish", "post"},
		{"/web/mcp-servers/{id}/publish", "post"},
		{"/web/mcp-servers/{id}/unpublish", "post"},
		{"/web/audit-events", "get"},
		{"/web/relay/commands", "post"},
		{"/web/relay/commands/{id}", "get"},
		{"/web/relay/commands/{id}/ack", "post"},
	}
	for _, route := range adminRoutes {
		assertOperationRole(t, paths, route.path, route.method, "admin")
	}

	assertPathDeviceType(t, paths, "/edge/devices/register", "desktop")
	assertPathDeviceType(t, paths, "/edge/agent-tasks/{id}/ack", "desktop")
	assertPathDeviceType(t, paths, "/web/agent-tasks", "web")
	assertPathDeviceType(t, paths, "/web/agent-profiles", "web")
	assertPathDeviceType(t, paths, "/web/audit-events", "web")
}

func TestOpenAPIHubWebSocketDocumentsUpgradeAuth(t *testing.T) {
	spec := loadOpenAPISpec(t)
	paths := yamlMapField(t, spec, "paths", "paths")
	wsGet := yamlMapField(t, yamlMapField(t, paths, "/client/ws", "paths./client/ws"), "get", "paths./client/ws.get")

	description := yamlScalarField(t, wsGet, "description", "paths./client/ws.get.description")
	for _, want := range []string{"HTTP upgrade", "WSAuthMiddleware", "TokenDance ID RS256 bearer tokens"} {
		if !strings.Contains(description, want) {
			t.Fatalf("/client/ws description missing %q: %s", want, description)
		}
	}

	security := yamlSequenceField(t, wsGet, "security", "paths./client/ws.get.security")
	if !securityRequirementIncludes(security, "hubWebSocketQueryToken") {
		t.Fatal("/client/ws security must include hubWebSocketQueryToken for browser upgrade auth")
	}
	if !securityRequirementIncludes(security, "bearerAuth") {
		t.Fatal("/client/ws security must include bearerAuth for native Authorization header auth")
	}

	params := yamlSequenceField(t, wsGet, "parameters", "paths./client/ws.get.parameters")
	if !parameterNamed(params, "access_token") {
		t.Fatal("/client/ws parameters must document access_token query auth")
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

func responseEnvelopeData(t *testing.T, op *yaml.Node, name string) *yaml.Node {
	t.Helper()
	responses := yamlMapField(t, op, "responses", name+" responses")
	okResp := yamlMapField(t, responses, "200", name+" responses.200")
	okContent := yamlMapField(t, okResp, "content", name+" responses.200.content")
	okJSON := yamlMapField(t, okContent, "application/json", name+" responses.200.application/json")
	responseSchema := yamlMapField(t, okJSON, "schema", name+" responses.200.schema")
	responseProperties := yamlMapField(t, responseSchema, "properties", name+" responses.200.schema.properties")
	return yamlMapField(t, responseProperties, "data", name+" responses.200.schema.properties.data")
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

func securityRequirementIncludes(items []*yaml.Node, scheme string) bool {
	for _, item := range items {
		if yamlOptionalMapField(item, scheme) != nil {
			return true
		}
	}
	return false
}

func parameterNamed(items []*yaml.Node, name string) bool {
	for _, item := range items {
		nameNode := yamlOptionalMapField(item, "name")
		if nameNode != nil && nameNode.Kind == yaml.ScalarNode && nameNode.Value == name {
			return true
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

func assertSchemaHasOnlyProperties(t *testing.T, schemas *yaml.Node, schemaName string, want []string) {
	t.Helper()
	schema := yamlMapField(t, schemas, schemaName, "components.schemas."+schemaName)
	properties := yamlMapField(t, schema, "properties", "components.schemas."+schemaName+".properties")
	actual := map[string]struct{}{}
	for i := 0; i+1 < len(properties.Content); i += 2 {
		key := properties.Content[i].Value
		actual[key] = struct{}{}
	}
	for _, field := range want {
		if _, ok := actual[field]; !ok {
			t.Fatalf("%s.properties missing %q", schemaName, field)
		}
		delete(actual, field)
	}
	for field := range actual {
		t.Fatalf("%s.properties contains unexpected field %q", schemaName, field)
	}
	for _, field := range []string{"api_key", "api_base", "models", "is_default", "credential", "credentials", "token", "secret", "access_token", "refresh_token"} {
		if yamlOptionalMapField(properties, field) != nil {
			t.Fatalf("%s.properties must not expose credential-like field %q", schemaName, field)
		}
	}
}

func assertSchemaRequiredFields(t *testing.T, schemas *yaml.Node, schemaName string, want []string) {
	t.Helper()
	schema := yamlMapField(t, schemas, schemaName, "components.schemas."+schemaName)
	requiredNode := yamlOptionalMapField(schema, "required")
	if len(want) == 0 {
		if requiredNode != nil {
			t.Fatalf("%s.required = %v, want absent", schemaName, requiredNode.Value)
		}
		return
	}
	if requiredNode == nil {
		t.Fatalf("%s.required is missing", schemaName)
	}
	required := yamlStringSlice(t, requiredNode, schemaName+".required")
	for _, field := range want {
		if !containsString(required, field) {
			t.Fatalf("%s.required = %v, want %q", schemaName, required, field)
		}
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

func assertOperationStatus(t *testing.T, paths *yaml.Node, path string, method string, want string) {
	t.Helper()
	pathNode := yamlMapField(t, paths, path, "paths."+path)
	op := yamlMapField(t, pathNode, method, "paths."+path+"."+method)
	if got := yamlScalarField(t, op, "x-agenthub-status", "paths."+path+"."+method+".x-agenthub-status"); got != want {
		t.Fatalf("%s %s status = %q, want %q", method, path, got, want)
	}
}

func assertOperationRole(t *testing.T, paths *yaml.Node, path string, method string, want string) {
	t.Helper()
	pathNode := yamlMapField(t, paths, path, "paths."+path)
	op := yamlMapField(t, pathNode, method, "paths."+path+"."+method)
	if got := yamlScalarField(t, op, "x-agenthub-role", "paths."+path+"."+method+".x-agenthub-role"); got != want {
		t.Fatalf("%s %s role = %q, want %q", method, path, got, want)
	}
}

func assertPathDeviceType(t *testing.T, paths *yaml.Node, path string, want string) {
	t.Helper()
	pathNode := yamlMapField(t, paths, path, "paths."+path)
	if got := yamlScalarField(t, pathNode, "x-agenthub-device-type", "paths."+path+".x-agenthub-device-type"); got != want {
		t.Fatalf("%s device type = %q, want %q", path, got, want)
	}
}

func assertPathHasNoDeviceType(t *testing.T, paths *yaml.Node, path string) {
	t.Helper()
	pathNode := yamlMapField(t, paths, path, "paths."+path)
	if got := yamlOptionalMapField(pathNode, "x-agenthub-device-type"); got != nil {
		t.Fatalf("%s must not carry x-agenthub-device-type because no DeviceTypeCheck middleware protects it", path)
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
