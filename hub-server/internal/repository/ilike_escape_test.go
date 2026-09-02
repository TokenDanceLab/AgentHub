package repository

import "testing"

// TestEscapeILIKE pins the wildcard-escape contract shared by every
// LIKE/ILIKE search site (#2154): user input must match literally.
func TestEscapeILIKE(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"plain", "plain"},
		{"50%", `50\%`},
		{"a_b", `a\_b`},
		{`back\slash`, `back\\slash`},
		{"%_\\%", `\%\_\\\%`},
	}
	for _, tc := range tests {
		if got := escapeILIKE(tc.in); got != tc.want {
			t.Errorf("escapeILIKE(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
