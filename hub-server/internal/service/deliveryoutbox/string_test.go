package deliveryoutbox

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestTruncateString(t *testing.T) {
	tests := []struct {
		name   string
		s      string
		maxLen int
		want   string
	}{
		{name: "short unchanged", s: "hello", maxLen: 10, want: "hello"},
		{name: "exact maxLen", s: "hello", maxLen: 5, want: "hello"},
		{name: "over maxLen", s: "hello world this is long", maxLen: 14, want: "hello world..."},
		{name: "empty", s: "", maxLen: 10, want: ""},
		{name: "maxLen zero", s: "abc", maxLen: 0, want: ""},
		{name: "maxLen one", s: "abc", maxLen: 1, want: "a"},
		{name: "maxLen two", s: "abc", maxLen: 2, want: "ab"},
		{name: "maxLen three exact truncate", s: "abcd", maxLen: 3, want: "..."},
		{name: "negative maxLen", s: "abc", maxLen: -1, want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := TruncateString(tt.s, tt.maxLen)
			assert.Equal(t, tt.want, got)
			if tt.maxLen >= 0 {
				assert.LessOrEqual(t, len(got), tt.maxLen)
			}
		})
	}
}
