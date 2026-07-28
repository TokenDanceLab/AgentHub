package handler_test

import (
	"testing"
)

// TestOpenAPIWebAgentTasksTriggerDocumentsRequiredFieldsAndConflict asserts the
// POST /web/agent-tasks trigger route contract: trigger_message_id is the
// required dispatch key, target_id carries the local_edge ExecutionTarget uuid,
// and the 409 turn_in_progress response is documented as a recoverable conflict
// (not a hard error) backed by the ErrorResponse envelope.
func TestOpenAPIWebAgentTasksTriggerDocumentsRequiredFieldsAndConflict(t *testing.T) {
	spec := loadOpenAPISpec(t)
	paths := yamlMapField(t, spec, "paths", "paths")

	tasksPath := yamlMapField(t, paths, "/web/agent-tasks", "paths./web/agent-tasks")
	post := yamlMapField(t, tasksPath, "post", "paths./web/agent-tasks.post")

	requestSchema := requestBodySchema(t, post, "agent-task trigger")
	required := yamlStringSlice(t, yamlField(t, requestSchema, "required", "agent-task trigger.required"), "agent-task trigger.required")
	if !containsString(required, "trigger_message_id") {
		t.Fatalf("agent-task trigger.required = %v, want trigger_message_id", required)
	}

	properties := yamlMapField(t, requestSchema, "properties", "agent-task trigger.properties")
	targetID := yamlMapField(t, properties, "target_id", "agent-task trigger.properties.target_id")
	if got := yamlScalarField(t, targetID, "format", "agent-task trigger.properties.target_id.format"); got != "uuid" {
		t.Fatalf("target_id format = %v, want uuid", got)
	}
	agentInstanceID := yamlMapField(t, properties, "agent_instance_id", "agent-task trigger.properties.agent_instance_id")
	if got := yamlScalarField(t, agentInstanceID, "type", "agent-task trigger.properties.agent_instance_id.type"); got != "string" {
		t.Fatalf("agent_instance_id type = %v, want string", got)
	}

	responses := yamlMapField(t, post, "responses", "agent-task trigger.responses")
	conflict := yamlMapField(t, responses, "409", "agent-task trigger.responses.409")
	conflictContent := yamlMapField(t, conflict, "content", "agent-task trigger.responses.409.content")
	conflictJSON := yamlMapField(t, conflictContent, "application/json", "agent-task trigger.responses.409.application/json")
	conflictSchema := yamlMapField(t, conflictJSON, "schema", "agent-task trigger.responses.409.schema")
	if got := yamlScalarField(t, conflictSchema, "$ref", "agent-task trigger.responses.409.schema.$ref"); got != "#/components/schemas/ErrorResponse" {
		t.Fatalf("409 schema $ref = %v, want #/components/schemas/ErrorResponse", got)
	}
	conflictExamples := yamlOptionalMapField(conflictJSON, "examples")
	if conflictExamples == nil {
		t.Fatal("agent-task trigger 409 must document a turn_in_progress example")
	}
	turnInProgress := yamlOptionalMapField(conflictExamples, "turn_in_progress")
	if turnInProgress == nil {
		t.Fatal("agent-task trigger 409 must document the turn_in_progress example")
	}
}

// TestOpenAPIClientSessionsCreateDispatcherContract asserts the generic
// POST /client/sessions create-dispatcher contract: type is required and
// constrained to private|group, and target_user_id carries a uuid format for
// the private branch. This route is the backwards-compatible generic create;
// typed variants live at /client/sessions/private and /client/sessions/group.
func TestOpenAPIClientSessionsCreateDispatcherContract(t *testing.T) {
	spec := loadOpenAPISpec(t)
	paths := yamlMapField(t, spec, "paths", "paths")

	sessionsPath := yamlMapField(t, paths, "/client/sessions", "paths./client/sessions")
	post := yamlMapField(t, sessionsPath, "post", "paths./client/sessions.post")

	if got := yamlScalarField(t, post, "x-agenthub-status", "paths./client/sessions.post.x-agenthub-status"); got != "implemented" {
		t.Fatalf("POST /client/sessions status = %q, want implemented", got)
	}

	requestSchema := requestBodySchema(t, post, "session create")
	required := yamlStringSlice(t, yamlField(t, requestSchema, "required", "session create.required"), "session create.required")
	if !containsString(required, "type") {
		t.Fatalf("session create.required = %v, want type", required)
	}

	properties := yamlMapField(t, requestSchema, "properties", "session create.properties")
	typeField := yamlMapField(t, properties, "type", "session create.properties.type")
	if got := yamlScalarField(t, typeField, "type", "session create.properties.type.type"); got != "string" {
		t.Fatalf("session create type field type = %v, want string", got)
	}
	enumNode := yamlField(t, typeField, "enum", "session create.properties.type.enum")
	enum := yamlStringSlice(t, enumNode, "session create.properties.type.enum")
	if !containsString(enum, "private") || !containsString(enum, "group") {
		t.Fatalf("session create type enum = %v, want both private and group", enum)
	}

	targetUserID := yamlMapField(t, properties, "target_user_id", "session create.properties.target_user_id")
	if got := yamlScalarField(t, targetUserID, "format", "session create.properties.target_user_id.format"); got != "uuid" {
		t.Fatalf("target_user_id format = %v, want uuid", got)
	}
}

// TestOpenAPIWebAgentTeamsCreateContract asserts the POST /web/agent-teams
// create-team contract: name is the required field, bounded by maxLength 100,
// and description is an optional string. This is the team-create entry point
// the router registers at web.POST("/agent-teams", agentTeamHandler.CreateTeam).
func TestOpenAPIWebAgentTeamsCreateContract(t *testing.T) {
	spec := loadOpenAPISpec(t)
	paths := yamlMapField(t, spec, "paths", "paths")

	teamsPath := yamlMapField(t, paths, "/web/agent-teams", "paths./web/agent-teams")
	post := yamlMapField(t, teamsPath, "post", "paths./web/agent-teams.post")

	if got := yamlScalarField(t, post, "x-agenthub-status", "paths./web/agent-teams.post.x-agenthub-status"); got != "implemented" {
		t.Fatalf("POST /web/agent-teams status = %q, want implemented", got)
	}

	requestSchema := requestBodySchema(t, post, "agent-team create")
	required := yamlStringSlice(t, yamlField(t, requestSchema, "required", "agent-team create.required"), "agent-team create.required")
	if !containsString(required, "name") {
		t.Fatalf("agent-team create.required = %v, want name", required)
	}

	properties := yamlMapField(t, requestSchema, "properties", "agent-team create.properties")
	name := yamlMapField(t, properties, "name", "agent-team create.properties.name")
	if got := yamlScalarField(t, name, "type", "agent-team create.properties.name.type"); got != "string" {
		t.Fatalf("agent-team create name type = %v, want string", got)
	}
	if got := yamlScalarField(t, name, "maxLength", "agent-team create.properties.name.maxLength"); got != "100" {
		t.Fatalf("agent-team create name maxLength = %v, want 100", got)
	}

	description := yamlMapField(t, properties, "description", "agent-team create.properties.description")
	if got := yamlScalarField(t, description, "type", "agent-team create.properties.description.type"); got != "string" {
		t.Fatalf("agent-team create description type = %v, want string", got)
	}
}
