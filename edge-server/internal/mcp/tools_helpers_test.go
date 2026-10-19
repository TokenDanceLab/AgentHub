package mcp

import "testing"

func TestJSONSchemaReturnsLiteral(t *testing.T) {
	const schema = `{"type":"object","properties":{}}`
	if got := string(jsonSchema(schema)); got != schema {
		t.Fatalf("jsonSchema = %q, want %q", got, schema)
	}
}

func TestJSONSchemaPanicsOnMalformedLiteral(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("malformed schema literal must panic at construction")
		}
	}()
	jsonSchema("{")
}
