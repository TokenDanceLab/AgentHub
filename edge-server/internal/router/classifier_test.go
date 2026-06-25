package router

import (
	"strings"
	"testing"
)

func TestClassifyComplexity_Simple(t *testing.T) {
	tests := []string{
		"fix typo in README",
		"run npm install",
		"check status",
		"show me the config",
		"run test",
		"fix typo",
		"",
		"hello",
		"print version",
	}
	for _, prompt := range tests {
		got := ClassifyComplexity(prompt)
		if got != ComplexitySimple {
			t.Errorf("ClassifyComplexity(%q) = %s, want %s", prompt, got, ComplexitySimple)
		}
	}
}

func TestClassifyComplexity_Medium(t *testing.T) {
	tests := []string{
		"add auth middleware with JWT validation and integrate it into the existing request pipeline with proper error handling and logging support",
		"first update the schema, then modify the handler to accept the new fields and update all tests",
		"step 1: create the database migration step 2: add the model step 3: wire up the API handler",
		"update the user profile endpoint to return additional fields and also make sure the frontend displays them correctly and consistently",
		// Medium-length prompt with multi-step indicator (no complex keywords)
		"first review the existing error handling in the API layer, then add consistent error wrapping for all handlers and update the middleware to log structured errors",
	}
	for _, prompt := range tests {
		got := ClassifyComplexity(prompt)
		if got != ComplexityMedium {
			t.Errorf("ClassifyComplexity(%q) = %s, want %s", prompt, got, ComplexityMedium)
		}
	}
}

func TestClassifyComplexity_Complex(t *testing.T) {
	tests := []string{
		"refactor the entire authentication system to use RS256 instead of HS256",
		"migrate all database queries from raw SQL to the repository pattern with proper transaction support",
		"design and implement a real-time notification system with WebSocket architecture that supports fallback polling and works across all three platforms",
		"this task depends on the completion of the OIDC integration before the session management work can start because the token format will change",
		"the new feature requires that the API gateway be updated first to support the additional headers needed for multi-region routing",
		"this work is blocked by the migration of the user table which must happen before any schema changes can be applied to the profiles system",
		"restructure all files in the shared package to follow the new naming convention and update every module that imports them",
		"we need to overhaul the entire codebase to adopt the new architecture that was proposed in the design review last week",
		// >100 words triggers complex regardless of keywords
		longText(120),
	}
	for _, prompt := range tests {
		got := ClassifyComplexity(prompt)
		if got != ComplexityComplex {
			t.Errorf("ClassifyComplexity(%q) = %s, want %s", prompt, got, ComplexityComplex)
		}
	}
}

func TestClassifyComplexity_Priority(t *testing.T) {
	tests := []struct {
		prompt string
		want   ComplexityLevel
	}{
		{"fix typo, but also refactor the entire module structure to support the new plugin system", ComplexityComplex},
		{"run test to check status, but depends on the database migration being completed first", ComplexityComplex},
		{"first create the model, then add the handler, after that update the tests, finally deploy", ComplexityMedium},
		{"show me the status but step 1: check the logs, step 2: verify the database", ComplexityMedium},
	}
	for _, tt := range tests {
		got := ClassifyComplexity(tt.prompt)
		if got != tt.want {
			t.Errorf("ClassifyComplexity(%q) = %s, want %s", tt.prompt, got, tt.want)
		}
	}
}

func TestClassifyComplexity_WordCountBoundaries(t *testing.T) {
	// Exactly 19 words → Simple
	short := makeWords(19)
	if got := ClassifyComplexity(short); got != ComplexitySimple {
		t.Errorf("19 words → %s, want %s", got, ComplexitySimple)
	}

	// Exactly 20 words with no signals → Medium (default)
	medium := makeWords(20)
	if got := ClassifyComplexity(medium); got != ComplexityMedium {
		t.Errorf("20 words (no signal) → %s, want %s", got, ComplexityMedium)
	}

	// Exactly 101 words → Complex
	long := makeWords(101)
	if got := ClassifyComplexity(long); got != ComplexityComplex {
		t.Errorf("101 words → %s, want %s", got, ComplexityComplex)
	}
}

func TestCountWords(t *testing.T) {
	tests := []struct {
		input string
		want  int
	}{
		{"", 0},
		{"hello", 1},
		{"hello world", 2},
		{"a b c d e", 5},
		{"  leading and trailing  ", 3},
		{"tab\tseparated\twords", 3},
	}
	for _, tt := range tests {
		got := countWords(tt.input)
		if got != tt.want {
			t.Errorf("countWords(%q) = %d, want %d", tt.input, got, tt.want)
		}
	}
}

// makeWords returns a string with n space-separated words.
func makeWords(n int) string {
	var b []string
	for i := 0; i < n; i++ {
		b = append(b, "word")
	}
	return strings.Join(b, " ")
}

// longText returns a string with n words, all "data".
func longText(n int) string {
	var b []string
	for i := 0; i < n; i++ {
		b = append(b, "data")
	}
	return strings.Join(b, " ")
}
