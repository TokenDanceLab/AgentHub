package lifecycle

import (
	"strings"
	"testing"
)

func TestExtractHubCallbackText(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		payload any
		want    string
	}{
		{
			name:    "non-map",
			payload: "plain",
			want:    "",
		},
		{
			name:    "content key",
			payload: map[string]any{"content": "hello"},
			want:    "hello",
		},
		{
			name:    "delta key preferred after content empty",
			payload: map[string]any{"text": "from-text"},
			want:    "from-text",
		},
		{
			name: "nested message content",
			payload: map[string]any{
				"message": map[string]any{"content": "nested"},
			},
			want: "nested",
		},
		{
			name:    "empty map",
			payload: map[string]any{},
			want:    "",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := extractHubCallbackText(tt.payload); got != tt.want {
				t.Fatalf("extractHubCallbackText() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestHubOutputCollectorBoundsAndFallback(t *testing.T) {
	t.Parallel()

	c := newHubOutputCollector(8)
	c.Append("hello ")
	c.Append("world-extra")
	if got := c.Final(); !strings.HasPrefix(got, "hello ") || !strings.Contains(got, "[output truncated]") {
		t.Fatalf("Final() = %q, want bounded prefix with truncation marker", got)
	}

	// Empty builder uses fallback when no streamed content was kept.
	c2 := newHubOutputCollector(32)
	c2.SetFallback(" final result ")
	if got := c2.Final(); got != "final result" {
		t.Fatalf("Final() fallback = %q, want %q", got, "final result")
	}

	// First non-empty fallback wins.
	c2.SetFallback("ignored")
	if got := c2.Final(); got != "final result" {
		t.Fatalf("Final() after second fallback = %q, want first fallback", got)
	}

	// Default max uses hubCallbackFinalMaxBytes when maxBytes <= 0.
	c3 := newHubOutputCollector(0)
	if c3.maxBytes != hubCallbackFinalMaxBytes {
		t.Fatalf("maxBytes = %d, want %d", c3.maxBytes, hubCallbackFinalMaxBytes)
	}
}
